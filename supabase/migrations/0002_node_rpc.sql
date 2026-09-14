-- 0002_node_rpc.sql — the endpoints the node calls (Phase B).
-- The node authenticates with the SECRET key (bypasses RLS). These functions
-- resolve (mac, channel) -> sensor_id server-side, per BACKEND_SPEC.md §3.2.

-- Insert a batch of readings, each tagged {mac, channel, tilt, g_mag, temp_c,
-- n, fail, alert_flag}. Rows whose mac/channel aren't registered yet are
-- skipped (install wizard registers nodes first). NOTE: the param stays named
-- "batch" — PostgREST maps the JSON body key to the param name.
create or replace function public.insert_readings(batch jsonb)
returns void
language plpgsql
security invoker set search_path = public
as $$
declare
  item jsonb;
  nid  uuid;
  sid  uuid;
begin
  for item in select * from jsonb_array_elements(batch) loop
    select n.id into nid from public.sensor_nodes n
      where n.mac_addr = (item ->> 'mac');
    if nid is null then continue; end if;

    select s.id into sid from public.sensors s
      where s.node_id = nid and s.channel = (item ->> 'channel')::smallint;
    if sid is null then continue; end if;

    insert into public.readings
      (sensor_id, tilt, g_mag, temp_c, n, fail, alert_flag)
    values
      (sid,
       coalesce((item ->> 'tilt')::real,      0),
       coalesce((item ->> 'g_mag')::real,     0),
       coalesce((item ->> 'temp_c')::real,    0),
       coalesce((item ->> 'n')::integer,      0),
       coalesce((item ->> 'fail')::integer,   0),
       coalesce((item ->> 'alert_flag')::boolean, false));
  end loop;
end;
$$;

-- Upsert a sensor's baseline. The new row's supersedes_id points at the
-- previous latest, so history is preserved and "current" = latest captured_at.
-- Params are p_-prefixed so they never clash with table column names.
create or replace function public.upsert_baseline(
  p_mac text, p_channel smallint, p_bx real, p_by real, p_bz real
)
returns void
language plpgsql
security invoker set search_path = public
as $$
declare
  nid    uuid;
  sid    uuid;
  latest uuid;
begin
  select n.id into nid from public.sensor_nodes n where n.mac_addr = p_mac;
  if nid is null then return; end if;
  select s.id into sid from public.sensors s
    where s.node_id = nid and s.channel = p_channel;
  if sid is null then return; end if;

  select b.id into latest from public.baselines b
    where b.sensor_id = sid
    order by b.captured_at desc
    limit 1;

  insert into public.baselines (sensor_id, bx, by, bz, supersedes_id)
  values (sid, p_bx, p_by, p_bz, latest);
end;
$$;

-- The node's current baselines, one row per sensor, keyed by its MAC.
create or replace function public.get_current_baselines(mac text)
returns table(channel smallint, bx real, by real, bz real)
language sql
security invoker set search_path = public
as $$
  select s.channel, b.bx, b.by, b.bz
  from public.baselines b
  join public.sensors s        on s.id = b.sensor_id
  join public.sensor_nodes n   on n.id = s.node_id
  where n.mac_addr = mac
    and b.id in (
      select b2.id from public.baselines b2
      where b2.sensor_id = b.sensor_id
      order by b2.captured_at desc
      limit 1
    );
$$;

-- Push a priority alert (threshold trip on the node).
-- Params are p_-prefixed so they never clash with table column names.
create or replace function public.insert_alert(
  p_mac text, p_channel smallint, p_kind text, p_severity text, p_value real
)
returns void
language plpgsql
security invoker set search_path = public
as $$
declare
  nid uuid;
  sid uuid;
begin
  select n.id into nid from public.sensor_nodes n where n.mac_addr = p_mac;
  if nid is null then return; end if;
  select s.id into sid from public.sensors s
    where s.node_id = nid and s.channel = p_channel;
  if sid is null then return; end if;

  insert into public.alerts (sensor_id, kind, severity, value)
  values (sid, p_kind, p_severity, p_value);
end;
$$;

-- The node's config: its pipe's engineer-set alert threshold, keyed by MAC.
create or replace view public.node_config
with (security_invoker = true) as
  select n.mac_addr as mac, p.alert_threshold_deg as threshold_deg
  from public.sensor_nodes n
  join public.pipes p on p.id = n.pipe_id;

-- Node-only endpoints: the firmware uses the Supabase secret/service role.
-- App users and anonymous callers must never invoke these directly.
revoke all on function public.insert_readings(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_baseline(text, smallint, real, real, real) from public, anon, authenticated;
revoke all on function public.get_current_baselines(text) from public, anon, authenticated;
revoke all on function public.insert_alert(text, smallint, text, text, real) from public, anon, authenticated;
grant execute on function public.insert_readings(jsonb) to service_role;
grant execute on function public.upsert_baseline(text, smallint, real, real, real) to service_role;
grant execute on function public.get_current_baselines(text) to service_role;
grant execute on function public.insert_alert(text, smallint, text, text, real) to service_role;
