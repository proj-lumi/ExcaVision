-- seed.sql — FULL WIPE + repopulate a test hierarchy.
-- Creates: site → pipe → 2 producer-assigned nodes → 4 sensors each.
--
-- HOW TO RUN:
--   Option A (Supabase web): Dashboard → SQL Editor → paste this → Run.
--   Option B (local):        supabase db reset
--
-- Rerun anytime to get a fresh, clean slate.

-- 0) FULL WIPE — tear down every row (CASCADE follows the FK chain).
truncate table public.risk_scores,
              public.readings,
              public.readings_1min,
              public.baselines,
              public.alerts,
              public.sensors,
              public.manufactured_nodes,
              public.sensor_nodes,
              public.pipes,
              public.sites,
              public.profiles
cascade;

-- 1) A site.
insert into public.sites (name, lat, lon)
values ('Test Site', 1.3, 103.8);

-- 2) A pipe under the site. This is only the deployment grouping; the
--    producer registry still owns individual manufactured nodes.
insert into public.pipes (site_id, name, installed_at, alert_threshold_deg)
select id, 'North Wall', now() - interval '1 day', 2.0
from public.sites
where name = 'Test Site';

-- 3) Producer-registered nodes assigned to this site and test pipe before
--    delivery. The real producer uses the service role for this step.
insert into public.manufactured_nodes
  (serial_number, mac_addr, batch_code, assigned_site_id,
   assigned_pipe_id, position_in_pipe, is_gateway, status)
select v.serial, v.mac, 'TEST-BATCH', s.id, p.id,
       v.position, v.gateway, 'manufactured'
from public.sites s
join public.pipes p on p.site_id = s.id and p.name = 'North Wall'
cross join (values
  ('EXV-TEST-001', '30:76:F5:E5:A2:24', 1, true),
  ('EXV-TEST-002', '30:76:F5:E4:F6:CC', 2, false),
  ('EXV-TEST-003', '30:76:F5:E4:F6:CD', 3, false)
) as v(serial, mac, position, gateway)
where s.name = 'Test Site';

-- 4) Materialize the preassigned nodes as deployed rows, as the producer-only
--    deploy_manufactured_node() function does before customer handoff.
insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
select assigned_pipe_id, position_in_pipe, mac_addr, is_gateway
from public.manufactured_nodes;

update public.manufactured_nodes m
set deployed_node_id = n.id,
    status = 'deployed'
from public.sensor_nodes n
where n.mac_addr = m.mac_addr;

-- 5) Four sensors per node. Channels/labels match Config.h:
--    S1@7  S2@3  S3@5  S4@1.
insert into public.sensors (node_id, channel, label)
select n.id, c.ch, c.lbl
from public.sensor_nodes n
cross join (values (7, 'S1'), (3, 'S2'), (5, 'S3'), (1, 'S4')) as c(ch, lbl);

-- 6) Summary.
select 'seeded' as status,
       (select count(*) from public.manufactured_nodes) as registered_nodes,
       (select count(*) from public.sensor_nodes) as deployed_nodes,
       (select count(*) from public.sensors) as sensors,
       (select count(*) from public.sites) as sites;
