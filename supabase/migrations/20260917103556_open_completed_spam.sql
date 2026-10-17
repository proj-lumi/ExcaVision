-- Simplify the request workflow to Open / Completed / Spam.
-- 'new' folds into 'open'; 'reviewed' folds into 'completed'; spam is unchanged.
-- The reviewed_at column is renamed completed_at to match the new meaning.

alter table public.service_requests alter column status drop default;
alter table public.service_requests drop constraint service_requests_check;

alter type public.service_request_status rename to service_request_status_legacy;
create type public.service_request_status as enum ('open', 'completed', 'spam');

alter table public.service_requests
  alter column status type public.service_request_status
  using (
    case status::text
      when 'new' then 'open'
      when 'spam' then 'spam'
      else 'completed'
    end
  )::public.service_request_status;

alter table public.service_requests rename column reviewed_at to completed_at;

-- Normalize timestamps so the completed flag and completed_at stay consistent.
update public.service_requests set completed_at = null where status <> 'completed';
update public.service_requests set completed_at = now() where status = 'completed' and completed_at is null;

alter table public.service_requests alter column status set default 'open';
alter table public.service_requests add constraint service_requests_check
  check ((status = 'completed' and completed_at is not null) or (status <> 'completed' and completed_at is null));
drop type public.service_request_status_legacy;

-- Customer-submitted requests open in the new status.
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
    target_request_type, 'open', current_profile.id, current_profile.full_name, current_profile.company_name,
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

-- Admin can create a site from a completed site_installation request.
create or replace function private.create_site_from_request_impl(target_request_id uuid, target_site_name text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  req public.service_requests%rowtype;
  profile_id uuid;
  new_site_id uuid;
  base_slug text;
  slug_text text;
  counter int := 0;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  select * into req from public.service_requests where id = target_request_id for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if req.request_type <> 'site_installation' then raise exception 'not_installation' using errcode = 'P0001'; end if;
  if req.status <> 'completed' then raise exception 'not_completed' using errcode = 'P0001'; end if;
  if req.site_id is not null then raise exception 'already_linked' using errcode = 'P0001'; end if;

  select id into profile_id from public.profiles where role = 'customer' and email = req.contact_email;
  if profile_id is null then
    insert into public.profiles (auth_user_id, role, full_name, email, phone, company_name, account_status)
    values (null, 'customer', req.requester_name, req.contact_email, req.contact_phone, req.company_name, 'pending')
    returning id into profile_id;
  end if;

  base_slug := lower(regexp_replace(target_site_name, '[^a-z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'site'; end if;
  slug_text := base_slug;
  loop
    exit when not exists (select 1 from public.sites where slug = slug_text);
    counter := counter + 1;
    slug_text := base_slug || '-' || counter;
  end loop;

  insert into public.sites (slug, name, address_label, latitude, longitude, company_name, customer_id, source_request_id, invitation_status)
  values (slug_text, target_site_name, req.address_label, req.latitude, req.longitude, req.company_name, profile_id, req.id, 'not_invited')
  returning id into new_site_id;

  update public.service_requests set site_id = new_site_id, requester_id = profile_id where id = req.id;
  return new_site_id;
end;
$$;

revoke all on function private.create_site_from_request_impl(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.create_site_from_request_impl(uuid, text) to authenticated;
