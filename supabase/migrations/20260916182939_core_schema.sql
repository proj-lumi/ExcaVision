create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.user_role as enum ('admin', 'customer');
create type public.account_status as enum ('pending', 'active', 'disabled');
create type public.invitation_status as enum ('not_invited', 'invited', 'activated');
create type public.service_request_type as enum ('site_installation', 'add_unit', 'add_nodes', 'repair');
create type public.service_request_status as enum ('new', 'reviewed', 'spam', 'received', 'under_review', 'scheduled', 'complete');
create type public.unit_status as enum ('setup_pending', 'active', 'archived');
create type public.node_status as enum ('unassigned', 'assigned', 'archived');
create type public.node_connection_state as enum ('cloud_online', 'local_reporting', 'offline', 'unknown');
create type public.detection_method as enum ('isolation_forest');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  role public.user_role not null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 80),
  email citext not null unique check (char_length(email::text) between 3 and 254),
  phone text not null check (phone ~ '^09[0-9]{9}$'),
  company_name text not null default '' check (char_length(company_name) <= 120),
  account_status public.account_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  request_type public.service_request_type not null,
  status public.service_request_status not null default 'new',
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null check (char_length(trim(requester_name)) between 1 and 80),
  company_name text not null default '' check (char_length(company_name) <= 120),
  contact_email citext not null check (char_length(contact_email::text) between 3 and 254),
  contact_phone text not null check (contact_phone ~ '^09[0-9]{9}$'),
  site_id uuid,
  site_name text not null check (char_length(trim(site_name)) between 1 and 120),
  address_label text not null check (char_length(trim(address_label)) between 1 and 500),
  latitude double precision not null check (latitude between 4.2 and 21.5),
  longitude double precision not null check (longitude between 116.5 and 127.0),
  details text not null default '' check (char_length(details) <= 2000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status = 'new' and reviewed_at is null) or status <> 'new')
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  address_label text not null check (char_length(trim(address_label)) between 1 and 500),
  latitude double precision not null check (latitude between 4.2 and 21.5),
  longitude double precision not null check (longitude between 116.5 and 127.0),
  company_name text not null default '' check (char_length(company_name) <= 120),
  customer_id uuid references public.profiles(id) on delete restrict,
  source_request_id uuid not null unique references public.service_requests(id) on delete restrict,
  invitation_status public.invitation_status not null default 'not_invited',
  invitation_sent_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((invitation_status = 'not_invited' and invitation_sent_at is null) or invitation_status <> 'not_invited')
);

alter table public.service_requests
  add constraint service_requests_site_id_fkey foreign key (site_id) references public.sites(id) on delete set null;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  site_id uuid not null references public.sites(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  status public.unit_status not null default 'setup_pending',
  alert_threshold_deg numeric(5,2) not null default 2.00 check (alert_threshold_deg between 0.10 and 45.00),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name),
  check ((status = 'archived' and archived_at is not null) or (status <> 'archived' and archived_at is null))
);

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  mac_address text not null unique check (mac_address ~ '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$'),
  status public.node_status not null default 'unassigned',
  unit_id uuid references public.units(id) on delete restrict,
  position smallint check (position between 1 and 999),
  connection_state public.node_connection_state not null default 'unknown',
  last_seen_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'unassigned' and unit_id is null and position is null and archived_at is null)
    or (status = 'assigned' and unit_id is not null and position is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);
create unique index nodes_active_unit_position_key on public.nodes(unit_id, position) where status = 'assigned';

create table public.sensors (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete restrict,
  position smallint not null check (position between 1 and 64),
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now(),
  unique (node_id, position)
);

create table public.sensor_readings (
  id bigint generated always as identity primary key,
  sensor_id uuid not null references public.sensors(id) on delete restrict,
  tilt_deg numeric(8,4) not null,
  recorded_at timestamptz not null default now()
);
create index sensor_readings_sensor_recorded_idx on public.sensor_readings(sensor_id, recorded_at desc);

create table public.threshold_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  sensor_id uuid not null references public.sensors(id) on delete restrict,
  observed_value_deg numeric(8,4) not null,
  threshold_deg numeric(5,2) not null check (threshold_deg between 0.10 and 45.00),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index threshold_events_unit_detected_idx on public.threshold_events(unit_id, detected_at desc);

create table public.anomaly_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  node_id uuid not null references public.nodes(id) on delete restrict,
  sensor_id uuid not null references public.sensors(id) on delete restrict,
  detection_method public.detection_method not null default 'isolation_forest',
  observed_value_deg numeric(8,4) not null,
  baseline_value_deg numeric(8,4) not null,
  anomaly_score numeric(8,6) not null check (anomaly_score between -1 and 1),
  anomalous_readings smallint not null check (anomalous_readings >= 1),
  window_size smallint not null check (window_size >= anomalous_readings),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index anomaly_events_unit_detected_idx on public.anomaly_events(unit_id, detected_at desc);

create table public.request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);

create table public.request_abuse_signals (
  id bigint generated always as identity primary key,
  request_id uuid references public.service_requests(id) on delete cascade,
  ip_hash text not null,
  submission_fingerprint text not null,
  turnstile_hostname text,
  submitted_at timestamptz not null default now()
);
create index request_abuse_ip_time_idx on public.request_abuse_signals(ip_hash, submitted_at desc);
create index request_abuse_fingerprint_time_idx on public.request_abuse_signals(submission_fingerprint, submitted_at desc);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger sites_set_updated_at before update on public.sites for each row execute function public.set_updated_at();
create trigger units_set_updated_at before update on public.units for each row execute function public.set_updated_at();
create trigger nodes_set_updated_at before update on public.nodes for each row execute function public.set_updated_at();

create function public.enforce_attachment_limit() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.request_id::text, 0));
  if (select count(*) from public.request_attachments where request_id = new.request_id) >= 5 then
    raise exception 'A request can contain at most five attachments.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger request_attachments_limit before insert on public.request_attachments for each row execute function public.enforce_attachment_limit();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid() and role = 'admin' and account_status = 'active'
  );
$$;

create function public.current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_user_id = auth.uid() and account_status = 'active' limit 1;
$$;

create function public.owns_site(target_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sites
    where id = target_site_id and customer_id = public.current_profile_id() and archived_at is null
  );
$$;

create function public.reserve_public_intake(target_ip_hash text, target_fingerprint text, target_hostname text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  signal_id bigint;
begin
  if char_length(target_ip_hash) <> 64 or char_length(target_fingerprint) <> 64 then
    raise exception 'invalid_abuse_hash' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ip:' || target_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('fingerprint:' || target_fingerprint, 0));
  if (select count(*) from public.request_abuse_signals where ip_hash = target_ip_hash and submitted_at >= now() - interval '1 hour') >= 5 then
    raise exception 'rate_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.request_abuse_signals where submission_fingerprint = target_fingerprint and submitted_at >= now() - interval '24 hours') then
    raise exception 'duplicate_request' using errcode = 'P0001';
  end if;
  insert into public.request_abuse_signals (ip_hash, submission_fingerprint, turnstile_hostname)
  values (target_ip_hash, target_fingerprint, nullif(target_hostname, ''))
  returning id into signal_id;
  return signal_id;
end;
$$;

create function public.update_unit_threshold(target_unit_id uuid, new_threshold_deg numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_threshold_deg < 0.10 or new_threshold_deg > 45.00 then
    raise exception 'Threshold must be between 0.10 and 45.00 degrees.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.units where id = target_unit_id and public.owns_site(site_id) and archived_at is null) then
    raise exception 'Unit is unavailable.' using errcode = '42501';
  end if;
  update public.units set alert_threshold_deg = new_threshold_deg where id = target_unit_id;
end;
$$;

create function public.acknowledge_threshold_event(target_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.threshold_events
  set acknowledged_at = coalesce(acknowledged_at, now())
  where id = target_event_id
    and public.owns_site((select site_id from public.units where id = threshold_events.unit_id));
  if not found then raise exception 'Threshold event is unavailable.' using errcode = '42501'; end if;
end;
$$;

create function public.acknowledge_anomaly_event(target_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.anomaly_events
  set acknowledged_at = coalesce(acknowledged_at, now())
  where id = target_event_id
    and public.owns_site((select site_id from public.units where id = anomaly_events.unit_id));
  if not found then raise exception 'Anomaly event is unavailable.' using errcode = '42501'; end if;
end;
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.current_profile_id() from public, anon;
revoke execute on function public.owns_site(uuid) from public, anon;
revoke execute on function public.reserve_public_intake(text, text, text) from public, anon, authenticated;
revoke execute on function public.update_unit_threshold(uuid, numeric) from public, anon;
revoke execute on function public.acknowledge_threshold_event(uuid) from public, anon;
revoke execute on function public.acknowledge_anomaly_event(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.owns_site(uuid) to authenticated;
grant execute on function public.reserve_public_intake(text, text, text) to service_role;
grant execute on function public.update_unit_threshold(uuid, numeric) to authenticated;
grant execute on function public.acknowledge_threshold_event(uuid) to authenticated;
grant execute on function public.acknowledge_anomaly_event(uuid) to authenticated;

revoke all on public.profiles, public.sites, public.units, public.nodes, public.sensors, public.sensor_readings, public.threshold_events, public.anomaly_events, public.service_requests, public.request_attachments, public.request_abuse_signals from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.units to authenticated;
grant select, insert, update, delete on public.nodes to authenticated;
grant select, insert, update, delete on public.sensors to authenticated;
grant select, insert, update, delete on public.sensor_readings to authenticated;
grant select, insert, update, delete on public.threshold_events to authenticated;
grant select, insert, update, delete on public.anomaly_events to authenticated;
grant select, insert, update, delete on public.service_requests to authenticated;
grant select, insert, update, delete on public.request_attachments to authenticated;
grant select, insert, update, delete on public.request_abuse_signals to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant select, insert, update, delete on public.profiles, public.sites, public.units, public.nodes, public.sensors, public.sensor_readings, public.threshold_events, public.anomaly_events, public.service_requests, public.request_attachments, public.request_abuse_signals to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.units enable row level security;
alter table public.nodes enable row level security;
alter table public.sensors enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.threshold_events enable row level security;
alter table public.anomaly_events enable row level security;
alter table public.service_requests enable row level security;
alter table public.request_attachments enable row level security;
alter table public.request_abuse_signals enable row level security;

create policy profiles_admin_all on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_customer_select on public.profiles for select to authenticated using (id = public.current_profile_id());
create policy profiles_customer_update on public.profiles for update to authenticated
using (id = public.current_profile_id())
with check (id = public.current_profile_id() and role = 'customer' and auth_user_id = auth.uid() and account_status = 'active');

create policy sites_admin_all on public.sites for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sites_customer_select on public.sites for select to authenticated using (customer_id = public.current_profile_id() and archived_at is null);

create policy units_admin_all on public.units for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy units_customer_select on public.units for select to authenticated using (public.owns_site(site_id) and archived_at is null);

create policy nodes_admin_all on public.nodes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy nodes_customer_select on public.nodes for select to authenticated using (
  unit_id is not null and exists (select 1 from public.units where units.id = nodes.unit_id and public.owns_site(units.site_id)) and archived_at is null
);

create policy sensors_admin_all on public.sensors for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sensors_customer_select on public.sensors for select to authenticated using (
  exists (
    select 1 from public.nodes join public.units on units.id = nodes.unit_id
    where nodes.id = sensors.node_id and public.owns_site(units.site_id)
  )
);

create policy readings_admin_select on public.sensor_readings for select to authenticated using (public.is_admin());
create policy readings_customer_select on public.sensor_readings for select to authenticated using (
  exists (
    select 1 from public.sensors
    join public.nodes on nodes.id = sensors.node_id
    join public.units on units.id = nodes.unit_id
    where sensors.id = sensor_readings.sensor_id and public.owns_site(units.site_id)
  )
);

create policy threshold_events_admin_all on public.threshold_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy threshold_events_customer_select on public.threshold_events for select to authenticated using (public.owns_site((select site_id from public.units where id = threshold_events.unit_id)));

create policy anomaly_events_admin_all on public.anomaly_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy anomaly_events_customer_select on public.anomaly_events for select to authenticated using (public.owns_site((select site_id from public.units where id = anomaly_events.unit_id)));

create policy requests_admin_all on public.service_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy requests_customer_select on public.service_requests for select to authenticated using (
  requester_id = public.current_profile_id() or (site_id is not null and public.owns_site(site_id))
);

create policy attachments_admin_select on public.request_attachments for select to authenticated using (public.is_admin());
create policy attachments_customer_select on public.request_attachments for select to authenticated using (
  exists (
    select 1 from public.service_requests
    where service_requests.id = request_attachments.request_id
      and (service_requests.requester_id = public.current_profile_id() or (service_requests.site_id is not null and public.owns_site(service_requests.site_id)))
  )
);

create policy abuse_signals_admin_select on public.request_abuse_signals for select to authenticated using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-attachments',
  'request-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy request_files_admin_select on storage.objects for select to authenticated using (bucket_id = 'request-attachments' and public.is_admin());
create policy request_files_customer_select on storage.objects for select to authenticated using (
  bucket_id = 'request-attachments'
  and exists (
    select 1 from public.request_attachments
    join public.service_requests on service_requests.id = request_attachments.request_id
    where request_attachments.storage_path = storage.objects.name
      and (service_requests.requester_id = public.current_profile_id() or (service_requests.site_id is not null and public.owns_site(service_requests.site_id)))
  )
);

comment on table public.service_requests is 'All public and authenticated service requests. Anonymous clients have no direct table policy and must use the submit-site-installation Edge Function.';
comment on table public.request_abuse_signals is 'Restricted abuse metadata containing only keyed hashes, never raw client IP addresses.';
