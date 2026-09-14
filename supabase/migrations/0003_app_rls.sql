-- 0003_app_rls.sql — app-side row-level security (feat/app, publishable key + JWT).
-- The NODE is unaffected by RLS: it uses the SECRET key (bypasses RLS).
-- Every policy scopes rows to the authenticated user's single site.

alter table public.sites         enable row level security;
alter table public.profiles      enable row level security;
alter table public.pipes         enable row level security;
alter table public.sensor_nodes  enable row level security;
alter table public.sensors       enable row level security;
alter table public.baselines     enable row level security;
alter table public.readings      enable row level security;
alter table public.readings_1min enable row level security;
alter table public.alerts        enable row level security;
alter table public.risk_scores   enable row level security;

-- Helper: the calling user's site.
create or replace function public.my_site_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$ select site_id from public.profiles where id = auth.uid(); $$;

-- profiles: own row only
create policy "own profile" on public.profiles
  for all using (id = auth.uid());

-- sites: the user's assigned site
create policy "own site" on public.sites
  for all using (id = public.my_site_id());

-- pipes: rows in the user's site
create policy "own pipes" on public.pipes
  for all using (site_id = public.my_site_id());

-- sensor_nodes: nodes on pipes in the user's site
create policy "own nodes" on public.sensor_nodes
  for all using (
    pipe_id in (select id from public.pipes where site_id = public.my_site_id())
  );

-- sensors: sensors on nodes in the user's site
create policy "own sensors" on public.sensors
  for all using (
    node_id in (
      select id from public.sensor_nodes
      where pipe_id in (select id from public.pipes where site_id = public.my_site_id())
    )
  );

-- data tables: join up to site through the FK chain
create policy "own baselines" on public.baselines
  for select using (
    sensor_id in (
      select s.id from public.sensors s
      join public.sensor_nodes n on n.id = s.node_id
      join public.pipes p on p.id = n.pipe_id
      where p.site_id = public.my_site_id()
    )
  );

create policy "own readings" on public.readings
  for select using (
    sensor_id in (
      select s.id from public.sensors s
      join public.sensor_nodes n on n.id = s.node_id
      join public.pipes p on p.id = n.pipe_id
      where p.site_id = public.my_site_id()
    )
  );

create policy "own readings_1min" on public.readings_1min
  for select using (
    sensor_id in (
      select s.id from public.sensors s
      join public.sensor_nodes n on n.id = s.node_id
      join public.pipes p on p.id = n.pipe_id
      where p.site_id = public.my_site_id()
    )
  );

create policy "own alerts" on public.alerts
  for all using (
    sensor_id in (
      select s.id from public.sensors s
      join public.sensor_nodes n on n.id = s.node_id
      join public.pipes p on p.id = n.pipe_id
      where p.site_id = public.my_site_id()
    )
  );

create policy "own risk_scores" on public.risk_scores
  for select using (
    node_id in (
      select n.id from public.sensor_nodes n
      join public.pipes p on p.id = n.pipe_id
      where p.site_id = public.my_site_id()
    )
  );
