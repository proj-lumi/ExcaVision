-- Customer-originated service requests already carry their site from the
-- authenticated profile. Expose that ownership to Admin so routing does not
-- ask staff to select the same site again.
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
    when r.service_status <> 'completed' then true
    else false
  end as needs_action,
  r.closure_type,
  r.closure_reason,
  r.closed_at,
  r.closed_by,
  r.site_id
from public.service_requests r
left join public.sites created_site on created_site.id = r.created_site_id
left join public.pipes created_pipe on created_pipe.id = r.created_pipe_id
left join public.sites target_site on target_site.id = r.target_site_id
left join public.pipes target_pipe on target_pipe.id = r.target_pipe_id;
