-- Apply per-unit specifications to both customer add-unit requests and new
-- landing installation requests.
create or replace function private.assign_node_for_add_unit_request_impl(
  target_node_id uuid,
  target_request_id uuid,
  target_unit_id uuid
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  req public.service_requests%rowtype;
  node_row public.nodes%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into req
  from public.service_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if req.request_type not in ('add_unit', 'site_installation') or req.status <> 'open' then
    raise exception 'request_not_open_for_unit_node_assignment' using errcode = 'P0001';
  end if;
  if req.requested_units is null then
    raise exception 'requested_units_missing' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.units
    where id = target_unit_id
      and site_id = req.site_id
      and source_request_id = req.id
      and archived_at is null
  ) then
    raise exception 'request_unit_unavailable' using errcode = 'P0001';
  end if;

  select * into node_row from public.nodes where id = target_node_id;
  if not found then raise exception 'node_not_found' using errcode = 'P0001'; end if;
  if node_row.source_request_id = req.id and node_row.unit_id = target_unit_id then return; end if;
  if node_row.status <> 'unassigned' or node_row.unit_id is not null then
    raise exception 'node_not_available' using errcode = 'P0001';
  end if;

  update public.nodes set source_request_id = req.id where id = target_node_id;
  perform private.assign_node_impl(target_node_id, target_unit_id);
end;
$$;

-- The public signature is unchanged; only its implementation now accepts
-- installation requests as well as add-unit requests.

create or replace function private.enforce_add_unit_request_unit_spec()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions as $$
declare
  specs jsonb;
  expected_name text;
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
    and request_type in ('add_unit', 'site_installation')
    and status = 'open'
    and site_id = new.site_id;
  if specs is null then return new; end if;

  if new.source_request_unit_index is null
    or new.source_request_unit_index >= jsonb_array_length(specs) then
    raise exception 'requested_unit_index_invalid' using errcode = 'P0001';
  end if;

  expected_name := specs->new.source_request_unit_index->>'name';
  if lower(trim(new.name)) <> lower(trim(expected_name)) then
    raise exception 'requested_unit_name_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

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
    and request_type in ('add_unit', 'site_installation')
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
    select case
      when request_type = 'add_unit' then requested_count
      when request_type = 'site_installation' and requested_units is not null then jsonb_array_length(requested_units)
      else null
    end into expected_count
    from public.service_requests
    where id = new.source_request_id
      and request_type in ('add_unit', 'site_installation')
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

  if new.status = 'completed' and old.status <> 'completed' and new.request_type in ('add_unit', 'site_installation', 'add_nodes') then
    if new.request_type = 'add_nodes' then
      if new.requested_count is null then return new; end if;
      select count(*) into actual_count from public.nodes where source_request_id = new.id;
      if actual_count <> new.requested_count then
        raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001',
          detail = format('Expected %s nodes, found %s.', new.requested_count, actual_count);
      end if;
      return new;
    end if;

    if new.request_type = 'add_unit' and new.requested_count is not null then
      select count(*) into actual_count from public.units where source_request_id = new.id;
      if actual_count <> new.requested_count then
        raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001',
          detail = format('Expected %s units, found %s.', new.requested_count, actual_count);
      end if;
    elsif new.request_type = 'site_installation' and new.requested_units is not null then
      select count(*) into actual_count from public.units where source_request_id = new.id;
      if actual_count <> jsonb_array_length(new.requested_units) then
        raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001';
      end if;
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
  end if;
  return new;
end;
$$;
