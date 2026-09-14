-- A More coverage request may contain multiple existing-unit expansions and
-- multiple new monitoring units at existing sites.

alter table public.service_requests
  drop constraint if exists service_requests_fulfillment_path_check;

alter table public.service_requests
  add constraint service_requests_fulfillment_path_check
  check (fulfillment_path in (
    'repair_existing_unit',
    'expand_existing_unit',
    'new_unit_existing_site',
    'multi_unit_service'
  ));

create table if not exists public.service_request_targets (
  id                    uuid primary key default gen_random_uuid(),
  service_request_id    uuid not null references public.service_requests(id) on delete cascade,
  target_kind           text not null check (target_kind in ('existing_unit', 'new_unit')),
  site_id               uuid references public.sites(id) on delete restrict,
  pipe_id               uuid references public.pipes(id) on delete restrict,
  requested_node_count  smallint not null default 1 check (requested_node_count between 1 and 64),
  added_node_count      smallint not null default 0 check (added_node_count >= 0),
  created_pipe_id       uuid unique references public.pipes(id) on delete restrict,
  created_at            timestamptz not null default now(),
  check (
    (target_kind = 'existing_unit' and pipe_id is not null and site_id is not null)
    or (target_kind = 'new_unit' and site_id is not null and pipe_id is null)
  ),
  check (added_node_count <= requested_node_count)
);

create index if not exists service_request_targets_request_idx
  on public.service_request_targets (service_request_id, created_at);
create index if not exists service_request_targets_pipe_idx
  on public.service_request_targets (pipe_id);

create table if not exists public.service_request_target_nodes (
  target_id              uuid not null references public.service_request_targets(id) on delete cascade,
  sensor_node_id        uuid not null references public.sensor_nodes(id) on delete restrict,
  manufactured_node_id  uuid not null references public.manufactured_nodes(id) on delete restrict,
  created_at            timestamptz not null default now(),
  primary key (target_id, sensor_node_id),
  unique (manufactured_node_id)
);

alter table public.service_request_targets enable row level security;
alter table public.service_request_target_nodes enable row level security;
create policy "admins manage service request targets"
on public.service_request_targets for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
create policy "admins manage service request target nodes"
on public.service_request_target_nodes for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
grant select, insert, update, delete on public.service_request_targets to authenticated;
grant select, insert, update, delete on public.service_request_target_nodes to authenticated;

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
  requested_count smallint;
  pipe_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into source_request from public.service_requests where id = p_request_id for update;
  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request more sensors' then
    raise exception 'only more coverage requests can have multiple targets';
  end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) < 1 then
    raise exception 'add at least one coverage target';
  end if;
  if exists (
    select 1 from public.service_request_targets
    where service_request_id = p_request_id
      and (added_node_count > 0 or created_pipe_id is not null)
  ) then
    raise exception 'coverage targets cannot be changed after delivery starts';
  end if;

  delete from public.service_request_targets where service_request_id = p_request_id;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_kind := target->>'target_kind';
    target_site_id := nullif(target->>'site_id', '')::uuid;
    target_pipe_id := nullif(target->>'pipe_id', '')::uuid;
    requested_count := coalesce(nullif(target->>'requested_node_count', '')::smallint, 1);

    if requested_count < 1 or requested_count > 64 then
      raise exception 'each target must request between 1 and 64 nodes';
    end if;

    if target_kind = 'existing_unit' then
      if target_pipe_id is null then raise exception 'select a monitoring unit for every expansion target'; end if;
      select site_id into pipe_site_id from public.pipes where id = target_pipe_id;
      if pipe_site_id is null then raise exception 'one selected monitoring unit no longer exists'; end if;
      insert into public.service_request_targets (
        service_request_id, target_kind, site_id, pipe_id, requested_node_count
      ) values (p_request_id, target_kind, pipe_site_id, target_pipe_id, requested_count);
    elsif target_kind = 'new_unit' then
      if target_site_id is null or not exists (select 1 from public.sites where id = target_site_id) then
        raise exception 'select an existing site for every new monitoring unit';
      end if;
      insert into public.service_request_targets (
        service_request_id, target_kind, site_id, requested_node_count
      ) values (p_request_id, target_kind, target_site_id, requested_count);
    else
      raise exception 'choose a valid coverage target type';
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

create or replace function public.admin_create_monitoring_unit_from_target(
  p_target_id uuid,
  p_unit_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.service_request_targets%rowtype;
  source_request public.service_requests%rowtype;
  new_pipe_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if length(trim(p_unit_name)) < 2 then raise exception 'monitoring unit name is required'; end if;

  select t.* into target
  from public.service_request_targets t
  where t.id = p_target_id
  for update;
  if not found or target.target_kind <> 'new_unit' then raise exception 'new monitoring unit target not found'; end if;
  if target.created_pipe_id is not null then raise exception 'this target already has a monitoring unit'; end if;

  select r.* into source_request from public.service_requests r where r.id = target.service_request_id for update;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for delivery';
  end if;

  insert into public.pipes (site_id, name, expected_node_count)
  values (target.site_id, trim(p_unit_name), target.requested_node_count)
  returning id into new_pipe_id;

  update public.service_request_targets set created_pipe_id = new_pipe_id where id = p_target_id;
  return new_pipe_id;
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
  if not found or target.target_kind <> 'existing_unit' then raise exception 'existing-unit target not found'; end if;
  if target.added_node_count >= target.requested_node_count then raise exception 'this target has received all requested nodes'; end if;

  select r.* into source_request from public.service_requests r where r.id = target.service_request_id;
  if source_request.status <> 'approved' or source_request.service_status <> 'in_progress' then
    raise exception 'service request is not ready for delivery';
  end if;

  select * into current_unit from public.pipes where id = target.pipe_id and deployment_status = 'ready' for update;
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
  values
    (new_node_id, 7, 'S1'), (new_node_id, 3, 'S2'),
    (new_node_id, 5, 'S3'), (new_node_id, 1, 'S4');

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

  update public.pipes set expected_node_count = expected_node_count + 1 where id = target.pipe_id;
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
    if exists (
      select 1 from public.service_request_targets
      where service_request_id = p_request_id
        and (
          (target_kind = 'new_unit' and (
            created_pipe_id is null
            or not exists (
              select 1 from public.pipes p
              where p.id = created_pipe_id and p.deployment_status = 'ready'
            )
          ))
          or (target_kind = 'existing_unit' and added_node_count < requested_node_count)
        )
    ) then
      raise exception 'complete every coverage target before closing the request';
    end if;
  elsif service_request.fulfillment_path not in ('repair_existing_unit', 'expand_existing_unit') then
    raise exception 'this request does not use a service route';
  elsif service_request.target_pipe_id is null
     or not exists (select 1 from public.pipes where id = service_request.target_pipe_id) then
    raise exception 'service destination is unavailable';
  end if;

  update public.service_requests
  set service_status = 'completed', service_completed_at = now(), service_completed_by = auth.uid(), updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_save_more_coverage_targets(uuid, jsonb) from public, anon;
revoke all on function public.admin_create_monitoring_unit_from_target(uuid, text) from public, anon;
revoke all on function public.admin_add_node_to_service_target(uuid, uuid, smallint) from public, anon;
grant execute on function public.admin_save_more_coverage_targets(uuid, jsonb) to authenticated;
grant execute on function public.admin_create_monitoring_unit_from_target(uuid, text) to authenticated;
grant execute on function public.admin_add_node_to_service_target(uuid, uuid, smallint) to authenticated;
