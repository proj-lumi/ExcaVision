-- Align the database with the ESP32 telemetry contract and keep customer reads bounded.

alter table public.sensors
  add column hardware_channel smallint;

update public.sensors
set hardware_channel = case position
  when 1 then 7
  when 2 then 3
  when 3 then 5
  when 4 then 1
  else position - 1
end
where hardware_channel is null and position between 1 and 8;

alter table public.sensors
  add constraint sensors_hardware_channel_check check (hardware_channel between 0 and 7);

create unique index sensors_node_hardware_channel_key
  on public.sensors(node_id, hardware_channel)
  where hardware_channel is not null;

alter table public.sensor_readings
  add column gravity_magnitude_g numeric(8,4),
  add column temperature_c numeric(6,2),
  add column sample_count integer not null default 0 check (sample_count >= 0),
  add column failure_count integer not null default 0 check (failure_count >= 0),
  add column alert_flag boolean not null default false;

create table public.sensor_baselines (
  sensor_id uuid primary key references public.sensors(id) on delete cascade,
  baseline_x numeric(9,6) not null,
  baseline_y numeric(9,6) not null,
  baseline_z numeric(9,6) not null,
  captured_at timestamptz not null default now()
);

-- Device credentials are deliberately outside the Data API's exposed schemas.
-- Only tightly scoped security-definer functions can read or change them.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.node_credentials (
  node_id uuid primary key references public.nodes(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz not null default now()
);

revoke all on private.node_credentials from public, anon, authenticated;

alter table public.sensor_baselines enable row level security;
grant select, insert, update, delete on public.sensor_baselines to authenticated, service_role;

create policy sensor_baselines_admin_all on public.sensor_baselines
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy sensor_baselines_customer_select on public.sensor_baselines
for select to authenticated
using (
  exists (
    select 1
    from public.sensors
    join public.nodes on nodes.id = sensors.node_id
    join public.units on units.id = nodes.unit_id
    where sensors.id = sensor_baselines.sensor_id
      and public.owns_site(units.site_id)
  )
);

-- Every deployment node has four logical sensors. Hardware channels follow the
-- production TCA map documented by firmware: S1=7, S2=3, S3=5, S4=1.
create or replace function public.provision_node_sensors(target_node_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.sensors (node_id, position, hardware_channel, label)
  values
    (target_node_id, 1, 7, 'Sensor 1'),
    (target_node_id, 2, 3, 'Sensor 2'),
    (target_node_id, 3, 5, 'Sensor 3'),
    (target_node_id, 4, 1, 'Sensor 4')
  on conflict (node_id, position) do update
  set hardware_channel = excluded.hardware_channel,
      label = case when public.sensors.label = '' then excluded.label else public.sensors.label end;
$$;

create or replace function public.register_node(target_mac text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  normalized_mac text := upper(trim(target_mac));
  new_node public.nodes%rowtype;
  plain_key text;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if normalized_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then
    raise exception 'invalid_mac_address' using errcode = '22023';
  end if;

  plain_key := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.nodes (mac_address)
  values (normalized_mac)
  returning * into new_node;

  insert into private.node_credentials (node_id, key_hash)
  values (new_node.id, encode(extensions.digest(plain_key, 'sha256'), 'hex'));

  return jsonb_build_object('node', to_jsonb(new_node), 'ingest_key', plain_key);
end;
$$;

create or replace function public.rotate_node_ingest_key(target_node_id uuid) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  plain_key text;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.nodes where id = target_node_id and status <> 'archived') then
    raise exception 'node_unavailable' using errcode = 'P0001';
  end if;

  plain_key := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.node_credentials (node_id, key_hash, rotated_at)
  values (target_node_id, encode(extensions.digest(plain_key, 'sha256'), 'hex'), now())
  on conflict (node_id) do update
  set key_hash = excluded.key_hash,
      rotated_at = excluded.rotated_at;
  return plain_key;
end;
$$;

create or replace function public.authenticate_gateway(
  target_mac text,
  target_key_hash text
) returns uuid
language sql stable security definer set search_path = public, private as $$
  select nodes.id
  from public.nodes
  join private.node_credentials on node_credentials.node_id = nodes.id
  join public.units on units.id = nodes.unit_id
  join public.sites on sites.id = units.site_id
  where nodes.mac_address = upper(trim(target_mac))
    and node_credentials.key_hash = lower(target_key_hash)
    and nodes.status = 'assigned'
    and nodes.position = 1
    and units.status = 'active'
    and sites.archived_at is null
  limit 1;
$$;

create or replace function public.assign_node(target_node_id uuid, target_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  next_position int;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.nodes where id = target_node_id and status = 'unassigned') then
    raise exception 'node_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.units where id = target_unit_id and status <> 'archived') then
    raise exception 'unit_unavailable' using errcode = 'P0001';
  end if;
  select coalesce(max(position), 0) + 1 into next_position
  from public.nodes where unit_id = target_unit_id and status = 'assigned';
  update public.nodes
  set status = 'assigned', unit_id = target_unit_id, position = next_position
  where id = target_node_id;
  perform public.provision_node_sensors(target_node_id);
  perform public.sync_unit_status(target_unit_id);
end;
$$;

select public.provision_node_sensors(id)
from public.nodes
where status = 'assigned';

-- Return a bounded history per sensor. This prevents a long-running deployment
-- from downloading its complete telemetry history into the browser.
create or replace function public.get_customer_recent_readings(points_per_sensor integer default 120)
returns setof public.sensor_readings
language sql stable security definer set search_path = public as $$
  with ranked as (
    select readings.*,
           row_number() over (partition by readings.sensor_id order by readings.recorded_at desc) as reading_rank
    from public.sensor_readings as readings
    join public.sensors on sensors.id = readings.sensor_id
    join public.nodes on nodes.id = sensors.node_id
    join public.units on units.id = nodes.unit_id
    where (public.is_admin() or public.owns_site(units.site_id))
  )
  select id, sensor_id, tilt_deg, recorded_at,
         gravity_magnitude_g, temperature_c, sample_count, failure_count, alert_flag
  from ranked
  where reading_rank <= least(greatest(points_per_sensor, 1), 500)
  order by recorded_at asc;
$$;

-- Service-role-only primitives used by the scoped node-telemetry Edge Function.
-- The authenticated gateway may relay data only for nodes in its own Unit.
create or replace function public.ingest_node_readings(
  target_gateway_id uuid,
  target_readings jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  inserted_count integer;
  gateway_unit_id uuid;
begin
  select unit_id into gateway_unit_id
  from public.nodes
  where id = target_gateway_id
    and status = 'assigned'
    and position = 1;
  if gateway_unit_id is null then
    raise exception 'gateway_not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(target_readings) <> 'array' or jsonb_array_length(target_readings) = 0 then
    raise exception 'readings_required' using errcode = '22023';
  end if;
  if jsonb_array_length(target_readings) > 50 then
    raise exception 'reading_batch_too_large' using errcode = '22023';
  end if;

  with incoming as (
    select upper(trim(item.mac_address)) as mac_address,
           item.hardware_channel::smallint as hardware_channel,
           item.tilt_deg::numeric as tilt_deg,
           item.gravity_magnitude_g::numeric as gravity_magnitude_g,
           item.temperature_c::numeric as temperature_c,
           greatest(item.sample_count, 0)::integer as sample_count,
           greatest(item.failure_count, 0)::integer as failure_count,
           item.alert_flag
    from jsonb_to_recordset(target_readings) as item(
      mac_address text,
      hardware_channel integer,
      tilt_deg numeric,
      gravity_magnitude_g numeric,
      temperature_c numeric,
      sample_count integer,
      failure_count integer,
      alert_flag boolean
    )
  ), inserted as (
    insert into public.sensor_readings (
      sensor_id, tilt_deg, gravity_magnitude_g, temperature_c,
      sample_count, failure_count, alert_flag
    )
    select sensors.id, incoming.tilt_deg, incoming.gravity_magnitude_g,
           incoming.temperature_c, incoming.sample_count,
           incoming.failure_count, coalesce(incoming.alert_flag, false)
    from incoming
    join public.nodes on nodes.mac_address = incoming.mac_address
      and nodes.status = 'assigned'
      and nodes.unit_id = gateway_unit_id
    join public.sensors on sensors.node_id = nodes.id
      and sensors.hardware_channel = incoming.hardware_channel
    returning 1
  )
  select count(*) into inserted_count from inserted;

  update public.nodes
  set connection_state = case
        when position = 1 then 'cloud_online'::public.node_connection_state
        else 'local_reporting'::public.node_connection_state
      end,
      last_seen_at = now()
  where status = 'assigned'
    and unit_id = gateway_unit_id
    and mac_address in (
      select upper(trim(item.mac_address))
      from jsonb_to_recordset(target_readings) as item(mac_address text)
    );

  -- An authenticated request proves that the gateway itself reached the cloud,
  -- even when this batch happened to contain only relayed slave readings.
  update public.nodes
  set connection_state = 'cloud_online', last_seen_at = now()
  where id = target_gateway_id;

  if inserted_count = 0 then
    raise exception 'no_registered_sensors_matched' using errcode = 'P0001';
  end if;
  return inserted_count;
end;
$$;

create or replace function public.record_node_threshold_event(
  target_gateway_id uuid,
  target_mac text,
  target_channel integer,
  target_observed_value_deg numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  target_sensor_id uuid;
  target_unit_id uuid;
  target_threshold numeric;
  event_id uuid;
begin
  select sensors.id, units.id, units.alert_threshold_deg
  into target_sensor_id, target_unit_id, target_threshold
  from public.nodes as gateway
  join public.nodes on nodes.unit_id = gateway.unit_id
  join public.units on units.id = nodes.unit_id and units.status = 'active'
  join public.sensors on sensors.node_id = nodes.id
  where gateway.id = target_gateway_id
    and gateway.status = 'assigned'
    and gateway.position = 1
    and nodes.mac_address = upper(trim(target_mac))
    and nodes.status = 'assigned'
    and sensors.hardware_channel = target_channel;

  if target_sensor_id is null then
    raise exception 'registered_sensor_not_found' using errcode = 'P0001';
  end if;

  insert into public.threshold_events (
    unit_id, sensor_id, observed_value_deg, threshold_deg
  ) values (
    target_unit_id, target_sensor_id, target_observed_value_deg, target_threshold
  ) returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.upsert_sensor_baseline(
  target_gateway_id uuid,
  target_mac text,
  target_channel integer,
  target_baseline_x numeric,
  target_baseline_y numeric,
  target_baseline_z numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target_sensor_id uuid;
begin
  select sensors.id into target_sensor_id
  from public.nodes as gateway
  join public.nodes on nodes.unit_id = gateway.unit_id
  join public.sensors on sensors.node_id = nodes.id
  where gateway.id = target_gateway_id
    and gateway.status = 'assigned'
    and gateway.position = 1
    and nodes.mac_address = upper(trim(target_mac))
    and nodes.status = 'assigned'
    and sensors.hardware_channel = target_channel;

  if target_sensor_id is null then
    raise exception 'registered_sensor_not_found' using errcode = 'P0001';
  end if;

  insert into public.sensor_baselines (
    sensor_id, baseline_x, baseline_y, baseline_z, captured_at
  ) values (
    target_sensor_id, target_baseline_x, target_baseline_y, target_baseline_z, now()
  )
  on conflict (sensor_id) do update
  set baseline_x = excluded.baseline_x,
      baseline_y = excluded.baseline_y,
      baseline_z = excluded.baseline_z,
      captured_at = excluded.captured_at;
end;
$$;

create or replace function public.get_node_config(
  target_gateway_id uuid,
  target_mac text
) returns table (threshold_deg numeric)
language sql stable security definer set search_path = public as $$
  select units.alert_threshold_deg
  from public.nodes as gateway
  join public.nodes on nodes.unit_id = gateway.unit_id
  join public.units on units.id = nodes.unit_id
  where gateway.id = target_gateway_id
    and gateway.status = 'assigned'
    and gateway.position = 1
    and nodes.mac_address = upper(trim(target_mac))
    and nodes.status = 'assigned'
    and units.status = 'active'
  limit 1;
$$;

create or replace function public.get_sensor_baselines(
  target_gateway_id uuid,
  target_mac text
) returns table (channel smallint, bx numeric, by numeric, bz numeric)
language sql stable security definer set search_path = public as $$
  select sensors.hardware_channel,
         sensor_baselines.baseline_x,
         sensor_baselines.baseline_y,
         sensor_baselines.baseline_z
  from public.nodes as gateway
  join public.nodes on nodes.unit_id = gateway.unit_id
  join public.sensors on sensors.node_id = nodes.id
  join public.sensor_baselines on sensor_baselines.sensor_id = sensors.id
  where gateway.id = target_gateway_id
    and gateway.status = 'assigned'
    and gateway.position = 1
    and nodes.mac_address = upper(trim(target_mac))
    and nodes.status = 'assigned'
  order by sensors.position;
$$;

revoke execute on function public.provision_node_sensors(uuid) from public, anon, authenticated;
revoke execute on function public.register_node(text) from public, anon;
revoke execute on function public.rotate_node_ingest_key(uuid) from public, anon;
revoke execute on function public.authenticate_gateway(text, text) from public, anon, authenticated;
revoke execute on function public.get_customer_recent_readings(integer) from public, anon;
revoke execute on function public.ingest_node_readings(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.record_node_threshold_event(uuid, text, integer, numeric) from public, anon, authenticated;
revoke execute on function public.upsert_sensor_baseline(uuid, text, integer, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.get_node_config(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_sensor_baselines(uuid, text) from public, anon, authenticated;

grant execute on function public.register_node(text) to authenticated;
grant execute on function public.rotate_node_ingest_key(uuid) to authenticated;
grant execute on function public.get_customer_recent_readings(integer) to authenticated;
grant execute on function public.provision_node_sensors(uuid) to service_role;
grant execute on function public.authenticate_gateway(text, text) to service_role;
grant execute on function public.ingest_node_readings(uuid, jsonb) to service_role;
grant execute on function public.record_node_threshold_event(uuid, text, integer, numeric) to service_role;
grant execute on function public.upsert_sensor_baseline(uuid, text, integer, numeric, numeric, numeric) to service_role;
grant execute on function public.get_node_config(uuid, text) to service_role;
grant execute on function public.get_sensor_baselines(uuid, text) to service_role;

-- Publish only mutable operational data used by the live applications.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'service_requests', 'sites', 'units', 'nodes',
    'sensor_readings', 'threshold_events', 'anomaly_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

comment on function public.get_customer_recent_readings(integer) is
  'Returns at most N recent readings per sensor for the authenticated customer or admin.';
comment on function public.ingest_node_readings(uuid, jsonb) is
  'Service-role-only telemetry ingestion scoped to the authenticated gateway Unit.';
