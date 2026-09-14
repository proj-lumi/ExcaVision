-- Route approved service requests to the correct existing or new monitoring work.
-- A repair or coverage request must never create a site accidentally.

alter table public.service_requests
  add column if not exists fulfillment_path text
    check (fulfillment_path in (
      'repair_existing_unit',
      'expand_existing_unit',
      'new_unit_existing_site'
    )),
  add column if not exists target_site_id uuid
    references public.sites(id) on delete restrict,
  add column if not exists target_pipe_id uuid
    references public.pipes(id) on delete restrict,
  add column if not exists created_pipe_id uuid unique
    references public.pipes(id) on delete restrict;

create index if not exists service_requests_target_site_id_idx
  on public.service_requests (target_site_id);
create index if not exists service_requests_target_pipe_id_idx
  on public.service_requests (target_pipe_id);

-- Associate older installation requests when their created site has exactly one unit.
update public.service_requests r
set created_pipe_id = (
  select p.id
  from public.pipes p
  where p.site_id = r.created_site_id
  limit 1
)
where r.request_type = 'Request installation'
  and r.created_site_id is not null
  and r.created_pipe_id is null
  and (
    select count(*)
    from public.pipes p
    where p.site_id = r.created_site_id
  ) = 1;

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

  if p_path = 'new_installation' then
    update public.service_requests
    set request_type = 'Request installation',
        fulfillment_path = null,
        target_site_id = null,
        target_pipe_id = null,
        updated_at = now()
    where id = p_request_id;
    return;
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
      raise exception 'only more coverage requests can add a monitoring unit';
    end if;
    if p_site_id is null or not exists (select 1 from public.sites where id = p_site_id) then
      raise exception 'select an existing site';
    end if;

    update public.service_requests
    set fulfillment_path = p_path,
        target_site_id = p_site_id,
        target_pipe_id = null,
        updated_at = now()
    where id = p_request_id;
    return;
  else
    raise exception 'choose a valid delivery route';
  end if;

  if p_pipe_id is null then raise exception 'select an existing monitoring unit'; end if;
  select site_id into pipe_site_id from public.pipes where id = p_pipe_id;
  if pipe_site_id is null then raise exception 'monitoring unit no longer exists'; end if;

  update public.service_requests
  set fulfillment_path = p_path,
      target_site_id = pipe_site_id,
      target_pipe_id = p_pipe_id,
      updated_at = now()
  where id = p_request_id;
end;
$$;

create or replace function public.admin_create_site_from_request(
  p_request_id uuid,
  p_site_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
  new_site_id uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if length(trim(p_site_name)) < 2 then raise exception 'site name is required'; end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request no longer exists'; end if;
  if source_request.request_type <> 'Request installation' then
    raise exception 'only a new installation request can create a site';
  end if;
  if source_request.status <> 'approved' then raise exception 'request is no longer approved'; end if;
  if source_request.created_site_id is not null then raise exception 'this request already has a site'; end if;

  insert into public.sites (name, lat, lon)
  values (trim(p_site_name), source_request.latitude, source_request.longitude)
  returning id into new_site_id;

  update public.service_requests
  set created_site_id = new_site_id,
      updated_at = now()
  where id = source_request.id;

  return new_site_id;
end;
$$;

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
  if source_request.created_pipe_id is not null then
    raise exception 'this request already has a monitoring unit';
  end if;

  if source_request.request_type = 'Request installation' then
    destination_site_id := source_request.created_site_id;
  elsif source_request.request_type = 'Request more sensors'
      and source_request.fulfillment_path = 'new_unit_existing_site' then
    destination_site_id := source_request.target_site_id;
  else
    raise exception 'this request does not create a monitoring unit';
  end if;

  if destination_site_id is null then raise exception 'select or create the site first'; end if;

  insert into public.pipes (site_id, name, expected_node_count)
  values (destination_site_id, trim(p_unit_name), 1)
  returning id into new_pipe_id;

  update public.service_requests
  set created_pipe_id = new_pipe_id,
      updated_at = now()
  where id = p_request_id;

  return new_pipe_id;
end;
$$;

revoke all on function public.admin_route_service_request(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.admin_create_monitoring_unit_from_request(uuid, text) from public, anon;
grant execute on function public.admin_route_service_request(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.admin_create_monitoring_unit_from_request(uuid, text) to authenticated;
