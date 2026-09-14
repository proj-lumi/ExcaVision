-- Repair requests may target multiple existing monitoring units.
-- Targets share the multi-target table but declare their operation explicitly.

alter table public.service_request_targets
  add column if not exists operation text not null default 'expand_nodes'
    check (operation in ('expand_nodes', 'replace_nodes'));

create or replace function public.admin_save_repair_targets(
  p_request_id uuid,
  p_targets jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  target jsonb;
  target_pipe_id uuid;
  requested_count smallint;
  target_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into source_request from public.service_requests where id = p_request_id for update;
  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request repair' then raise exception 'only repair requests can have repair targets'; end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) < 1 then
    raise exception 'add at least one monitoring unit';
  end if;
  if exists (
    select 1 from public.service_request_targets
    where service_request_id = p_request_id
      and (added_node_count > 0 or created_pipe_id is not null)
  ) then raise exception 'repair targets cannot be changed after replacement starts'; end if;

  delete from public.service_request_targets where service_request_id = p_request_id;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_pipe_id := nullif(target->>'pipe_id', '')::uuid;
    requested_count := coalesce(nullif(target->>'requested_node_count', '')::smallint, 1);
    if target_pipe_id is null then raise exception 'select a monitoring unit for every repair target'; end if;
    if requested_count < 1 or requested_count > 64 then raise exception 'each repair target must include between 1 and 64 nodes'; end if;
    select site_id into target_site_id from public.pipes where id = target_pipe_id and deployment_status = 'ready';
    if target_site_id is null then raise exception 'every repair target must be an active monitoring unit'; end if;

    insert into public.service_request_targets (
      service_request_id, target_kind, operation, site_id, pipe_id, requested_node_count
    ) values (
      p_request_id, 'existing_unit', 'replace_nodes', target_site_id, target_pipe_id, requested_count
    );
  end loop;

  update public.service_requests
  set fulfillment_path = 'multi_unit_service',
      target_site_id = null,
      target_pipe_id = null,
      service_status = 'in_progress',
      updated_at = now()
  where id = p_request_id;
end;
$$;

create or replace function public.admin_add_node_to_service_target(
  p_target_id uuid,
  p_registry_id uuid,
  p_position smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.service_request_targets%rowtype;
  source_request public.service_requests%rowtype;
  registry public.manufactured_nodes%rowtype;
  current_unit public.pipes%rowtype;
  new_node_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_position < 1 then raise exception 'position must be at least 1'; end if;

  select t.* into target from public.service_request_targets t where t.id = p_target_id for update;
  if not found or target.target_kind <> 'existing_unit' or target.operation <> 'expand_nodes' then
    raise exception 'existing-unit expansion target not found';
  end if;
  if target.added_node_count >= target.requested_node_count then raise exception 'this target has received all requested nodes'; end if;

  select r.* into source_request from public.service_requests r where r.id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then raise exception 'service request is not ready for delivery'; end if;
  select * into current_unit from public.pipes where id = target.pipe_id and deployment_status = 'ready' for update;
  if not found then raise exception 'target monitoring unit is not active'; end if;
  select * into registry from public.manufactured_nodes where id = p_registry_id for update;
  if not found or registry.status <> 'manufactured' or registry.assigned_site_id is not null or registry.assigned_pipe_id is not null or registry.deployed_node_id is not null then raise exception 'available manufactured node not found'; end if;
  if exists (select 1 from public.sensor_nodes where pipe_id = target.pipe_id and position_in_pipe = p_position) then raise exception 'monitoring-unit position is already occupied'; end if;

  insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values (target.pipe_id, p_position, registry.mac_addr, false)
  returning id into new_node_id;
  insert into public.sensors (node_id, channel, label) values (new_node_id, 7, 'S1'), (new_node_id, 3, 'S2'), (new_node_id, 5, 'S3'), (new_node_id, 1, 'S4');
  update public.manufactured_nodes set assigned_site_id = current_unit.site_id, assigned_pipe_id = target.pipe_id, position_in_pipe = p_position, is_gateway = false, deployed_node_id = new_node_id, status = 'deployed' where id = p_registry_id;
  insert into public.service_request_target_nodes (target_id, sensor_node_id, manufactured_node_id) values (p_target_id, new_node_id, p_registry_id);
  update public.service_request_targets set added_node_count = added_node_count + 1 where id = p_target_id;
  update public.pipes set expected_node_count = expected_node_count + 1 where id = target.pipe_id;
end;
$$;

create or replace function public.admin_replace_node_for_target(
  p_target_id uuid,
  p_sensor_node_id uuid,
  p_replacement_registry_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.service_request_targets%rowtype;
  source_request public.service_requests%rowtype;
  replacement_node_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select t.* into target from public.service_request_targets t where t.id = p_target_id for update;
  if not found or target.target_kind <> 'existing_unit' or target.operation <> 'replace_nodes' then raise exception 'repair target not found'; end if;
  if target.added_node_count >= target.requested_node_count then raise exception 'this repair target is complete'; end if;
  if not exists (select 1 from public.sensor_nodes where id = p_sensor_node_id and pipe_id = target.pipe_id) then raise exception 'node is not part of this repair target unit'; end if;
  select * into source_request from public.service_requests where id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then raise exception 'service request is not ready for delivery'; end if;

  perform public.admin_replace_node(target.pipe_id, p_sensor_node_id, p_replacement_registry_id);
  select deployed_node_id into replacement_node_id from public.manufactured_nodes where id = p_replacement_registry_id;
  insert into public.service_request_target_nodes (target_id, sensor_node_id, manufactured_node_id) values (p_target_id, replacement_node_id, p_replacement_registry_id);
  update public.service_request_targets set added_node_count = added_node_count + 1 where id = p_target_id;
end;
$$;

revoke all on function public.admin_save_repair_targets(uuid, jsonb) from public, anon;
revoke all on function public.admin_replace_node_for_target(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_save_repair_targets(uuid, jsonb) to authenticated;
grant execute on function public.admin_replace_node_for_target(uuid, uuid, uuid) to authenticated;
