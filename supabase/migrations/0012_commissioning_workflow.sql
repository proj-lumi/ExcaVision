-- Workflow-based deployment planning and commissioning.
-- Staff advances through valid actions instead of editing a status dropdown.

alter table public.pipes
  add column if not exists plan_confirmed boolean not null default false,
  add column if not exists hardware_mounted_check boolean not null default false,
  add column if not exists rs485_check boolean not null default false,
  add column if not exists gateway_online_check boolean not null default false,
  add column if not exists readings_received_check boolean not null default false,
  add column if not exists baseline_captured_check boolean not null default false,
  add column if not exists commissioned_at timestamptz,
  add column if not exists commissioned_by uuid references public.profiles(id) on delete set null;

-- Existing records came from a form that explicitly asked for the planned count.
update public.pipes set plan_confirmed = true where plan_confirmed = false;

-- Preserve previously completed deployments when adding the new checklist.
update public.pipes
set hardware_mounted_check = true,
    rs485_check = true,
    gateway_online_check = true,
    readings_received_check = true,
    baseline_captured_check = true,
    commissioned_at = coalesce(installed_at, now())
where deployment_status = 'ready';

create or replace function public.admin_confirm_deployment_plan(
  p_pipe_id uuid,
  p_expected_node_count smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_expected_node_count < 1 or p_expected_node_count > 64 then
    raise exception 'planned node count must be between 1 and 64';
  end if;

  update public.pipes
  set expected_node_count = p_expected_node_count,
      plan_confirmed = true
  where id = p_pipe_id and deployment_status = 'planning';

  if not found then raise exception 'planning deployment not found'; end if;
end;
$$;

create or replace function public.admin_advance_deployment(
  p_pipe_id uuid,
  p_action text,
  p_notes text default null,
  p_hardware_mounted boolean default null,
  p_rs485 boolean default null,
  p_gateway_online boolean default null,
  p_readings_received boolean default null,
  p_baseline_captured boolean default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_unit public.pipes%rowtype;
  deployed_count integer;
  gateway_count integer;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into current_unit from public.pipes where id = p_pipe_id for update;
  if not found then raise exception 'monitoring unit not found'; end if;

  if p_action = 'mark_installation_ready' then
    if current_unit.deployment_status <> 'planning' or not current_unit.plan_confirmed then
      raise exception 'complete installation planning first';
    end if;

    select count(*), count(*) filter (where is_gateway)
    into deployed_count, gateway_count
    from public.manufactured_nodes
    where assigned_pipe_id = p_pipe_id and status = 'deployed';

    if deployed_count <> current_unit.expected_node_count then
      raise exception 'assigned node count must match the installation plan';
    end if;
    if gateway_count <> 1 then
      raise exception 'choose exactly one gateway node';
    end if;

    update public.pipes set deployment_status = 'installation' where id = p_pipe_id;

  elsif p_action = 'start_commissioning' then
    if current_unit.deployment_status <> 'installation' then
      raise exception 'deployment is not ready for installation';
    end if;
    update public.pipes set deployment_status = 'commissioning' where id = p_pipe_id;

  elsif p_action in ('save_commissioning', 'complete_commissioning') then
    if current_unit.deployment_status <> 'commissioning' then
      raise exception 'commissioning has not started';
    end if;

    update public.pipes
    set commissioning_notes = nullif(trim(coalesce(p_notes, '')), ''),
        hardware_mounted_check = coalesce(p_hardware_mounted, hardware_mounted_check),
        rs485_check = coalesce(p_rs485, rs485_check),
        gateway_online_check = coalesce(p_gateway_online, gateway_online_check),
        readings_received_check = coalesce(p_readings_received, readings_received_check),
        baseline_captured_check = coalesce(p_baseline_captured, baseline_captured_check)
    where id = p_pipe_id;

    if p_action = 'complete_commissioning' then
      select * into current_unit from public.pipes where id = p_pipe_id;
      if not (
        current_unit.hardware_mounted_check and
        current_unit.rs485_check and
        current_unit.gateway_online_check and
        current_unit.readings_received_check and
        current_unit.baseline_captured_check
      ) then
        raise exception 'complete every commissioning check before activation';
      end if;

      update public.pipes
      set deployment_status = 'ready',
          installed_at = coalesce(installed_at, now()),
          commissioned_at = now(),
          commissioned_by = auth.uid()
      where id = p_pipe_id;
    end if;
  else
    raise exception 'unknown deployment action';
  end if;
end;
$$;

create or replace function public.validate_deployment_ready()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  deployed_count integer;
  gateway_count integer;
begin
  if old.deployment_status = 'ready' and new.deployment_status <> 'ready' then
    raise exception 'a ready deployment cannot be reopened';
  end if;

  if new.deployment_status = 'ready' then
    select count(*), count(*) filter (where is_gateway)
      into deployed_count, gateway_count
    from public.manufactured_nodes
    where assigned_pipe_id = new.id and status = 'deployed';

    if deployed_count <> new.expected_node_count then
      raise exception 'assigned node count must match expected node count';
    end if;
    if gateway_count <> 1 then
      raise exception 'a ready deployment must have exactly one gateway';
    end if;
    if not (
      new.hardware_mounted_check and
      new.rs485_check and
      new.gateway_online_check and
      new.readings_received_check and
      new.baseline_captured_check
    ) then
      raise exception 'all commissioning checks are required';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.admin_confirm_deployment_plan(uuid, smallint) from public, anon;
revoke all on function public.admin_advance_deployment(uuid, text, text, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_confirm_deployment_plan(uuid, smallint) to authenticated;
grant execute on function public.admin_advance_deployment(uuid, text, text, boolean, boolean, boolean, boolean, boolean) to authenticated;
