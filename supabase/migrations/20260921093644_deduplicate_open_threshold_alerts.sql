-- Keep one open threshold alert per sensor. A flapping sensor must not
-- generate a new email on every false->active transition.
with ranked_open_alerts as (
  select
    id,
    row_number() over (
      partition by sensor_id
      order by detected_at desc, id desc
    ) as alert_rank
  from public.threshold_events
  where acknowledged_at is null
)
update public.threshold_events as events
set acknowledged_at = coalesce(events.acknowledged_at, pg_catalog.now())
from ranked_open_alerts as ranked
where events.id = ranked.id
  and ranked.alert_rank > 1;

create unique index if not exists threshold_events_one_open_per_sensor_idx
  on public.threshold_events (sensor_id)
  where acknowledged_at is null;

create or replace function public.record_node_threshold_event(
  target_gateway_id uuid,
  target_mac text,
  target_channel integer,
  target_observed_value_deg numeric
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
    and nodes.mac_address = pg_catalog.upper(pg_catalog.btrim(target_mac))
    and nodes.status = 'assigned'
    and sensors.hardware_channel = target_channel;

  if target_sensor_id is null then
    raise exception 'registered_sensor_not_found' using errcode = 'P0001';
  end if;

  -- Also apply a cooldown after acknowledgement. Re-arming at the threshold
  -- should not send another notification every few seconds while a sensor is
  -- physically oscillating.
  select id
  into event_id
  from public.threshold_events
  where sensor_id = target_sensor_id
    and detected_at > pg_catalog.now() - interval '15 minutes'
  order by detected_at desc
  limit 1;

  if event_id is not null then
    return null;
  end if;

  insert into public.threshold_events (
    unit_id, sensor_id, observed_value_deg, threshold_deg
  ) values (
    target_unit_id, target_sensor_id, target_observed_value_deg, target_threshold
  )
  on conflict (sensor_id) where acknowledged_at is null do nothing
  returning id into event_id;

  -- NULL means this sensor already has an open event. The caller must not
  -- send another push or email for the duplicate transition.
  return event_id;
end;
$$;
