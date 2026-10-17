-- An add-unit request needs both its number of units and its node count for
-- each unit. The Gateway counts as Node 1, and one Setup Code supports up to
-- 16 nodes, so keep this value within that physical packet limit.
alter table public.service_requests
  add column requested_nodes_per_unit smallint;

alter table public.service_requests
  add constraint service_requests_requested_nodes_per_unit_check
  check (requested_nodes_per_unit is null or requested_nodes_per_unit between 1 and 16);

comment on column public.service_requests.requested_nodes_per_unit is
  'Requested nodes in each new monitoring unit. Includes the Gateway. Null for legacy/non-add-unit requests.';

-- Keep earlier browser versions working through the existing five-argument
-- RPC, while new clients submit both quantities through this overload.
create function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_nodes_per_unit smallint,
  target_details text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  request_id uuid;
begin
  if target_request_type = 'add_unit' then
    if target_requested_nodes_per_unit is null or target_requested_nodes_per_unit not between 1 and 16 then
      raise exception 'requested_nodes_per_unit_required' using errcode = '22023';
    end if;
  elsif target_requested_nodes_per_unit is not null then
    raise exception 'requested_nodes_per_unit_not_allowed' using errcode = '22023';
  end if;

  request_id := private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    target_unit_id,
    target_requested_count,
    target_details
  );

  update public.service_requests
  set requested_nodes_per_unit = target_requested_nodes_per_unit
  where id = request_id;

  return request_id;
end;
$$;

create function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_nodes_per_unit smallint,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    target_unit_id,
    target_requested_count,
    target_requested_nodes_per_unit,
    target_details
  )
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, smallint, text)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, smallint, text)
  to authenticated;

-- Only this RPC can attach a newly registered node to an open add-unit
-- request. It records the request source before assigning the node, allowing
-- the trigger below to enforce the per-unit cap atomically.
create function private.assign_node_for_add_unit_request_impl(
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
  if req.request_type <> 'add_unit' or req.status <> 'open' then
    raise exception 'request_not_open_for_add_unit_node_assignment' using errcode = 'P0001';
  end if;
  if req.requested_nodes_per_unit is null then
    raise exception 'requested_nodes_per_unit_missing' using errcode = 'P0001';
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

create function public.assign_node_for_add_unit_request(
  target_node_id uuid,
  target_request_id uuid,
  target_unit_id uuid
) returns void
language sql security invoker set search_path = '' as $$
  select private.assign_node_for_add_unit_request_impl(target_node_id, target_request_id, target_unit_id)
$$;

revoke all on function private.assign_node_for_add_unit_request_impl(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.assign_node_for_add_unit_request_impl(uuid, uuid, uuid) to authenticated;
revoke all on function public.assign_node_for_add_unit_request(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_node_for_add_unit_request(uuid, uuid, uuid) to authenticated;

-- A request-created unit can only receive the requested number of nodes while
-- its source request is open. Later add-node requests remain valid because
-- their source add-unit request is already completed.
create function private.enforce_add_unit_node_quantity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions as $$
declare
  source_request_id uuid;
  expected_count integer;
  actual_count integer;
begin
  if new.unit_id is null then return new; end if;
  if tg_op = 'UPDATE'
    and new.unit_id is not distinct from old.unit_id
    and new.source_request_id is not distinct from old.source_request_id then
    return new;
  end if;

  select u.source_request_id into source_request_id
  from public.units u
  where u.id = new.unit_id;
  if source_request_id is null then return new; end if;

  select requested_nodes_per_unit into expected_count
  from public.service_requests
  where id = source_request_id
    and request_type = 'add_unit'
    and status = 'open';
  if expected_count is null then return new; end if;
  if new.source_request_id is distinct from source_request_id then
    raise exception 'node_source_request_required' using errcode = 'P0001';
  end if;

  select count(*) into actual_count
  from public.nodes
  where unit_id = new.unit_id
    and source_request_id = source_request_id
    and id <> new.id;
  if actual_count >= expected_count then
    raise exception 'requested_nodes_per_unit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_add_unit_node_quantity() from public, anon, authenticated, service_role;

drop trigger if exists nodes_enforce_add_unit_node_quantity on public.nodes;
create trigger nodes_enforce_add_unit_node_quantity
before insert or update of unit_id, source_request_id on public.nodes
for each row execute function private.enforce_add_unit_node_quantity();

-- Completion of a newly submitted add-unit request requires both the exact
-- number of units and the requested node count in every one of those units.
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
    select count(*) into actual_count
    from public.units
    where source_request_id = new.source_request_id;
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
      if new.requested_nodes_per_unit is not null and exists (
        select 1
        from public.units u
        where u.source_request_id = new.id
          and (
            select count(*)
            from public.nodes n
            where n.unit_id = u.id and n.source_request_id = new.id
          ) <> new.requested_nodes_per_unit
      ) then
        raise exception 'request_node_quantity_not_fulfilled' using errcode = 'P0001',
          detail = format('Every requested unit needs exactly %s nodes.', new.requested_nodes_per_unit);
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
