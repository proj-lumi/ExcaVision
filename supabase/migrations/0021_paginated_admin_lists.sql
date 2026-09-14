-- Read models for paginated admin lists. These views run with caller RLS and
-- include the names/counts needed by list rows without loading whole tables.

create or replace view public.admin_service_request_list
with (security_invoker = true)
as
select
  r.*,
  created_site.name as created_site_name,
  created_pipe.name as created_pipe_name,
  created_pipe.deployment_status as created_pipe_status,
  target_site.name as target_site_name,
  target_pipe.name as target_pipe_name,
  case
    when r.status in ('submitted', 'under_review', 'clarification_needed', 'proposal_ready', 'changes_requested') then true
    when r.status <> 'approved' then false
    when r.request_type = 'Request installation' then
      r.created_site_id is null
      or r.created_pipe_id is null
      or created_pipe.deployment_status is distinct from 'ready'
    else r.fulfillment_path is null or r.service_status <> 'completed'
  end as needs_action
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
  created_pipe.deployment_status as created_pipe_status
from public.service_request_targets t
join public.sites s on s.id = t.site_id
left join public.pipes p on p.id = t.pipe_id
left join public.pipes created_pipe on created_pipe.id = t.created_pipe_id;

create or replace view public.admin_site_list
with (security_invoker = true)
as
select
  s.*,
  count(p.id)::integer as monitoring_unit_count
from public.sites s
left join public.pipes p on p.site_id = s.id
group by s.id;

create or replace view public.admin_monitoring_unit_list
with (security_invoker = true)
as
select
  p.*,
  s.name as site_name,
  count(m.id) filter (where m.status = 'deployed')::integer as node_count,
  count(m.id) filter (where m.status = 'deployed' and m.is_gateway)::integer as gateway_count,
  coalesce(max(m.position_in_pipe) filter (where m.status = 'deployed'), 0)::integer as max_position
from public.pipes p
join public.sites s on s.id = p.site_id
left join public.manufactured_nodes m on m.assigned_pipe_id = p.id
group by p.id, s.name;

create or replace view public.admin_node_list
with (security_invoker = true)
as
select
  m.*,
  s.name as site_name,
  p.name as pipe_name
from public.manufactured_nodes m
left join public.sites s on s.id = m.assigned_site_id
left join public.pipes p on p.id = m.assigned_pipe_id;

grant select on public.admin_service_request_list to authenticated;
grant select on public.admin_service_request_target_list to authenticated;
grant select on public.admin_site_list to authenticated;
grant select on public.admin_monitoring_unit_list to authenticated;
grant select on public.admin_node_list to authenticated;
