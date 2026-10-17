-- Add-unit requests describe each requested unit independently.
alter table public.service_requests
  add column requested_units jsonb;

alter table public.service_requests
  add constraint service_requests_requested_units_check
  check (requested_units is null or jsonb_typeof(requested_units) = 'array');

comment on column public.service_requests.requested_units is
  'Requested add-unit specifications: [{"name":"North wall","nodes":3}, ...].';

alter table public.units
  add column source_request_unit_index smallint;

alter table public.units
  add constraint units_source_request_unit_index_check
  check (source_request_unit_index is null or source_request_unit_index between 0 and 19);

create unique index units_source_request_unit_index_key
  on public.units(source_request_id, source_request_unit_index)
  where source_request_id is not null and source_request_unit_index is not null;

-- New clients use requested_units. The older quantity overloads remain for
-- already-open browser sessions and legacy requests.
create function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_units jsonb,
  target_details text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  request_id uuid;
  unit_spec jsonb;
  unit_nodes integer;
begin
  if target_request_type = 'add_unit' then
    if target_requested_units is null
      or jsonb_typeof(target_requested_units) <> 'array'
      or jsonb_array_length(target_requested_units) not between 1 and 20 then
      raise exception 'requested_units_required' using errcode = '22023';
    end if;

    for unit_spec in select value from jsonb_array_elements(target_requested_units)
    loop
      if jsonb_typeof(unit_spec) <> 'object'
        or jsonb_typeof(unit_spec->'name') <> 'string'
        or char_length(trim(unit_spec->>'name')) not between 1 and 120
        or jsonb_typeof(unit_spec->'nodes') <> 'number' then
        raise exception 'invalid_requested_unit' using errcode = '22023';
      end if;
      begin
        unit_nodes := (unit_spec->>'nodes')::integer;
      exception when invalid_text_representation then
        raise exception 'invalid_requested_unit' using errcode = '22023';
      end;
      if unit_nodes not between 1 and 16 then
        raise exception 'invalid_requested_unit' using errcode = '22023';
      end if;
    end loop;
  elsif target_requested_units is not null then
    raise exception 'requested_units_not_allowed' using errcode = '22023';
  end if;

  request_id := private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    target_unit_id,
    case when target_request_type = 'add_unit' then jsonb_array_length(target_requested_units)::smallint else target_requested_count end,
    target_details
  );

  update public.service_requests
  set requested_units = target_requested_units,
      requested_nodes_per_unit = null
  where id = request_id;

  return request_id;
end;
$$;

create function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_units jsonb,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    target_unit_id,
    target_requested_count,
    target_requested_units,
    target_details
  )
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, jsonb, text)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, jsonb, text)
  to authenticated;

-- Each request-created unit must correspond to exactly one customer-provided
-- specification. The index is assigned by Admin in request order.
create function private.enforce_add_unit_request_unit_spec()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions as $$
declare
  specs jsonb;
  expected_name text;
  expected_nodes integer;
begin
  if new.source_request_id is null then return new; end if;
  if tg_op = 'UPDATE'
    and new.source_request_id is not distinct from old.source_request_id
    and new.source_request_unit_index is not distinct from old.source_request_unit_index
    and new.name is not distinct from old.name then
    return new;
  end if;

  select requested_units into specs
  from public.service_requests
  where id = new.source_request_id
    and request_type = 'add_unit'
    and status = 'open'
    and site_id = new.site_id;
  if specs is null then return new; end if;

  if new.source_request_unit_index is null
    or new.source_request_unit_index >= jsonb_array_length(specs) then
    raise exception 'requested_unit_index_invalid' using errcode = 'P0001';
  end if;

  expected_name := specs->new.source_request_unit_index->>'name';
  expected_nodes := (specs->new.source_request_unit_index->>'nodes')::integer;
  if lower(trim(new.name)) <> lower(trim(expected_name)) then
    raise exception 'requested_unit_name_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_add_unit_request_unit_spec() from public, anon, authenticated, service_role;

drop trigger if exists units_enforce_add_unit_request_spec on public.units;
create trigger units_enforce_add_unit_request_spec
before insert or update of source_request_id, source_request_unit_index, name
on public.units
for each row execute function private.enforce_add_unit_request_unit_spec();

-- Enforce the node count selected for the specific unit, not one shared count
-- across the whole add-unit request.
create or replace function private.enforce_add_unit_node_quantity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions as $$
declare
  unit_request_id uuid;
  unit_index smallint;
  specs jsonb;
  expected_count integer;
  legacy_expected_count integer;
  actual_count integer;
begin
  if new.unit_id is null then return new; end if;
  if tg_op = 'UPDATE'
    and new.unit_id is not distinct from old.unit_id
    and new.source_request_id is not distinct from old.source_request_id then
    return new;
  end if;

  select u.source_request_id, u.source_request_unit_index
  into unit_request_id, unit_index
  from public.units u
  where u.id = new.unit_id;
  if unit_request_id is null then return new; end if;

  select requested_units, requested_nodes_per_unit
  into specs, legacy_expected_count
  from public.service_requests
  where id = unit_request_id
    and request_type = 'add_unit'
    and status = 'open';
  if specs is null and legacy_expected_count is null then return new; end if;
  if new.source_request_id is distinct from unit_request_id then
    raise exception 'node_source_request_required' using errcode = 'P0001';
  end if;

  if specs is not null then
    if unit_index is null or unit_index >= jsonb_array_length(specs) then
      raise exception 'requested_unit_index_invalid' using errcode = 'P0001';
    end if;
    expected_count := (specs->unit_index->>'nodes')::integer;
  else
    expected_count := legacy_expected_count;
  end if;

  select count(*) into actual_count
  from public.nodes n
  where n.unit_id = new.unit_id
    and n.source_request_id = unit_request_id
    and n.id <> new.id;
  if actual_count >= expected_count then
    raise exception 'requested_nodes_per_unit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_add_unit_node_quantity() from public, anon, authenticated, service_role;

-- Completion checks now validate every requested unit against its own spec.
create or replace function private.enforce_request_fulfillment()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions as $$
declare
  expected_count integer;
  actual_count integer;
begin
  if tg_table_name = 'units' then
    if new.source_request_id is null or (tg_op = 'UPDATE' and new.source_request_id is not distinct from old.source_request_id) then
      return new;
    end if;
    select requested_count into expected_count
    from public.service_requests
    where id = new.source_request_id
      and request_type = 'add_unit'
      and status = 'open'
      and site_id = new.site_id;
    if expected_count is null then
      raise exception 'unit_source_request_unavailable' using errcode = 'P0001';
    end if;
    select count(*) into actual_count from public.units where source_request_id = new.source_request_id;
    if actual_count >= expected_count then
      raise exception 'requested_unit_count_reached' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = 'completed' and old.status <> 'completed' and new.request_type in ('add_unit', 'add_nodes') then
    if new.requested_count is null then return new; end if;
    if new.request_type = 'add_unit' then
      select count(*) into actual_count from public.units where source_request_id = new.id;
      if actual_count <> new.requested_count then
        raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001',
          detail = format('Expected %s units, found %s.', new.requested_count, actual_count);
      end if;
      if new.requested_units is not null and exists (
        select 1
        from public.units u
        where u.source_request_id = new.id
          and (
            u.source_request_unit_index is null
            or (select count(*) from public.nodes n where n.unit_id = u.id and n.source_request_id = new.id)
              <> (new.requested_units->u.source_request_unit_index->>'nodes')::integer
          )
      ) then
        raise exception 'request_node_quantity_not_fulfilled' using errcode = 'P0001',
          detail = 'Each requested unit must have its specified node count.';
      end if;
      if new.requested_units is null and new.requested_nodes_per_unit is not null and exists (
        select 1 from public.units u
        where u.source_request_id = new.id
          and (select count(*) from public.nodes n where n.unit_id = u.id and n.source_request_id = new.id) <> new.requested_nodes_per_unit
      ) then
        raise exception 'request_node_quantity_not_fulfilled' using errcode = 'P0001';
      end if;
    else
      select count(*) into actual_count from public.nodes where source_request_id = new.id;
      if actual_count <> new.requested_count then
        raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001',
          detail = format('Expected %s nodes, found %s.', new.requested_count, actual_count);
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_request_fulfillment() from public, anon, authenticated, service_role;
