-- Record the requested quantity separately from human-readable details so setup
-- can enforce the request instead of trusting editable copy.
alter table public.service_requests
  add column requested_count smallint;

alter table public.service_requests
  add constraint service_requests_requested_count_check
  check (requested_count is null or requested_count between 1 and 20);

comment on column public.service_requests.requested_count is
  'Requested number of units or nodes for add_unit/add_nodes requests. Nullable for legacy and non-quantity requests.';

create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_details text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  request_id uuid;
  requested_count smallint := target_requested_count;
  current_site public.sites%rowtype;
  current_profile public.profiles%rowtype;
begin
  if target_request_type not in ('repair', 'add_nodes', 'add_unit') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;
  if requested_count is null then
    requested_count := case
      when target_request_type = 'add_nodes' then nullif(substring(lower(trim(target_details)) from '^add ([0-9]{1,2}) nodes?\.'), '')::smallint
      when target_request_type = 'add_unit' then nullif(substring(lower(trim(target_details)) from '^add ([0-9]{1,2}) monitoring units?\.'), '')::smallint
      else null
    end;
  end if;
  if target_request_type in ('add_nodes', 'add_unit') then
    if requested_count is null or requested_count not between 1 and 20 then
      raise exception 'requested_count_required' using errcode = '22023';
    end if;
  elsif requested_count is not null then
    raise exception 'requested_count_not_allowed' using errcode = '22023';
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
    site_id, site_name, address_label, latitude, longitude, target_unit_id, requested_count, details
  ) values (
    target_request_type, 'open', current_profile.id, current_profile.full_name, current_profile.company_name,
    current_profile.email, current_profile.phone, current_site.id, current_site.name, current_site.address_label,
    current_site.latitude, current_site.longitude, target_unit_id, requested_count, left(trim(target_details), 2000)
  ) returning id into request_id;
  return request_id;
end;
$$;

-- Preserve old overloads for already-open clients; quantity is recovered from
-- the standard detail prefix for add-unit/add-node requests.
create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_details text
) returns uuid
language sql security definer
set search_path = pg_catalog, public, private, extensions as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_unit_id, null::smallint, target_details)
$$;

create or replace function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language sql security definer
set search_path = pg_catalog, public, private, extensions as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, null::uuid, null::smallint, target_details)
$$;

create or replace function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_unit_id, target_requested_count, target_details)
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, text)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, text)
  to authenticated;
