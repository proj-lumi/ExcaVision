-- 0001_schema.sql — ownership + data tables (BACKEND_SPEC.md §3)
-- Run order matters: create in this order.

-- ── Ownership chain: profile → site → pipe → sensor_node → sensor ──
-- "users" from the spec is Supabase's managed auth.users + this profiles table.

create table if not exists public.sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  lat        double precision,
  lon        double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'crew',   -- 'engineer' | 'crew' | 'inspector'
  site_id    uuid references public.sites(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pipes (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references public.sites(id) on delete cascade,
  name                text not null,
  installed_at        timestamptz,
  alert_threshold_deg real not null default 2.0,   -- engineer-set, pushed to nodes
  created_at          timestamptz not null default now()
);

create table if not exists public.sensor_nodes (
  id               uuid primary key default gen_random_uuid(),
  pipe_id          uuid not null references public.pipes(id) on delete cascade,
  position_in_pipe smallint not null,             -- 1 = top (gateway), 2, 3, ...
  mac_addr         text not null unique,          -- the join key: "24:0A:C4:…"
  is_gateway       boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists public.sensors (
  id         uuid primary key default gen_random_uuid(),
  node_id    uuid not null references public.sensor_nodes(id) on delete cascade,
  channel    smallint not null,                   -- TCA channel 0..7
  label      text not null default '',            -- "S1".."S4"
  created_at timestamptz not null default now(),
  unique (node_id, channel)
);

-- ── Data: what the node writes + what the app/ML read ──

create table if not exists public.baselines (
  id            uuid primary key default gen_random_uuid(),
  sensor_id     uuid not null references public.sensors(id) on delete cascade,
  captured_at   timestamptz not null default now(),
  bx real not null,
  by real not null,
  bz real not null,
  supersedes_id uuid references public.baselines(id)   -- new row points at the old one
);

create table if not exists public.readings (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  sensor_id  uuid not null references public.sensors(id) on delete cascade,
  tilt       real not null,
  g_mag      real not null,
  temp_c     real not null,
  n          integer not null default 0,          -- samples averaged in the window
  fail       integer not null default 0,          -- failed reads in the window
  alert_flag boolean not null default false       -- set when the node tripped threshold
);

create table if not exists public.readings_1min (
  ts         timestamptz not null,                -- minute bucket
  sensor_id  uuid not null references public.sensors(id) on delete cascade,
  tilt_mean  real,
  g_mag_mean real,
  temp_c_mean real,
  n_sum      integer,
  fail_sum   integer,
  primary key (sensor_id, ts)
);

create table if not exists public.alerts (
  id              uuid primary key default gen_random_uuid(),
  ts              timestamptz not null default now(),
  sensor_id       uuid not null references public.sensors(id) on delete cascade,
  kind            text not null,                  -- 'threshold' | 'model'
  severity        text not null,                  -- 'warning' | 'critical'
  value           real,
  acknowledged_at timestamptz
);

create table if not exists public.risk_scores (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),
  node_id        uuid not null references public.sensor_nodes(id) on delete cascade,
  predicted_tilt real,
  actual_tilt    real,
  anomaly_score  real,
  model_version  text
);

-- ── Indexes (the hot paths) ──

create index if not exists readings_sensor_ts_idx on public.readings (sensor_id, ts desc);
create index if not exists readings_ts_idx        on public.readings (ts);
create index if not exists baselines_sensor_idx   on public.baselines (sensor_id, captured_at desc);
create index if not exists alerts_ts_idx          on public.alerts (ts desc);
