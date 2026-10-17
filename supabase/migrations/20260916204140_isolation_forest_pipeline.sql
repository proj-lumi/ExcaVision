-- Isolation Forest analysis bookkeeping and idempotent anomaly creation.

create table public.anomaly_analysis_runs (
  id bigint generated always as identity primary key,
  sensor_id uuid references public.sensors(id) on delete set null,
  candidate_recorded_at timestamptz,
  model_version text not null,
  training_points smallint not null default 0 check (training_points >= 0),
  anomaly_score numeric(8,6) check (anomaly_score between 0 and 1),
  status text not null check (status in ('detected', 'normal', 'skipped', 'failed')),
  error_message text,
  analyzed_at timestamptz not null default now()
);

create unique index anomaly_runs_sensor_candidate_model_key
  on public.anomaly_analysis_runs(sensor_id, candidate_recorded_at, model_version)
  where sensor_id is not null and candidate_recorded_at is not null;
create index anomaly_runs_analyzed_idx
  on public.anomaly_analysis_runs(analyzed_at desc);

alter table public.anomaly_analysis_runs enable row level security;
revoke all on public.anomaly_analysis_runs from public, anon, authenticated;
grant select, insert on public.anomaly_analysis_runs to service_role;

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
language plpgsql security definer set search_path = public as $$
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
  on conflict (sensor_id, window_started_at, detection_method) do nothing
  returning id into event_id;

  if event_id is null then
    select id into event_id
    from public.anomaly_events
    where sensor_id = target_sensor_id
      and window_started_at = target_window_started_at
      and detection_method = 'isolation_forest';
  end if;
  return event_id;
end;
$$;

revoke execute on function public.record_isolation_forest_event(uuid, timestamptz, numeric, numeric, numeric, smallint, smallint, text) from public, anon, authenticated;
grant execute on function public.record_isolation_forest_event(uuid, timestamptz, numeric, numeric, numeric, smallint, smallint, text) to service_role;

comment on table public.anomaly_analysis_runs is
  'Operational ledger for scheduled Isolation Forest analyses, including normal and failed runs.';
comment on function public.record_isolation_forest_event(uuid, timestamptz, numeric, numeric, numeric, smallint, smallint, text) is
  'Creates one idempotent Isolation Forest advisory for a sensor/window.';
