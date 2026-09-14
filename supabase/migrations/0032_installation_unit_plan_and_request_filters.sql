-- Installation requests must establish the number of monitoring units before
-- staff creates the units one by one.

create or replace function public.admin_set_installation_unit_count(
  p_request_id uuid,
  p_unit_count smallint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  existing_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_unit_count < 1 or p_unit_count > 64 then
    raise exception 'installation must include between 1 and 64 monitoring units';
  end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request installation' then
    raise exception 'only installation requests can set a unit plan';
  end if;
  if source_request.status <> 'approved' then
    raise exception 'request is no longer approved';
  end if;
  existing_site_id := source_request.created_site_id;
  if existing_site_id is null then raise exception 'create the site before setting the unit plan'; end if;

  if exists (
    select 1 from public.service_request_targets
    where service_request_id = p_request_id
      and (created_pipe_id is not null or work_plan_confirmed)
  ) then
    raise exception 'the installation plan cannot change after unit work starts';
  end if;

  delete from public.service_request_targets
  where service_request_id = p_request_id;

  insert into public.service_request_targets (
    service_request_id,
    target_kind,
    operation,
    site_id,
    requested_node_count,
    work_plan_confirmed
  )
  select
    p_request_id,
    'new_unit',
    'install_unit',
    existing_site_id,
    1,
    false
  from generate_series(1, p_unit_count);

  update public.service_requests
  set fulfillment_path = 'multi_unit_service',
      service_status = 'in_progress',
      updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.admin_set_installation_unit_count(uuid, smallint) from public, anon;
grant execute on function public.admin_set_installation_unit_count(uuid, smallint) to authenticated;
