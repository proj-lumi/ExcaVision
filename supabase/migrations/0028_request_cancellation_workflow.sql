-- Separate pre-approval "not proceeding" from cancellation after approval.
-- Draft work is archived, planning hardware is released, and started work is
-- preserved for operational history.

alter table public.service_requests
  add column if not exists closure_type text
    check (closure_type in ('not_proceeding', 'cancelled')),
  add column if not exists closure_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;

alter table public.service_requests
  drop constraint if exists service_requests_service_status_check;

alter table public.service_requests
  add constraint service_requests_service_status_check
  check (service_status in ('pending', 'in_progress', 'completed', 'cancelled'));

alter table public.sites
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.pipes
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create index if not exists sites_active_name_idx
  on public.sites (name) where archived_at is null;
create index if not exists pipes_active_created_idx
  on public.pipes (created_at desc) where cancelled_at is null;

create or replace function public.guard_service_request_closure()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'a closed request cannot be reopened';
  end if;

  if old.status <> 'closed' and new.status = 'closed'
      and (new.closure_type is null or nullif(trim(new.closure_reason), '') is null or new.closed_at is null) then
    raise exception 'use the request closure workflow';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_service_request_closure_trigger on public.service_requests;
create trigger guard_service_request_closure_trigger
before update of status on public.service_requests
for each row execute function public.guard_service_request_closure();

create or replace function public.admin_close_service_request(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  created_unit public.pipes%rowtype;
  has_sensor_history boolean;
  closure_kind text;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'enter a reason for closing this request';
  end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.status = 'closed' then raise exception 'request is already closed'; end if;

  if source_request.status <> 'approved' then
    closure_kind := 'not_proceeding';
  else
    if source_request.service_status = 'completed' then
      raise exception 'completed work cannot be cancelled from its request';
    end if;
    closure_kind := 'cancelled';

    -- Only units created by this request may be stopped. Existing repair and
    -- coverage destinations remain active and keep any completed work.
    for created_unit in
      select p.*
      from public.pipes p
      where p.id = source_request.created_pipe_id
         or exists (
           select 1
           from public.service_request_targets t
           where t.service_request_id = source_request.id
             and t.created_pipe_id = p.id
         )
      for update
    loop
      -- Active monitoring is a completed asset, not a cancellation side effect.
      if created_unit.deployment_status = 'ready' then
        continue;
      end if;

      select
        exists (
          select 1 from public.readings r
          join public.sensors s on s.id = r.sensor_id
          join public.sensor_nodes n on n.id = s.node_id
          where n.pipe_id = created_unit.id
        )
        or exists (
          select 1 from public.readings_1min r
          join public.sensors s on s.id = r.sensor_id
          join public.sensor_nodes n on n.id = s.node_id
          where n.pipe_id = created_unit.id
        )
        or exists (
          select 1 from public.baselines b
          join public.sensors s on s.id = b.sensor_id
          join public.sensor_nodes n on n.id = s.node_id
          where n.pipe_id = created_unit.id
        )
        or exists (
          select 1 from public.alerts a
          join public.sensors s on s.id = a.sensor_id
          join public.sensor_nodes n on n.id = s.node_id
          where n.pipe_id = created_unit.id
        )
        or exists (
          select 1 from public.risk_scores r
          join public.sensor_nodes n on n.id = r.node_id
          where n.pipe_id = created_unit.id
        )
      into has_sensor_history;

      -- A planning-only manifest is reversible. Once field work or sensor
      -- history exists, preserve hardware assignments and records.
      if created_unit.deployment_status = 'planning' and not has_sensor_history then
        delete from public.service_request_target_nodes stn
        using public.service_request_targets t, public.sensor_nodes n
        where stn.target_id = t.id
          and t.service_request_id = source_request.id
          and stn.sensor_node_id = n.id
          and n.pipe_id = created_unit.id;

        update public.manufactured_nodes
        set assigned_site_id = null,
            assigned_pipe_id = null,
            position_in_pipe = null,
            is_gateway = false,
            deployed_node_id = null,
            status = 'manufactured'
        where assigned_pipe_id = created_unit.id;

        delete from public.sensor_nodes where pipe_id = created_unit.id;
      end if;

      update public.pipes
      set cancelled_at = now(),
          cancellation_reason = trim(p_reason)
      where id = created_unit.id;
    end loop;

    -- A request-created site disappears from active operations only when no
    -- active or completed monitoring unit remains at that site.
    if source_request.created_site_id is not null
       and not exists (
         select 1 from public.pipes
         where site_id = source_request.created_site_id
           and cancelled_at is null
       ) then
      update public.sites
      set archived_at = now(),
          archive_reason = trim(p_reason)
      where id = source_request.created_site_id;
    end if;
  end if;

  update public.service_requests
  set status = 'closed',
      closure_type = closure_kind,
      closure_reason = trim(p_reason),
      closed_at = now(),
      closed_by = auth.uid(),
      service_status = case when closure_kind = 'cancelled' then 'cancelled' else service_status end,
      updated_at = now()
  where id = source_request.id;
end;
$$;

revoke all on function public.admin_close_service_request(uuid, text) from public, anon;
grant execute on function public.admin_close_service_request(uuid, text) to authenticated;

create or replace view public.admin_service_request_list
with (security_invoker = true)
as
select
  r.id,
  r.created_at,
  r.updated_at,
  r.request_type,
  r.name,
  r.company,
  r.email,
  r.phone,
  r.location_name,
  r.location_label,
  r.location_notes,
  r.latitude,
  r.longitude,
  r.osm_url,
  r.google_maps_url,
  r.status,
  r.assigned_staff_id,
  r.created_site_id,
  r.fulfillment_path,
  r.target_site_id,
  r.target_pipe_id,
  r.created_pipe_id,
  r.service_status,
  r.service_completed_at,
  r.service_completed_by,
  created_site.name as created_site_name,
  created_pipe.name as created_pipe_name,
  case when created_pipe.cancelled_at is not null then 'cancelled' else created_pipe.deployment_status end as created_pipe_status,
  target_site.name as target_site_name,
  target_pipe.name as target_pipe_name,
  case
    when r.status in ('submitted', 'under_review', 'clarification_needed', 'proposal_ready', 'changes_requested') then true
    when r.status <> 'approved' then false
    when r.request_type = 'Request installation' then
      r.created_site_id is null
      or not exists (
        select 1 from public.service_request_targets t
        where t.service_request_id = r.id
      )
      or exists (
        select 1 from public.service_request_targets t
        where t.service_request_id = r.id
          and (t.created_pipe_id is null or not exists (
            select 1 from public.pipes p
            where p.id = t.created_pipe_id and p.deployment_status = 'ready'
          ))
      )
    else r.fulfillment_path is null or r.service_status <> 'completed'
  end as needs_action,
  r.closure_type,
  r.closure_reason,
  r.closed_at,
  r.closed_by
from public.service_requests r
left join public.sites created_site on created_site.id = r.created_site_id
left join public.pipes created_pipe on created_pipe.id = r.created_pipe_id
left join public.sites target_site on target_site.id = r.target_site_id
left join public.pipes target_pipe on target_pipe.id = r.target_pipe_id;

create or replace view public.admin_service_request_target_list
with (security_invoker = true)
as
select
  t.*,
  s.name as site_name,
  p.name as pipe_name,
  created_pipe.name as created_pipe_name,
  case when created_pipe.cancelled_at is not null then 'cancelled' else created_pipe.deployment_status end as created_pipe_status
from public.service_request_targets t
join public.sites s on s.id = t.site_id
left join public.pipes p on p.id = t.pipe_id
left join public.pipes created_pipe on created_pipe.id = t.created_pipe_id;

create or replace view public.admin_site_list
with (security_invoker = true)
as
select
  s.id,
  s.name,
  s.lat,
  s.lon,
  s.created_at,
  count(p.id) filter (where p.cancelled_at is null)::integer as monitoring_unit_count
from public.sites s
left join public.pipes p on p.site_id = s.id
where s.archived_at is null
group by s.id;

create or replace view public.admin_monitoring_unit_list
with (security_invoker = true)
as
select
  p.id,
  p.site_id,
  p.name,
  p.installed_at,
  p.alert_threshold_deg,
  p.created_at,
  p.expected_node_count,
  p.deployment_status,
  p.commissioning_notes,
  p.plan_confirmed,
  p.hardware_mounted_check,
  p.rs485_check,
  p.gateway_online_check,
  p.readings_received_check,
  p.baseline_captured_check,
  p.commissioned_at,
  p.commissioned_by,
  s.name as site_name,
  count(m.id) filter (where m.status = 'deployed')::integer as node_count,
  count(m.id) filter (where m.status = 'deployed' and m.is_gateway)::integer as gateway_count,
  coalesce(max(m.position_in_pipe) filter (where m.status = 'deployed'), 0)::integer as max_position
from public.pipes p
join public.sites s on s.id = p.site_id
left join public.manufactured_nodes m on m.assigned_pipe_id = p.id
where p.cancelled_at is null
  and s.archived_at is null
group by p.id, s.name;

grant select on public.admin_service_request_list to authenticated;
grant select on public.admin_service_request_target_list to authenticated;
grant select on public.admin_site_list to authenticated;
grant select on public.admin_monitoring_unit_list to authenticated;
