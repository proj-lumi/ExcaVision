-- Finalize the Gateway-scoped telemetry contract for databases that already
-- applied an earlier development version of migration 0005.

alter table public.anomaly_events
  add column if not exists model_version text not null default 'isolation-forest-v1',
  add column if not exists window_started_at timestamptz;

update public.anomaly_events
set window_started_at = detected_at
where window_started_at is null;

alter table public.anomaly_events
  alter column window_started_at set not null;

create unique index if not exists anomaly_events_sensor_window_method_key
  on public.anomaly_events(sensor_id, window_started_at, detection_method);
create index if not exists anomaly_events_sensor_detected_idx
  on public.anomaly_events(sensor_id, detected_at desc);

-- Remove the earlier unscoped overloads. Keeping them would allow any holder of
-- the service-role credential to write arbitrary MAC-tagged telemetry.
drop function if exists public.ingest_node_readings(jsonb);
drop function if exists public.record_node_threshold_event(text, integer, numeric);
drop function if exists public.upsert_sensor_baseline(text, integer, numeric, numeric, numeric);
drop function if exists public.get_node_config(text);
drop function if exists public.get_sensor_baselines(text);

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

revoke execute on function public.ingest_node_readings(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.record_node_threshold_event(uuid, text, integer, numeric) from public, anon, authenticated;
revoke execute on function public.upsert_sensor_baseline(uuid, text, integer, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.get_node_config(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_sensor_baselines(uuid, text) from public, anon, authenticated;

grant execute on function public.ingest_node_readings(uuid, jsonb) to service_role;
grant execute on function public.record_node_threshold_event(uuid, text, integer, numeric) to service_role;
grant execute on function public.upsert_sensor_baseline(uuid, text, integer, numeric, numeric, numeric) to service_role;
grant execute on function public.get_node_config(uuid, text) to service_role;
grant execute on function public.get_sensor_baselines(uuid, text) to service_role;
