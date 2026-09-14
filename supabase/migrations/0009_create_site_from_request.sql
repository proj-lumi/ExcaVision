-- Create sites from approved installation requests without exposing coordinates
-- as manual admin fields.

alter table public.service_requests
  add column if not exists created_site_id uuid unique
    references public.sites(id) on delete set null;

create index if not exists service_requests_created_site_id_idx
  on public.service_requests (created_site_id);

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
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if length(trim(p_site_name)) < 2 then
    raise exception 'site name is required';
  end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
    and request_type = 'Request installation'
    and status = 'approved'
    and created_site_id is null
  for update;

  if not found then
    raise exception 'approved installation request is unavailable';
  end if;

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

revoke all on function public.admin_create_site_from_request(uuid, text)
  from public, anon;
grant execute on function public.admin_create_site_from_request(uuid, text)
  to authenticated;
