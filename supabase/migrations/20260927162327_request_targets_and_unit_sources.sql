-- Keep customer follow-up requests linked to their selected unit, and keep
-- units created from a multi-unit request attached to that request.
alter table public.service_requests
  add column target_unit_id uuid references public.units(id) on delete set null;

create index service_requests_target_unit_id_idx
  on public.service_requests(target_unit_id)
  where target_unit_id is not null;

alter table public.units
  add column source_request_id uuid references public.service_requests(id) on delete set null;

create index units_source_request_id_idx
  on public.units(source_request_id)
  where source_request_id is not null;

create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_details text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  request_id uuid;
  current_site public.sites%rowtype;
  current_profile public.profiles%rowtype;
begin
  if target_request_type not in ('repair', 'add_nodes', 'add_unit') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;
  if not private.owns_site_impl(target_site_id) then
    raise exception 'site_not_owned' using errcode = '42501';
  end if;
  if target_request_type = 'add_nodes' then
    if target_unit_id is null then
      raise exception 'target_unit_required' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.units
      where id = target_unit_id
        and site_id = target_site_id
        and status <> 'archived'
        and archived_at is null
    ) then
      raise exception 'target_unit_unavailable' using errcode = 'P0001';
    end if;
  elsif target_unit_id is not null then
    raise exception 'target_unit_not_allowed' using errcode = '22023';
  end if;

  select * into current_site from public.sites where id = target_site_id;
  select * into current_profile from public.profiles where id = private.current_profile_id_impl();
  insert into public.service_requests (
    request_type, status, requester_id, requester_name, company_name, contact_email, contact_phone,
    site_id, site_name, address_label, latitude, longitude, target_unit_id, details
  ) values (
    target_request_type, 'open', current_profile.id, current_profile.full_name, current_profile.company_name,
    current_profile.email, current_profile.phone, current_site.id, current_site.name, current_site.address_label,
    current_site.latitude, current_site.longitude, target_unit_id, left(trim(target_details), 2000)
  ) returning id into request_id;
  return request_id;
end;
$$;

-- Preserve the old three-argument RPC for already-open client sessions.
create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language sql security definer
set search_path = pg_catalog, public, private, extensions as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, null::uuid, target_details)
$$;

create or replace function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_details)
$$;

create or replace function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_unit_id, target_details)
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, text)
  to authenticated;
revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, text)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, text)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, uuid, text)
  to authenticated;
