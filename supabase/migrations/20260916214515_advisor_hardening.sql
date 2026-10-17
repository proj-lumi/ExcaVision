-- Resolve hosted Supabase Security and Performance Advisor warnings without
-- changing the client-facing RPC contract.

-- Extensions should not live in the API-exposed public schema.
create schema if not exists extensions;
revoke create on schema extensions from public, anon, authenticated;
alter extension citext set schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Trigger functions are not RPCs, but still need an immutable trusted path.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;
alter function public.enforce_attachment_limit()
  set search_path = pg_catalog, public;
revoke execute on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.enforce_attachment_limit() from public, anon, authenticated, service_role;

-- Supabase's optional Automatic RLS feature installs this event-trigger callback
-- only on hosted projects. It must remain privileged for the event trigger, but
-- it must never be callable as an API RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'alter function public.rls_auto_enable() set search_path = pg_catalog, public';
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end;
$$;

-- Keep elevated implementations outside PostgREST's exposed schemas. Public
-- wrappers below run as the caller and retain the existing RPC names/signatures.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

alter function public.is_admin() set schema private;
alter function private.is_admin() rename to is_admin_impl;
alter function public.current_profile_id() set schema private;
alter function private.current_profile_id() rename to current_profile_id_impl;
alter function public.owns_site(uuid) set schema private;
alter function private.owns_site(uuid) rename to owns_site_impl;
alter function public.update_unit_threshold(uuid, numeric) set schema private;
alter function private.update_unit_threshold(uuid, numeric) rename to update_unit_threshold_impl;
alter function public.acknowledge_threshold_event(uuid) set schema private;
alter function private.acknowledge_threshold_event(uuid) rename to acknowledge_threshold_event_impl;
alter function public.acknowledge_anomaly_event(uuid) set schema private;
alter function private.acknowledge_anomaly_event(uuid) rename to acknowledge_anomaly_event_impl;
alter function public.submit_customer_request(uuid, public.service_request_type, text) set schema private;
alter function private.submit_customer_request(uuid, public.service_request_type, text) rename to submit_customer_request_impl;
alter function public.create_site_from_request(uuid, text) set schema private;
alter function private.create_site_from_request(uuid, text) rename to create_site_from_request_impl;
alter function public.assign_node(uuid, uuid) set schema private;
alter function private.assign_node(uuid, uuid) rename to assign_node_impl;
alter function public.archive_node(uuid) set schema private;
alter function private.archive_node(uuid) rename to archive_node_impl;
alter function public.archive_unit(uuid) set schema private;
alter function private.archive_unit(uuid) rename to archive_unit_impl;
alter function public.archive_site(uuid) set schema private;
alter function private.archive_site(uuid) rename to archive_site_impl;
alter function public.activate_customer() set schema private;
alter function private.activate_customer() rename to activate_customer_impl;
alter function public.register_node(text) set schema private;
alter function private.register_node(text) rename to register_node_impl;
alter function public.rotate_node_ingest_key(uuid) set schema private;
alter function private.rotate_node_ingest_key(uuid) rename to rotate_node_ingest_key_impl;
alter function public.get_customer_recent_readings(integer) set schema private;
alter function private.get_customer_recent_readings(integer) rename to get_customer_recent_readings_impl;

-- Moving functions preserves their old ACLs, so reset each implementation.
revoke all on function private.is_admin_impl() from public, anon, authenticated, service_role;
revoke all on function private.current_profile_id_impl() from public, anon, authenticated, service_role;
revoke all on function private.owns_site_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_unit_threshold_impl(uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_threshold_event_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_anomaly_event_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, text) from public, anon, authenticated, service_role;
revoke all on function private.create_site_from_request_impl(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.assign_node_impl(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.archive_node_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.archive_unit_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.archive_site_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.activate_customer_impl() from public, anon, authenticated, service_role;
revoke all on function private.register_node_impl(text) from public, anon, authenticated, service_role;
revoke all on function private.rotate_node_ingest_key_impl(uuid) from public, anon, authenticated, service_role;
revoke all on function private.get_customer_recent_readings_impl(integer) from public, anon, authenticated, service_role;

grant execute on function private.is_admin_impl() to authenticated;
grant execute on function private.current_profile_id_impl() to authenticated;
grant execute on function private.owns_site_impl(uuid) to authenticated;
grant execute on function private.update_unit_threshold_impl(uuid, numeric) to authenticated;
grant execute on function private.acknowledge_threshold_event_impl(uuid) to authenticated;
grant execute on function private.acknowledge_anomaly_event_impl(uuid) to authenticated;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, text) to authenticated;
grant execute on function private.create_site_from_request_impl(uuid, text) to authenticated;
grant execute on function private.assign_node_impl(uuid, uuid) to authenticated;
grant execute on function private.archive_node_impl(uuid) to authenticated;
grant execute on function private.archive_unit_impl(uuid) to authenticated;
grant execute on function private.archive_site_impl(uuid) to authenticated;
grant execute on function private.activate_customer_impl() to authenticated;
grant execute on function private.register_node_impl(text) to authenticated;
grant execute on function private.rotate_node_ingest_key_impl(uuid) to authenticated;
grant execute on function private.get_customer_recent_readings_impl(integer) to authenticated;

-- Harden every elevated implementation with a fixed path. All relation and
-- function references remain schema-qualified; extensions stays trusted.
alter function private.is_admin_impl() set search_path = pg_catalog, public, private, extensions;
alter function private.current_profile_id_impl() set search_path = pg_catalog, public, private, extensions;
alter function private.owns_site_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.update_unit_threshold_impl(uuid, numeric) set search_path = pg_catalog, public, private, extensions;
alter function private.acknowledge_threshold_event_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.acknowledge_anomaly_event_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.submit_customer_request_impl(uuid, public.service_request_type, text) set search_path = pg_catalog, public, private, extensions;
alter function private.create_site_from_request_impl(uuid, text) set search_path = pg_catalog, public, private, extensions;
alter function private.assign_node_impl(uuid, uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.archive_node_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.archive_unit_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.archive_site_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.activate_customer_impl() set search_path = pg_catalog, public, private, extensions;
alter function private.register_node_impl(text) set search_path = pg_catalog, public, private, extensions;
alter function private.rotate_node_ingest_key_impl(uuid) set search_path = pg_catalog, public, private, extensions;
alter function private.get_customer_recent_readings_impl(integer) set search_path = pg_catalog, public, private, extensions;

-- Internal authorization helpers retain their names for existing function bodies
-- and generated clients, but no public wrapper has elevated execution rights.
create function public.is_admin() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.is_admin_impl()
$$;
create function public.current_profile_id() returns uuid
language sql stable security invoker set search_path = '' as $$
  select private.current_profile_id_impl()
$$;
create function public.owns_site(target_site_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.owns_site_impl(target_site_id)
$$;

create function public.update_unit_threshold(target_unit_id uuid, new_threshold_deg numeric) returns void
language sql security invoker set search_path = '' as $$
  select private.update_unit_threshold_impl(target_unit_id, new_threshold_deg)
$$;
create function public.acknowledge_threshold_event(target_event_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.acknowledge_threshold_event_impl(target_event_id)
$$;
create function public.acknowledge_anomaly_event(target_event_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.acknowledge_anomaly_event_impl(target_event_id)
$$;
create function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_details text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(target_site_id, target_request_type, target_details)
$$;
create function public.create_site_from_request(target_request_id uuid, target_site_name text) returns uuid
language sql security invoker set search_path = '' as $$
  select private.create_site_from_request_impl(target_request_id, target_site_name)
$$;
create function public.assign_node(target_node_id uuid, target_unit_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.assign_node_impl(target_node_id, target_unit_id)
$$;
create function public.archive_node(target_node_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.archive_node_impl(target_node_id)
$$;
create function public.archive_unit(target_unit_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.archive_unit_impl(target_unit_id)
$$;
create function public.archive_site(target_site_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.archive_site_impl(target_site_id)
$$;
create function public.activate_customer() returns void
language sql security invoker set search_path = '' as $$
  select private.activate_customer_impl()
$$;
create function public.register_node(target_mac text) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.register_node_impl(target_mac)
$$;
create function public.rotate_node_ingest_key(target_node_id uuid) returns text
language sql security invoker set search_path = '' as $$
  select private.rotate_node_ingest_key_impl(target_node_id)
$$;
create function public.get_customer_recent_readings(points_per_sensor integer default 120)
returns setof public.sensor_readings
language sql stable security invoker set search_path = '' as $$
  select * from private.get_customer_recent_readings_impl(points_per_sensor)
$$;

-- New functions are executable by PUBLIC by default; explicitly close that gap.
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
revoke all on function public.current_profile_id() from public, anon, authenticated, service_role;
revoke all on function public.owns_site(uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_unit_threshold(uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_threshold_event(uuid) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_anomaly_event(uuid) from public, anon, authenticated, service_role;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, text) from public, anon, authenticated, service_role;
revoke all on function public.create_site_from_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.assign_node(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.archive_node(uuid) from public, anon, authenticated, service_role;
revoke all on function public.archive_unit(uuid) from public, anon, authenticated, service_role;
revoke all on function public.archive_site(uuid) from public, anon, authenticated, service_role;
revoke all on function public.activate_customer() from public, anon, authenticated, service_role;
revoke all on function public.register_node(text) from public, anon, authenticated, service_role;
revoke all on function public.rotate_node_ingest_key(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_customer_recent_readings(integer) from public, anon, authenticated, service_role;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.owns_site(uuid) to authenticated;
grant execute on function public.update_unit_threshold(uuid, numeric) to authenticated;
grant execute on function public.acknowledge_threshold_event(uuid) to authenticated;
grant execute on function public.acknowledge_anomaly_event(uuid) to authenticated;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, text) to authenticated;
grant execute on function public.create_site_from_request(uuid, text) to authenticated;
grant execute on function public.assign_node(uuid, uuid) to authenticated;
grant execute on function public.archive_node(uuid) to authenticated;
grant execute on function public.archive_unit(uuid) to authenticated;
grant execute on function public.archive_site(uuid) to authenticated;
grant execute on function public.activate_customer() to authenticated;
grant execute on function public.register_node(text) to authenticated;
grant execute on function public.rotate_node_ingest_key(uuid) to authenticated;
grant execute on function public.get_customer_recent_readings(integer) to authenticated;

-- A restrictive deny policy documents the deliberate service-role-only table and
-- removes the RLS-enabled-without-policy Advisor finding without granting access.
create policy anomaly_analysis_runs_deny_clients
on public.anomaly_analysis_runs
as restrictive for all to anon, authenticated
using (false)
with check (false);

-- Replace overlapping permissive policies with one policy per role/action.
drop policy profiles_admin_all on public.profiles;
drop policy profiles_customer_select on public.profiles;
drop policy profiles_customer_update on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (public.is_admin() or id = public.current_profile_id());
create policy profiles_insert_admin on public.profiles
for insert to authenticated
with check (public.is_admin());
create policy profiles_update on public.profiles
for update to authenticated
using (public.is_admin() or id = public.current_profile_id())
with check (
  public.is_admin()
  or (
    id = public.current_profile_id()
    and role = 'customer'
    and auth_user_id = (select auth.uid())
    and account_status = 'active'
  )
);
create policy profiles_delete_admin on public.profiles
for delete to authenticated
using (public.is_admin());

drop policy sites_admin_all on public.sites;
drop policy sites_customer_select on public.sites;
create policy sites_select on public.sites
for select to authenticated
using (public.is_admin() or (customer_id = public.current_profile_id() and archived_at is null));
create policy sites_insert_admin on public.sites for insert to authenticated with check (public.is_admin());
create policy sites_update_admin on public.sites for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sites_delete_admin on public.sites for delete to authenticated using (public.is_admin());

drop policy units_admin_all on public.units;
drop policy units_customer_select on public.units;
create policy units_select on public.units
for select to authenticated
using (public.is_admin() or (public.owns_site(site_id) and archived_at is null));
create policy units_insert_admin on public.units for insert to authenticated with check (public.is_admin());
create policy units_update_admin on public.units for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy units_delete_admin on public.units for delete to authenticated using (public.is_admin());

drop policy nodes_admin_all on public.nodes;
drop policy nodes_customer_select on public.nodes;
create policy nodes_select on public.nodes
for select to authenticated
using (
  public.is_admin()
  or (
    unit_id is not null
    and exists (
      select 1 from public.units
      where units.id = nodes.unit_id and public.owns_site(units.site_id)
    )
    and archived_at is null
  )
);
create policy nodes_insert_admin on public.nodes for insert to authenticated with check (public.is_admin());
create policy nodes_update_admin on public.nodes for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy nodes_delete_admin on public.nodes for delete to authenticated using (public.is_admin());

drop policy sensors_admin_all on public.sensors;
drop policy sensors_customer_select on public.sensors;
create policy sensors_select on public.sensors
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.nodes
    join public.units on units.id = nodes.unit_id
    where nodes.id = sensors.node_id and public.owns_site(units.site_id)
  )
);
create policy sensors_insert_admin on public.sensors for insert to authenticated with check (public.is_admin());
create policy sensors_update_admin on public.sensors for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sensors_delete_admin on public.sensors for delete to authenticated using (public.is_admin());

drop policy readings_admin_select on public.sensor_readings;
drop policy readings_customer_select on public.sensor_readings;
create policy readings_select on public.sensor_readings
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.sensors
    join public.nodes on nodes.id = sensors.node_id
    join public.units on units.id = nodes.unit_id
    where sensors.id = sensor_readings.sensor_id and public.owns_site(units.site_id)
  )
);

drop policy threshold_events_admin_all on public.threshold_events;
drop policy threshold_events_customer_select on public.threshold_events;
create policy threshold_events_select on public.threshold_events
for select to authenticated
using (
  public.is_admin()
  or public.owns_site((select site_id from public.units where id = threshold_events.unit_id))
);
create policy threshold_events_insert_admin on public.threshold_events for insert to authenticated with check (public.is_admin());
create policy threshold_events_update_admin on public.threshold_events for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy threshold_events_delete_admin on public.threshold_events for delete to authenticated using (public.is_admin());

drop policy anomaly_events_admin_all on public.anomaly_events;
drop policy anomaly_events_customer_select on public.anomaly_events;
create policy anomaly_events_select on public.anomaly_events
for select to authenticated
using (
  public.is_admin()
  or public.owns_site((select site_id from public.units where id = anomaly_events.unit_id))
);
create policy anomaly_events_insert_admin on public.anomaly_events for insert to authenticated with check (public.is_admin());
create policy anomaly_events_update_admin on public.anomaly_events for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy anomaly_events_delete_admin on public.anomaly_events for delete to authenticated using (public.is_admin());

drop policy requests_admin_all on public.service_requests;
drop policy requests_customer_select on public.service_requests;
create policy requests_select on public.service_requests
for select to authenticated
using (
  public.is_admin()
  or requester_id = public.current_profile_id()
  or (site_id is not null and public.owns_site(site_id))
);
create policy requests_insert_admin on public.service_requests for insert to authenticated with check (public.is_admin());
create policy requests_update_admin on public.service_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy requests_delete_admin on public.service_requests for delete to authenticated using (public.is_admin());

drop policy attachments_admin_select on public.request_attachments;
drop policy attachments_customer_select on public.request_attachments;
create policy attachments_select on public.request_attachments
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.service_requests
    where service_requests.id = request_attachments.request_id
      and (
        service_requests.requester_id = public.current_profile_id()
        or (service_requests.site_id is not null and public.owns_site(service_requests.site_id))
      )
  )
);

drop policy sensor_baselines_admin_all on public.sensor_baselines;
drop policy sensor_baselines_customer_select on public.sensor_baselines;
create policy sensor_baselines_select on public.sensor_baselines
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.sensors
    join public.nodes on nodes.id = sensors.node_id
    join public.units on units.id = nodes.unit_id
    where sensors.id = sensor_baselines.sensor_id and public.owns_site(units.site_id)
  )
);
create policy sensor_baselines_insert_admin on public.sensor_baselines for insert to authenticated with check (public.is_admin());
create policy sensor_baselines_update_admin on public.sensor_baselines for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sensor_baselines_delete_admin on public.sensor_baselines for delete to authenticated using (public.is_admin());

-- Storage had the same overlapping SELECT shape even though it was not listed in
-- the initial report. Consolidate it proactively.
drop policy request_files_admin_select on storage.objects;
drop policy request_files_customer_select on storage.objects;
create policy request_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'request-attachments'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.request_attachments
      join public.service_requests on service_requests.id = request_attachments.request_id
      where request_attachments.storage_path = storage.objects.name
        and (
          service_requests.requester_id = public.current_profile_id()
          or (service_requests.site_id is not null and public.owns_site(service_requests.site_id))
        )
    )
  )
);

notify pgrst, 'reload schema';
