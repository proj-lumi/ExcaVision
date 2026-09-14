-- Repair requests target an existing monitoring unit only.
-- Adding a monitoring unit is a more-coverage workflow, not a repair workflow.

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
      raise exception 'only more coverage requests can add a unit at an existing site';
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
    raise exception 'choose an existing service destination';
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
