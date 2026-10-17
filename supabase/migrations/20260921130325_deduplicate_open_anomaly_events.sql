-- One open Isolation Forest warning per sensor, mirroring the threshold-alert
-- rule, plus a short cooldown.
--
-- Why: a continuous lift (a sensor being raised by hand) made every scored
-- reading above the movement floor its own warning. The detector already checks
-- this before calling the RPC; this migration makes the database enforce it too.

with ranked_open_events as (
  select
    id,
    row_number() over (
      partition by sensor_id
      order by detected_at desc, id desc
    ) as event_rank
  from public.anomaly_events
  where acknowledged_at is null
)
update public.anomaly_events as events
set acknowledged_at = coalesce(events.acknowledged_at, pg_catalog.now())
from ranked_open_events as ranked
where events.id = ranked.id
  and ranked.event_rank > 1;

create unique index if not exists anomaly_events_one_open_per_sensor_idx
  on public.anomaly_events (sensor_id)
  where acknowledged_at is null;

create or replace function public.record_isolation_forest_event(
  target_sensor_id uuid,
  target_window_started_at timestamptz,
  target_observed_value_deg numeric,
  target_baseline_value_deg numeric,
  target_anomaly_score numeric,
  target_anomalous_readings smallint,
  target_window_size smallint,
  target_model_version text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_unit_id uuid;
  target_node_id uuid;
  event_id uuid;
begin
  if target_anomaly_score < 0 or target_anomaly_score > 1 then
    raise exception 'invalid_anomaly_score' using errcode = '22023';
  end if;
  if target_window_size < target_anomalous_readings or target_anomalous_readings < 1 then
    raise exception 'invalid_anomaly_window' using errcode = '22023';
  end if;

  select units.id, nodes.id
  into target_unit_id, target_node_id
  from public.sensors
  join public.nodes on nodes.id = sensors.node_id and nodes.status = 'assigned'
  join public.units on units.id = nodes.unit_id and units.status = 'active'
  where sensors.id = target_sensor_id;
  if target_unit_id is null then
    raise exception 'sensor_unavailable' using errcode = 'P0001';
  end if;

  -- Suppress a repeat while one warning is still open, or within the cooldown.
  select id
  into event_id
  from public.anomaly_events
  where sensor_id = target_sensor_id
    and (
      acknowledged_at is null
      or detected_at > pg_catalog.now() - interval '10 minutes'
    )
  order by detected_at desc
  limit 1;

  if event_id is not null then
    return null;   -- no new event, so the caller must not notify again
  end if;

  begin
    insert into public.anomaly_events (
      unit_id, node_id, sensor_id, detection_method,
      observed_value_deg, baseline_value_deg, anomaly_score,
      anomalous_readings, window_size, model_version, window_started_at
    ) values (
      target_unit_id, target_node_id, target_sensor_id, 'isolation_forest',
      target_observed_value_deg, target_baseline_value_deg, target_anomaly_score,
      target_anomalous_readings, target_window_size, target_model_version,
      target_window_started_at
    )
    returning id into event_id;
  exception when unique_violation then
    return null;   -- another window already represents this movement
  end;

  return event_id;
end;
$$;

revoke execute on function public.record_isolation_forest_event(uuid, timestamptz, numeric, numeric, numeric, smallint, smallint, text) from public, anon, authenticated;
grant execute on function public.record_isolation_forest_event(uuid, timestamptz, numeric, numeric, numeric, smallint, smallint, text) to service_role;
