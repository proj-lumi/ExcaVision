-- Keep request workflow states aligned with actions the Admin can actually perform.
-- Legacy operational states are folded into reviewed before the enum is replaced.

alter table public.service_requests alter column status drop default;
alter table public.service_requests drop constraint service_requests_check;
alter type public.service_request_status rename to service_request_status_legacy;
create type public.service_request_status as enum ('new', 'reviewed', 'spam');

alter table public.service_requests
  alter column status type public.service_request_status
  using (
    case status::text
      when 'new' then 'new'
      when 'spam' then 'spam'
      else 'reviewed'
    end
  )::public.service_request_status;

alter table public.service_requests alter column status set default 'new';
alter table public.service_requests add constraint service_requests_check
  check ((status = 'new' and reviewed_at is null) or status <> 'new');
drop type public.service_request_status_legacy;

create or replace function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  request_id uuid;
  current_site public.sites%rowtype;
  current_profile public.profiles%rowtype;
begin
  if target_request_type not in ('repair', 'add_nodes', 'add_unit') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;
  if not public.owns_site(target_site_id) then
    raise exception 'site_not_owned' using errcode = '42501';
  end if;
  select * into current_site from public.sites where id = target_site_id;
  select * into current_profile from public.profiles where id = public.current_profile_id();
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

revoke execute on function public.submit_customer_request(uuid, public.service_request_type, text) from public, anon;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, text) to authenticated;
