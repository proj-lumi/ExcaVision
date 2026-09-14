-- Installation planning names every monitoring unit and creates its draft unit
-- record in the same transaction. Staff proceeds directly from the plan to
-- hardware setup instead of repeating a separate create-and-name step.

alter table public.service_request_targets
  add column if not exists planned_unit_name text,
  add column if not exists plan_position smallint;

alter table public.service_request_targets
  drop constraint if exists service_request_targets_planned_unit_name_check;
alter table public.service_request_targets
  add constraint service_request_targets_planned_unit_name_check
  check (planned_unit_name is null or length(trim(planned_unit_name)) between 2 and 100);

alter table public.service_request_targets
  drop constraint if exists service_request_targets_plan_position_check;
alter table public.service_request_targets
  add constraint service_request_targets_plan_position_check
  check (plan_position is null or plan_position between 1 and 64);

-- Preserve names and stable ordering for units created through the older flow.
with ranked_targets as (
  select
    t.id,
    p.name as unit_name,
    row_number() over (
      partition by t.service_request_id
      order by t.created_at, t.id
    )::smallint as unit_position
  from public.service_request_targets t
  left join public.pipes p on p.id = t.created_pipe_id
  where t.target_kind = 'new_unit'
)
update public.service_request_targets t
set planned_unit_name = coalesce(t.planned_unit_name, ranked_targets.unit_name),
    plan_position = coalesce(t.plan_position, ranked_targets.unit_position)
from ranked_targets
where ranked_targets.id = t.id;

create or replace function public.admin_save_installation_unit_plan(
  p_request_id uuid,
  p_units jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  unit_plan jsonb;
  unit_name text;
  normalized_names text[] := '{}'::text[];
  previous_pipe_ids uuid[];
  new_pipe_id uuid;
  first_pipe_id uuid;
  unit_position smallint := 0;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array'
      or jsonb_array_length(p_units) < 1 or jsonb_array_length(p_units) > 64 then
    raise exception 'add between 1 and 64 monitoring units';
  end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request installation' then
    raise exception 'only installation requests can have an installation unit plan';
  end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if source_request.created_site_id is null then raise exception 'create the site before planning monitoring units'; end if;

  select array_agg(t.created_pipe_id) filter (where t.created_pipe_id is not null)
  into previous_pipe_ids
  from public.service_request_targets t
  where t.service_request_id = p_request_id;

  if exists (
    select 1
    from public.service_request_targets t
    left join public.pipes p on p.id = t.created_pipe_id
    where t.service_request_id = p_request_id
      and (
        t.work_plan_confirmed
        or t.added_node_count > 0
        or (t.created_pipe_id is not null and p.deployment_status is distinct from 'planning')
        or exists (select 1 from public.sensor_nodes n where n.pipe_id = t.created_pipe_id)
      )
  ) then
    raise exception 'the installation unit plan cannot change after hardware setup starts';
  end if;

  -- Validate the complete plan before changing any records.
  for unit_plan in select value from jsonb_array_elements(p_units)
  loop
    unit_name := trim(coalesce(unit_plan->>'unit_name', ''));
    if length(unit_name) < 2 or length(unit_name) > 100 then
      raise exception 'every monitoring unit needs a name between 2 and 100 characters';
    end if;
    if lower(unit_name) = any(normalized_names) then
      raise exception 'monitoring unit names must be unique within the plan';
    end if;
    normalized_names := array_append(normalized_names, lower(unit_name));
  end loop;

  if exists (
    select 1
    from public.pipes p
    where p.site_id = source_request.created_site_id
      and p.cancelled_at is null
      and lower(p.name) = any(normalized_names)
      and not (p.id = any(coalesce(previous_pipe_ids, '{}'::uuid[])))
  ) then
    raise exception 'a monitoring unit at this site already uses one of these names';
  end if;

  -- Replace an untouched draft plan atomically.
  update public.service_requests
  set created_pipe_id = null
  where id = p_request_id;

  delete from public.service_request_targets
  where service_request_id = p_request_id;

  if previous_pipe_ids is not null then
    delete from public.pipes
    where id = any(previous_pipe_ids);
  end if;

  for unit_plan in select value from jsonb_array_elements(p_units)
  loop
    unit_position := unit_position + 1;
    unit_name := trim(unit_plan->>'unit_name');

    insert into public.pipes (site_id, name, expected_node_count)
    values (source_request.created_site_id, unit_name, 1)
    returning id into new_pipe_id;

    first_pipe_id := coalesce(first_pipe_id, new_pipe_id);

    insert into public.service_request_targets (
      service_request_id,
      target_kind,
      operation,
      site_id,
      requested_node_count,
      created_pipe_id,
      planned_unit_name,
      plan_position,
      work_plan_confirmed
    ) values (
      p_request_id,
      'new_unit',
      'install_unit',
      source_request.created_site_id,
      1,
      new_pipe_id,
      unit_name,
      unit_position,
      false
    );
  end loop;

  update public.service_requests
  set created_pipe_id = first_pipe_id,
      fulfillment_path = 'multi_unit_service',
      service_status = 'in_progress',
      updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_save_installation_unit_plan(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_installation_unit_plan(uuid, jsonb) to authenticated;

-- Retire the count-only entry point so old clients cannot create unnamed plans.
revoke execute on function public.admin_set_installation_unit_count(uuid, smallint) from authenticated;

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
  t.completed_by,
  t.planned_unit_name,
  t.plan_position
from public.service_request_targets t
join public.sites s on s.id = t.site_id
left join public.pipes p on p.id = t.pipe_id
left join public.pipes created_pipe on created_pipe.id = t.created_pipe_id;
