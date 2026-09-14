-- Installation requests may create multiple monitoring units at their new site.
-- Each unit is tracked as a new-unit target and must reach active monitoring.

alter table public.service_request_targets
  drop constraint if exists service_request_targets_operation_check;

alter table public.service_request_targets
  add constraint service_request_targets_operation_check
  check (operation in ('expand_nodes', 'replace_nodes', 'install_unit'));

create or replace function public.admin_create_monitoring_unit_from_request(
  p_request_id uuid,
  p_unit_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  destination_site_id uuid;
  new_pipe_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if length(trim(p_unit_name)) < 2 then raise exception 'monitoring unit name is required'; end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;

  if source_request.request_type = 'Request installation' then
    destination_site_id := source_request.created_site_id;
  elsif source_request.request_type in ('Request repair', 'Request more sensors')
      and source_request.fulfillment_path = 'new_unit_existing_site' then
    if source_request.created_pipe_id is not null then
      raise exception 'this service request already has a monitoring unit';
    end if;
    destination_site_id := source_request.target_site_id;
  else
    raise exception 'this request does not create a monitoring unit';
  end if;

  if destination_site_id is null then raise exception 'create or select the destination site first'; end if;

  insert into public.pipes (site_id, name, expected_node_count)
  values (destination_site_id, trim(p_unit_name), 1)
  returning id into new_pipe_id;

  if source_request.request_type = 'Request installation' then
    update public.service_requests
    set created_pipe_id = coalesce(created_pipe_id, new_pipe_id),
        fulfillment_path = 'multi_unit_service',
        service_status = 'in_progress',
        updated_at = now()
    where id = p_request_id;

    insert into public.service_request_targets (
      service_request_id, target_kind, operation, site_id, requested_node_count, created_pipe_id
    ) values (
      p_request_id, 'new_unit', 'install_unit', destination_site_id, 1, new_pipe_id
    );
  else
    update public.service_requests
    set created_pipe_id = new_pipe_id,
        updated_at = now()
    where id = p_request_id;
  end if;

  return new_pipe_id;
end;
$$;

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

  update public.service_request_targets
  set requested_node_count = p_expected_node_count
  where created_pipe_id = p_pipe_id
    and operation = 'install_unit';
end;
$$;

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
  end as needs_action
from public.service_requests r
left join public.sites created_site on created_site.id = r.created_site_id
left join public.pipes created_pipe on created_pipe.id = r.created_pipe_id
left join public.sites target_site on target_site.id = r.target_site_id
left join public.pipes target_pipe on target_pipe.id = r.target_pipe_id;
