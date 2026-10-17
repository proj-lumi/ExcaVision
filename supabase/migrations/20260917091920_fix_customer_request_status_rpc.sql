-- Keep the hardened private implementation aligned with the simplified request enum.
-- Restore the public RPC as an invoker-only wrapper after migration 0010.

create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
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
  select * into current_site from public.sites where id = target_site_id;
  select * into current_profile from public.profiles where id = private.current_profile_id_impl();
  insert into public.service_requests (
    request_type, status, requester_id, requester_name, company_name, contact_email, contact_phone,
    site_id, site_name, address_label, latitude, longitude, details
  ) values (
    target_request_type, 'new', current_profile.id, current_profile.full_name, current_profile.company_name,
    current_profile.email, current_profile.phone, current_site.id, current_site.name, current_site.address_label,
    current_site.latitude, current_site.longitude, target_details
  ) returning id into request_id;
  return request_id;
end;
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, text)
  to authenticated;

create or replace function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_details)
$$;

revoke all on function public.submit_customer_request(uuid, public.service_request_type, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, text)
  to authenticated;
