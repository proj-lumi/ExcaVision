-- Setup starts from an open request and completes it at the end.
-- A finished or spam request cannot be reopened or started again.

create or replace function private.prevent_request_reopen()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private, extensions
as $$
begin
  if old.status <> 'open' and new.status = 'open' then
    raise exception 'request_reopen_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_request_reopen() from public, anon, authenticated, service_role;

drop trigger if exists service_requests_prevent_reopen on public.service_requests;
create trigger service_requests_prevent_reopen
before update of status on public.service_requests
for each row execute function private.prevent_request_reopen();

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
  if req.status <> 'open' then raise exception 'request_not_open' using errcode = 'P0001'; end if;
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
