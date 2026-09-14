-- Give approved repair and coverage requests an executable service action.
-- Active monitoring units can receive additional non-gateway nodes without
-- reopening commissioning or changing their existing gateway.

alter table public.service_requests
  add column if not exists service_status text not null default 'pending'
    check (service_status in ('pending', 'in_progress', 'completed')),
  add column if not exists service_completed_at timestamptz,
  add column if not exists service_completed_by uuid references public.profiles(id) on delete set null;

update public.service_requests
set service_status = 'in_progress'
where fulfillment_path in ('repair_existing_unit', 'expand_existing_unit')
  and service_status = 'pending';

create or replace function public.admin_add_node_to_active_unit(
  p_registry_id uuid,
  p_pipe_id uuid,
  p_position smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  registry public.manufactured_nodes%rowtype;
  current_unit public.pipes%rowtype;
  new_node_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_position < 1 then raise exception 'position must be at least 1'; end if;

  select * into current_unit
  from public.pipes
  where id = p_pipe_id and deployment_status = 'ready'
  for update;
  if not found then raise exception 'active monitoring unit not found'; end if;

  select * into registry
  from public.manufactured_nodes
  where id = p_registry_id
  for update;
  if not found or registry.status <> 'manufactured'
      or registry.assigned_site_id is not null
      or registry.assigned_pipe_id is not null
      or registry.deployed_node_id is not null then
    raise exception 'available manufactured node not found';
  end if;
  if exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and position_in_pipe = p_position
  ) then
    raise exception 'monitoring-unit position is already occupied';
  end if;

  insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values (p_pipe_id, p_position, registry.mac_addr, false)
  returning id into new_node_id;

  insert into public.sensors (node_id, channel, label)
  values
    (new_node_id, 7, 'S1'),
    (new_node_id, 3, 'S2'),
    (new_node_id, 5, 'S3'),
    (new_node_id, 1, 'S4');

  update public.manufactured_nodes
  set assigned_site_id = current_unit.site_id,
      assigned_pipe_id = p_pipe_id,
      position_in_pipe = p_position,
      is_gateway = false,
      deployed_node_id = new_node_id,
      status = 'deployed'
  where id = p_registry_id;

  update public.pipes
  set expected_node_count = expected_node_count + 1
  where id = p_pipe_id;
end;
$$;

create or replace function public.admin_complete_service_request(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  service_request public.service_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into service_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if service_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if service_request.fulfillment_path not in ('repair_existing_unit', 'expand_existing_unit') then
    raise exception 'this request does not use a service route';
  end if;
  if service_request.service_status <> 'in_progress' then
    raise exception 'service request is not in progress';
  end if;
  if service_request.target_pipe_id is null
     or not exists (select 1 from public.pipes where id = service_request.target_pipe_id) then
    raise exception 'service destination is unavailable';
  end if;

  update public.service_requests
  set service_status = 'completed',
      service_completed_at = now(),
      service_completed_by = auth.uid(),
      updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_add_node_to_active_unit(uuid, uuid, smallint) from public, anon;
revoke all on function public.admin_complete_service_request(uuid) from public, anon;
grant execute on function public.admin_add_node_to_active_unit(uuid, uuid, smallint) to authenticated;
grant execute on function public.admin_complete_service_request(uuid) to authenticated;
create or replace function public.admin_route_service_request(
  p_request_id uuid,
  p_path text,
  p_site_id uuid default null,
  p_pipe_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  pipe_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if source_request.created_site_id is not null or source_request.created_pipe_id is not null then
    raise exception 'delivery has already started for this request';
  end if;

  if p_path = 'new_installation' then
    update public.service_requests
    set request_type = 'Request installation',
        fulfillment_path = null,
        target_site_id = null,
        target_pipe_id = null,
        service_status = 'pending',
        updated_at = now()
    where id = p_request_id;
    return;
  end if;

  if p_path = 'repair_existing_unit' then
    if source_request.request_type <> 'Request repair' then
      raise exception 'only repair requests can use the repair route';
    end if;
  elsif p_path = 'expand_existing_unit' then
    if source_request.request_type <> 'Request more sensors' then
      raise exception 'only more coverage requests can expand a monitoring unit';
    end if;
  elsif p_path = 'new_unit_existing_site' then
    if source_request.request_type <> 'Request more sensors' then
      raise exception 'only more coverage requests can add a monitoring unit';
    end if;
    if p_site_id is null or not exists (select 1 from public.sites where id = p_site_id) then
      raise exception 'select an existing site';
    end if;

    update public.service_requests
    set fulfillment_path = p_path,
        target_site_id = p_site_id,
        target_pipe_id = null,
        service_status = 'in_progress',
        updated_at = now()
    where id = p_request_id;
    return;
  else
    raise exception 'choose a valid delivery route';
  end if;

  if p_pipe_id is null then raise exception 'select an existing monitoring unit'; end if;
  select site_id into pipe_site_id from public.pipes where id = p_pipe_id;
  if pipe_site_id is null then raise exception 'monitoring unit no longer exists'; end if;

  update public.service_requests
  set fulfillment_path = p_path,
      target_site_id = pipe_site_id,
      target_pipe_id = p_pipe_id,
      service_status = 'in_progress',
      updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_route_service_request(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.admin_route_service_request(uuid, text, uuid, uuid) to authenticated;
