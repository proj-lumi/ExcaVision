-- Request routing chooses destinations only. Technical node quantities belong to
-- the execution plan created after routing.

alter table public.service_request_targets
  add column if not exists work_plan_confirmed boolean not null default false,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null;

-- New-unit targets are installation work, including rows created before the
-- operation field was assigned explicitly.
update public.service_request_targets
set operation = 'install_unit'
where target_kind = 'new_unit';

-- Existing rows already received an explicit quantity through the old routing
-- form. Preserve that quantity as an approved execution plan during migration.
update public.service_request_targets
set work_plan_confirmed = true
where target_kind = 'existing_unit';

-- Preserve already-finished repairs when switching from count-based completion
-- to explicit completion.
update public.service_request_targets
set completed_at = coalesce(completed_at, now())
where operation = 'replace_nodes'
  and added_node_count > 0
  and added_node_count >= requested_node_count;

create or replace function public.admin_save_more_coverage_targets(
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
  target_kind text;
  target_site_id uuid;
  target_pipe_id uuid;
  pipe_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into source_request from public.service_requests where id = p_request_id for update;
  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request more sensors' then
    raise exception 'only more coverage requests can have coverage targets';
  end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) < 1 then
    raise exception 'add at least one coverage destination';
  end if;
  if exists (
    select 1 from public.service_request_targets
    where service_request_id = p_request_id
      and (added_node_count > 0 or created_pipe_id is not null or work_plan_confirmed)
  ) then
    raise exception 'coverage destinations cannot be changed after planning starts';
  end if;

  delete from public.service_request_targets where service_request_id = p_request_id;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_kind := target->>'target_kind';
    target_site_id := nullif(target->>'site_id', '')::uuid;
    target_pipe_id := nullif(target->>'pipe_id', '')::uuid;

    if target_kind = 'existing_unit' then
      if target_pipe_id is null then raise exception 'select a monitoring unit for every expansion destination'; end if;
      select site_id into pipe_site_id
      from public.pipes
      where id = target_pipe_id and deployment_status = 'ready' and cancelled_at is null;
      if pipe_site_id is null then raise exception 'every expansion destination must be an active monitoring unit'; end if;
      insert into public.service_request_targets (
        service_request_id, target_kind, operation, site_id, pipe_id,
        requested_node_count, work_plan_confirmed
      ) values (
        p_request_id, 'existing_unit', 'expand_nodes', pipe_site_id,
        target_pipe_id, 1, false
      );
    elsif target_kind = 'new_unit' then
      if target_site_id is null or not exists (
        select 1 from public.sites where id = target_site_id and archived_at is null
      ) then
        raise exception 'select an existing site for every new monitoring unit';
      end if;
      insert into public.service_request_targets (
        service_request_id, target_kind, operation, site_id,
        requested_node_count, work_plan_confirmed
      ) values (
        p_request_id, 'new_unit', 'install_unit', target_site_id, 1, false
      );
    else
      raise exception 'choose a valid coverage destination type';
    end if;
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
      and (added_node_count > 0 or completed_at is not null)
  ) then raise exception 'repair destinations cannot be changed after replacement starts'; end if;

  delete from public.service_request_targets where service_request_id = p_request_id;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_pipe_id := nullif(target->>'pipe_id', '')::uuid;
    if target_pipe_id is null then raise exception 'select a monitoring unit for every repair destination'; end if;
    select site_id into target_site_id
    from public.pipes
    where id = target_pipe_id and deployment_status = 'ready' and cancelled_at is null;
    if target_site_id is null then raise exception 'every repair destination must be an active monitoring unit'; end if;

    insert into public.service_request_targets (
      service_request_id, target_kind, operation, site_id, pipe_id,
      requested_node_count, work_plan_confirmed
    ) values (
      p_request_id, 'existing_unit', 'replace_nodes', target_site_id,
      target_pipe_id, 1, true
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

create or replace function public.admin_plan_service_target(
  p_target_id uuid,
  p_planned_node_count smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.service_request_targets%rowtype;
  source_request public.service_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_planned_node_count < 1 or p_planned_node_count > 64 then
    raise exception 'planned node count must be between 1 and 64';
  end if;

  select * into target
  from public.service_request_targets
  where id = p_target_id
  for update;

  if not found or target.target_kind <> 'existing_unit' or target.operation <> 'expand_nodes' then
    raise exception 'existing-unit coverage target not found';
  end if;
  if target.completed_at is not null then raise exception 'this coverage target is already complete'; end if;
  if p_planned_node_count < target.added_node_count then
    raise exception 'planned node count cannot be lower than completed additions';
  end if;

  select * into source_request
  from public.service_requests
  where id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for planning';
  end if;

  update public.service_request_targets
  set requested_node_count = p_planned_node_count,
      work_plan_confirmed = true
  where id = p_target_id;
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

  select * into target from public.service_request_targets where id = p_target_id for update;
  if not found or target.target_kind <> 'existing_unit' or target.operation <> 'expand_nodes' then
    raise exception 'existing-unit coverage target not found';
  end if;
  if not target.work_plan_confirmed then raise exception 'confirm the coverage plan before assigning hardware'; end if;
  if target.completed_at is not null or target.added_node_count >= target.requested_node_count then
    raise exception 'this coverage target is complete';
  end if;

  select * into source_request from public.service_requests where id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for delivery';
  end if;
  select * into current_unit from public.pipes where id = target.pipe_id and deployment_status = 'ready' and cancelled_at is null for update;
  if not found then raise exception 'target monitoring unit is not active'; end if;
  select * into registry from public.manufactured_nodes where id = p_registry_id for update;
  if not found or registry.status <> 'manufactured'
      or registry.assigned_site_id is not null or registry.assigned_pipe_id is not null
      or registry.deployed_node_id is not null then
    raise exception 'available manufactured node not found';
  end if;
  if exists (select 1 from public.sensor_nodes where pipe_id = target.pipe_id and position_in_pipe = p_position) then
    raise exception 'monitoring-unit position is already occupied';
  end if;

  insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values (target.pipe_id, p_position, registry.mac_addr, false)
  returning id into new_node_id;
  insert into public.sensors (node_id, channel, label)
  values (new_node_id, 7, 'S1'), (new_node_id, 3, 'S2'), (new_node_id, 5, 'S3'), (new_node_id, 1, 'S4');
  update public.manufactured_nodes
  set assigned_site_id = current_unit.site_id,
      assigned_pipe_id = target.pipe_id,
      position_in_pipe = p_position,
      is_gateway = false,
      deployed_node_id = new_node_id,
      status = 'deployed'
  where id = p_registry_id;
  insert into public.service_request_target_nodes (target_id, sensor_node_id, manufactured_node_id)
  values (p_target_id, new_node_id, p_registry_id);
  update public.service_request_targets
  set added_node_count = added_node_count + 1
  where id = p_target_id;
  update public.pipes
  set expected_node_count = expected_node_count + 1
  where id = target.pipe_id;
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
  select * into target from public.service_request_targets where id = p_target_id for update;
  if not found or target.target_kind <> 'existing_unit' or target.operation <> 'replace_nodes' then
    raise exception 'repair target not found';
  end if;
  if target.completed_at is not null then raise exception 'this repair target is complete'; end if;
  if not exists (select 1 from public.sensor_nodes where id = p_sensor_node_id and pipe_id = target.pipe_id) then
    raise exception 'node is not part of this repair target unit';
  end if;
  select * into source_request from public.service_requests where id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for delivery';
  end if;

  perform public.admin_replace_node(target.pipe_id, p_sensor_node_id, p_replacement_registry_id);
  select deployed_node_id into replacement_node_id from public.manufactured_nodes where id = p_replacement_registry_id;
  insert into public.service_request_target_nodes (target_id, sensor_node_id, manufactured_node_id)
  values (p_target_id, replacement_node_id, p_replacement_registry_id);
  update public.service_request_targets
  set added_node_count = added_node_count + 1,
      requested_node_count = greatest(requested_node_count, added_node_count + 1)
  where id = p_target_id;
end;
$$;

create or replace function public.admin_complete_service_target(p_target_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.service_request_targets%rowtype;
  source_request public.service_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into target from public.service_request_targets where id = p_target_id for update;
  if not found or target.operation <> 'replace_nodes' then raise exception 'repair target not found'; end if;
  if target.completed_at is not null then raise exception 'this repair target is already complete'; end if;
  if target.added_node_count < 1 then raise exception 'replace at least one node before finishing this repair'; end if;

  select * into source_request from public.service_requests where id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for completion';
  end if;

  update public.service_request_targets
  set completed_at = now(), completed_by = auth.uid()
  where id = p_target_id;
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
  select * into service_request from public.service_requests where id = p_request_id for update;
  if not found then raise exception 'request no longer exists'; end if;
  if service_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if service_request.service_status <> 'in_progress' then raise exception 'service request is not in progress'; end if;

  if service_request.fulfillment_path = 'multi_unit_service' then
    if not exists (
      select 1 from public.service_request_targets where service_request_id = p_request_id
    ) then
      raise exception 'add at least one service destination before completing the request';
    end if;
    if exists (
      select 1
      from public.service_request_targets t
      where t.service_request_id = p_request_id
        and (
          (t.target_kind = 'new_unit' and (
            t.created_pipe_id is null
            or not exists (
              select 1 from public.pipes p
              where p.id = t.created_pipe_id
                and p.deployment_status = 'ready'
                and p.cancelled_at is null
            )
          ))
          or (t.target_kind = 'existing_unit' and t.operation = 'expand_nodes' and (
            not t.work_plan_confirmed
            or t.added_node_count < t.requested_node_count
          ))
          or (t.target_kind = 'existing_unit' and t.operation = 'replace_nodes' and t.completed_at is null)
        )
    ) then
      raise exception 'complete every service target before closing the request';
    end if;
  elsif service_request.fulfillment_path not in ('repair_existing_unit', 'expand_existing_unit') then
    raise exception 'this request does not use a service route';
  elsif service_request.target_pipe_id is null
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

-- Keep the installation hardware panel as the source of truth for new-unit
-- quantities and mark its linked target plan as confirmed atomically.
create or replace function public.admin_save_installation_hardware_setup(
  p_pipe_id uuid,
  p_expected_node_count smallint,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pipe public.pipes%rowtype;
  manifest_count integer;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_expected_node_count < 1 or p_expected_node_count > 64 then
    raise exception 'planned node count must be between 1 and 64';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then
    raise exception 'manifest must be an array';
  end if;

  select * into current_pipe
  from public.pipes
  where id = p_pipe_id
  for update;
  if not found or current_pipe.deployment_status <> 'planning' then
    raise exception 'planning deployment not found';
  end if;

  manifest_count := jsonb_array_length(p_manifest);
  if manifest_count > p_expected_node_count then
    raise exception 'planned node count cannot be lower than assigned node count';
  end if;

  if manifest_count = 0 then
    if exists (
      select 1 from public.readings r
      join public.sensors s on s.id = r.sensor_id
      join public.sensor_nodes n on n.id = s.node_id
      where n.pipe_id = p_pipe_id
    ) or exists (
      select 1 from public.baselines b
      join public.sensors s on s.id = b.sensor_id
      join public.sensor_nodes n on n.id = s.node_id
      where n.pipe_id = p_pipe_id
    ) then
      raise exception 'hardware setup cannot be emptied after sensor history exists';
    end if;

    delete from public.sensor_nodes where pipe_id = p_pipe_id;
    update public.manufactured_nodes
    set assigned_site_id = null,
        assigned_pipe_id = null,
        position_in_pipe = null,
        is_gateway = false,
        deployed_node_id = null,
        status = 'manufactured'
    where assigned_pipe_id = p_pipe_id;
  end if;

  update public.pipes
  set expected_node_count = p_expected_node_count,
      plan_confirmed = true
  where id = p_pipe_id;

  update public.service_request_targets
  set requested_node_count = p_expected_node_count,
      work_plan_confirmed = true
  where created_pipe_id = p_pipe_id
    and operation = 'install_unit';

  if manifest_count > 0 then
    perform public.admin_update_deployment_manifest(p_pipe_id, p_manifest);
  end if;
end;
$$;

create or replace view public.admin_service_request_target_list
with (security_invoker = true)
as
select
  t.id,
  t.service_request_id,
  t.target_kind,
  t.site_id,
  t.pipe_id,
  t.requested_node_count,
  t.added_node_count,
  t.created_pipe_id,
  t.created_at,
  t.operation,
  s.name as site_name,
  p.name as pipe_name,
  created_pipe.name as created_pipe_name,
  case when created_pipe.cancelled_at is not null then 'cancelled' else created_pipe.deployment_status end as created_pipe_status,
  t.work_plan_confirmed,
  t.completed_at,
  t.completed_by
from public.service_request_targets t
join public.sites s on s.id = t.site_id
left join public.pipes p on p.id = t.pipe_id
left join public.pipes created_pipe on created_pipe.id = t.created_pipe_id;

revoke all on function public.admin_plan_service_target(uuid, smallint) from public, anon;
revoke all on function public.admin_complete_service_target(uuid) from public, anon;
grant execute on function public.admin_plan_service_target(uuid, smallint) to authenticated;
grant execute on function public.admin_complete_service_target(uuid) to authenticated;
