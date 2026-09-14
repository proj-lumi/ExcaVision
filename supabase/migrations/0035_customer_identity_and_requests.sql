-- One authenticated customer account owns one commissioned site in the MVP.
-- Customer-originated service requests derive identity and site ownership from auth.uid().

alter table public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists company text,
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null;

create unique index if not exists one_customer_profile_per_site_idx
  on public.profiles (site_id)
  where role = 'customer' and site_id is not null;
create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email is not null;

alter table public.service_requests
  add column if not exists submitted_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists site_id uuid references public.sites(id) on delete restrict;

create index if not exists service_requests_submitter_created_idx
  on public.service_requests (submitted_by_profile_id, created_at desc)
  where submitted_by_profile_id is not null;
create index if not exists service_requests_customer_site_created_idx
  on public.service_requests (site_id, created_at desc)
  where site_id is not null;

-- New auth identities get a harmless, unlinked customer profile. Site linkage is
-- performed only by the server-side invitation function using the service role.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, email, full_name, phone)
  values (
    new.id,
    'customer',
    lower(new.email),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      phone = coalesce(public.profiles.phone, excluded.phone);
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists create_profile_after_auth_user on auth.users;
create trigger create_profile_after_auth_user
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- A customer may read their profile, while only admins may assign role or site.
drop policy if exists "users read and update own profile" on public.profiles;
create policy "users read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));
create policy "admins update profiles"
on public.profiles for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Customer-created requests are readable by their submitter. Creation is only
-- through create_my_service_request, so caller-supplied ownership is impossible.
create policy "customers read own service requests"
on public.service_requests for select to authenticated
using (
  submitted_by_profile_id = (select auth.uid())
  and site_id = (select public.my_site_id())
);

create or replace function public.create_my_service_request(
  p_request_type text,
  p_location_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  customer public.profiles%rowtype;
  customer_site public.sites%rowtype;
  new_request_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_request_type not in ('Request repair', 'Request more sensors') then
    raise exception 'only repair and more coverage requests are available here';
  end if;
  if length(coalesce(p_location_notes, '')) > 1000 then
    raise exception 'request details are too long';
  end if;

  select * into customer
  from public.profiles
  where id = auth.uid();

  if not found or customer.role <> 'customer' or customer.site_id is null then
    raise exception 'customer site access is not configured';
  end if;
  if nullif(trim(coalesce(customer.full_name, '')), '') is null
     or nullif(trim(coalesce(customer.email, '')), '') is null
     or nullif(trim(coalesce(customer.phone, '')), '') is null then
    raise exception 'customer contact details are incomplete';
  end if;

  select * into customer_site
  from public.sites
  where id = customer.site_id;
  if not found or customer_site.lat is null or customer_site.lon is null then
    raise exception 'site location is incomplete';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(customer.site_id::text || ':' || p_request_type, 0));

  if exists (
    select 1
    from public.service_requests
    where submitted_by_profile_id = customer.id
      and site_id = customer.site_id
      and request_type = p_request_type
      and created_at >= now() - interval '24 hours'
      and status <> 'closed'
      and service_status <> 'completed'
  ) then
    raise exception 'a matching request is already open';
  end if;

  insert into public.service_requests (
    request_type,
    name,
    company,
    email,
    phone,
    location_name,
    location_label,
    location_notes,
    latitude,
    longitude,
    osm_url,
    google_maps_url,
    status,
    submitted_by_profile_id,
    site_id
  ) values (
    p_request_type,
    trim(customer.full_name),
    nullif(trim(coalesce(customer.company, '')), ''),
    lower(trim(customer.email)),
    trim(customer.phone),
    customer_site.name,
    customer_site.name,
    nullif(trim(coalesce(p_location_notes, '')), ''),
    customer_site.lat,
    customer_site.lon,
    format('https://www.openstreetmap.org/?mlat=%s&mlon=%s#map=16/%s/%s', customer_site.lat, customer_site.lon, customer_site.lat, customer_site.lon),
    format('https://www.google.com/maps/search/?api=1&query=%s,%s', customer_site.lat, customer_site.lon),
    'submitted',
    customer.id,
    customer.site_id
  )
  returning id into new_request_id;

  return new_request_id;
end;
$$;

revoke all on function public.create_my_service_request(text, text) from public, anon;
grant execute on function public.create_my_service_request(text, text) to authenticated;

-- Customers acknowledge alerts through a narrow RPC rather than receiving
-- general update access to alert rows.
drop policy if exists "own alerts" on public.alerts;
create policy "users read permitted alerts"
on public.alerts for select to authenticated
using (
  sensor_id in (
    select s.id
    from public.sensors s
    join public.sensor_nodes n on n.id = s.node_id
    join public.pipes p on p.id = n.pipe_id
    where p.site_id = (select public.my_site_id())
  )
  or (select public.is_admin())
);

revoke insert, update, delete on public.alerts from authenticated;
grant select on public.alerts to authenticated;

create or replace function public.acknowledge_my_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.my_site_id() is null then
    raise exception 'customer site access is not configured';
  end if;

  update public.alerts a
  set acknowledged_at = coalesce(a.acknowledged_at, now())
  where a.id = p_alert_id
    and exists (
      select 1
      from public.sensors s
      join public.sensor_nodes n on n.id = s.node_id
      join public.pipes p on p.id = n.pipe_id
      where s.id = a.sensor_id
        and p.site_id = public.my_site_id()
    );

  if not found then raise exception 'alert not found for this site'; end if;
end;
$$;

revoke all on function public.acknowledge_my_alert(uuid) from public, anon;
grant execute on function public.acknowledge_my_alert(uuid) to authenticated;

create or replace view public.admin_site_list
with (security_invoker = true)
as
select
  s.id,
  s.name,
  s.lat,
  s.lon,
  s.created_at,
  count(p.id) filter (where p.cancelled_at is null)::integer as monitoring_unit_count,
  count(p.id) filter (where p.cancelled_at is null and p.deployment_status = 'ready')::integer as ready_monitoring_unit_count,
  max(pr.email) filter (where pr.role = 'customer') as customer_email
from public.sites s
left join public.pipes p on p.site_id = s.id
left join public.profiles pr on pr.site_id = s.id and pr.role = 'customer'
where s.archived_at is null
group by s.id;

grant select on public.admin_site_list to authenticated;
