-- supabase/migrations/xxxxxxxxxxxxxx_create_tilt_data_table.sql

create table if not exists public.tilt_data (
  id bigint generated always as identity primary key,
  device_id text not null default 'esp32-01',
  accel_x real not null,
  accel_y real not null,
  accel_z real not null,
  recorded_at timestamptz not null default now()
);

-- Index for querying recent readings efficiently
create index if not exists idx_tilt_data_recorded_at
  on public.tilt_data (recorded_at desc);

-- Enable Row Level Security (required, since publishable key is low-privilege)
alter table public.tilt_data enable row level security;

-- Allow inserts from the publishable/anon role
-- (This is permissive for testing — tighten before production, e.g. scope by device_id/API key)
create policy "Allow inserts from anon"
  on public.tilt_data
  for insert
  to anon
  with check (true);
