-- Backfill quantities for legacy customer requests that used the established
-- human-readable prefix before requested_count was introduced.
update public.service_requests
set requested_count = substring(lower(details) from 'add[[:space:]]+([0-9]{1,2})[[:space:]]+nodes?\.')::smallint
where request_type = 'add_nodes'
  and requested_count is null
  and details ~* 'add[[:space:]]+[0-9]{1,2}[[:space:]]+nodes?\.';

update public.service_requests
set requested_count = substring(lower(details) from 'add[[:space:]]+([0-9]{1,2})[[:space:]]+monitoring[[:space:]]+units?\.')::smallint
where request_type = 'add_unit'
  and requested_count is null
  and details ~* 'add[[:space:]]+[0-9]{1,2}[[:space:]]+monitoring[[:space:]]+units?\.';

alter table public.nodes
  add column source_request_id uuid references public.service_requests(id) on delete set null;

create index nodes_source_request_id_idx
  on public.nodes(source_request_id)
  where source_request_id is not null;

comment on column public.nodes.source_request_id is
  'Open add-nodes request that authorized this node assignment. Null for commissioning and legacy nodes.';

create or replace function private.assign_node_for_request_impl(
  target_node_id uuid,
  target_request_id uuid
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  req public.service_requests%rowtype;
  node_row public.nodes%rowtype;
  assigned_count integer;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into req
  from public.service_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if req.request_type <> 'add_nodes' or req.status <> 'open' then
    raise exception 'request_not_open_for_node_assignment' using errcode = 'P0001';
  end if;
  if req.target_unit_id is null or req.requested_count is null then
    raise exception 'request_target_or_quantity_missing' using errcode = 'P0001';
  end if;

  select * into node_row from public.nodes where id = target_node_id;
  if not found then raise exception 'node_not_found' using errcode = 'P0001'; end if;
  if node_row.source_request_id = req.id then return; end if;
  if node_row.status <> 'unassigned' or node_row.unit_id is not null then
    raise exception 'node_not_available' using errcode = 'P0001';
  end if;

  select count(*) into assigned_count
  from public.nodes
  where source_request_id = req.id;
  if assigned_count >= req.requested_count then
    raise exception 'requested_node_count_reached' using errcode = 'P0001';
  end if;

  perform private.assign_node_impl(target_node_id, req.target_unit_id);
  update public.nodes set source_request_id = req.id where id = target_node_id;
end;
$$;

create or replace function public.assign_node_for_request(
  target_node_id uuid,
  target_request_id uuid
) returns void
language sql security invoker set search_path = '' as $$
  select private.assign_node_for_request_impl(target_node_id, target_request_id)
$$;

revoke all on function private.assign_node_for_request_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.assign_node_for_request_impl(uuid, uuid) to authenticated;
revoke all on function public.assign_node_for_request(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_node_for_request(uuid, uuid) to authenticated;

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
    else
      select count(*) into actual_count from public.nodes where source_request_id = new.id;
    end if;
    if actual_count <> new.requested_count then
      raise exception 'request_quantity_not_fulfilled' using errcode = 'P0001',
        detail = format('Expected %s, found %s.', new.requested_count, actual_count);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_request_fulfillment() from public, anon, authenticated, service_role;

drop trigger if exists units_enforce_source_request_quantity on public.units;
create trigger units_enforce_source_request_quantity
before insert or update of source_request_id on public.units
for each row execute function private.enforce_request_fulfillment();

drop trigger if exists service_requests_enforce_fulfillment_before_completion on public.service_requests;
create trigger service_requests_enforce_fulfillment_before_completion
before update of status on public.service_requests
for each row execute function private.enforce_request_fulfillment();
