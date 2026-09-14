-- Resolve Security Advisor warnings introduced or exposed by the final admin API.
-- Admin RPCs run with caller permissions and rely on explicit RLS policies.

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Replace the SECURITY DEFINER wrapper with a caller-scoped transactional RPC.
-- RLS permits these writes only when is_admin() is true.
create or replace function public.admin_deploy_manufactured_node(
  p_registry_id uuid,
  p_pipe_id uuid,
  p_position smallint,
  p_is_gateway boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  registry public.manufactured_nodes%rowtype;
  target_site uuid;
  new_node_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if p_position < 1 then
    raise exception 'position must be at least 1';
  end if;

  select * into registry
  from public.manufactured_nodes
  where id = p_registry_id
  for update;

  if not found or registry.status <> 'manufactured' or registry.deployed_node_id is not null then
    raise exception 'available manufactured node not found';
  end if;

  select site_id into target_site
  from public.pipes
  where id = p_pipe_id and deployment_status <> 'ready';

  if target_site is null then
    raise exception 'open monitoring unit not found';
  end if;
  if registry.assigned_pipe_id is not null and registry.assigned_pipe_id <> p_pipe_id then
    raise exception 'node is assigned to a different monitoring unit';
  end if;
  if exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and position_in_pipe = p_position
  ) then
    raise exception 'monitoring-unit position is already occupied';
  end if;
  if p_is_gateway and exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and is_gateway
  ) then
    raise exception 'monitoring unit already has a gateway';
  end if;

  insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values (p_pipe_id, p_position, registry.mac_addr, p_is_gateway)
  returning id into new_node_id;

  insert into public.sensors (node_id, channel, label)
  values
    (new_node_id, 7, 'S1'),
    (new_node_id, 3, 'S2'),
    (new_node_id, 5, 'S3'),
    (new_node_id, 1, 'S4');

  update public.manufactured_nodes
  set assigned_site_id = target_site,
      assigned_pipe_id = p_pipe_id,
      position_in_pipe = p_position,
      is_gateway = p_is_gateway,
      deployed_node_id = new_node_id,
      status = 'deployed'
  where id = p_registry_id;

  return new_node_id;
end;
$$;

revoke all on function public.admin_deploy_manufactured_node(uuid, uuid, smallint, boolean)
  from public, anon;
grant execute on function public.admin_deploy_manufactured_node(uuid, uuid, smallint, boolean)
  to authenticated;

-- Profiles: initialize auth.uid() once per statement.
drop policy if exists "own profile" on public.profiles;
create policy "users read and update own profile"
on public.profiles for all to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Sites: customers read their assigned site; admins manage all sites.
drop policy if exists "own site" on public.sites;
drop policy if exists "admins manage sites" on public.sites;
create policy "users read permitted sites"
on public.sites for select to authenticated
using (id = (select public.my_site_id()) or (select public.is_admin()));
create policy "admins insert sites"
on public.sites for insert to authenticated
with check ((select public.is_admin()));
create policy "admins update sites"
on public.sites for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
create policy "admins delete sites"
on public.sites for delete to authenticated
using ((select public.is_admin()));

-- Monitoring units: customers read their site; engineers update their site;
-- admins manage every monitoring unit.
drop policy if exists "own pipes" on public.pipes;
drop policy if exists "site reads own pipes" on public.pipes;
drop policy if exists "engineers manage own pipe thresholds" on public.pipes;
drop policy if exists "admins manage pipes" on public.pipes;
create policy "users read permitted pipes"
on public.pipes for select to authenticated
using (site_id = (select public.my_site_id()) or (select public.is_admin()));
create policy "admins insert pipes"
on public.pipes for insert to authenticated
with check ((select public.is_admin()));
create policy "admins or engineers update pipes"
on public.pipes for update to authenticated
using (
  (select public.is_admin())
  or (
    site_id = (select public.my_site_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'engineer'
    )
  )
)
with check (
  (select public.is_admin())
  or (
    site_id = (select public.my_site_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'engineer'
    )
  )
);
create policy "admins delete pipes"
on public.pipes for delete to authenticated
using ((select public.is_admin()));

-- Deployed nodes and sensors are customer-readable but admin-managed.
drop policy if exists "own nodes" on public.sensor_nodes;
drop policy if exists "admins manage sensor nodes" on public.sensor_nodes;
create policy "users read permitted sensor nodes"
on public.sensor_nodes for select to authenticated
using (
  pipe_id in (
    select id from public.pipes
    where site_id = (select public.my_site_id())
  )
  or (select public.is_admin())
);
create policy "admins insert sensor nodes"
on public.sensor_nodes for insert to authenticated
with check ((select public.is_admin()));
create policy "admins update sensor nodes"
on public.sensor_nodes for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
create policy "admins delete sensor nodes"
on public.sensor_nodes for delete to authenticated
using ((select public.is_admin()));

drop policy if exists "own sensors" on public.sensors;
drop policy if exists "admins manage sensors" on public.sensors;
create policy "users read permitted sensors"
on public.sensors for select to authenticated
using (
  node_id in (
    select n.id
    from public.sensor_nodes n
    join public.pipes p on p.id = n.pipe_id
    where p.site_id = (select public.my_site_id())
  )
  or (select public.is_admin())
);
create policy "admins insert sensors"
on public.sensors for insert to authenticated
with check ((select public.is_admin()));
create policy "admins update sensors"
on public.sensors for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
create policy "admins delete sensors"
on public.sensors for delete to authenticated
using ((select public.is_admin()));

-- Manufactured inventory has one policy per action, avoiding duplicate checks.
drop policy if exists "site reads assigned manufactured nodes" on public.manufactured_nodes;
drop policy if exists "admins manage manufactured nodes" on public.manufactured_nodes;
create policy "users read permitted manufactured nodes"
on public.manufactured_nodes for select to authenticated
using (
  assigned_site_id = (select public.my_site_id())
  or (select public.is_admin())
);
create policy "admins insert manufactured nodes"
on public.manufactured_nodes for insert to authenticated
with check ((select public.is_admin()));
create policy "admins update manufactured nodes"
on public.manufactured_nodes for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
create policy "admins delete manufactured nodes"
on public.manufactured_nodes for delete to authenticated
using ((select public.is_admin()));

-- Cover foreign keys used by joins and cascades.
create index if not exists alerts_sensor_id_idx
  on public.alerts (sensor_id);
create index if not exists baselines_supersedes_id_idx
  on public.baselines (supersedes_id);
create index if not exists pipes_site_id_idx
  on public.pipes (site_id);
create index if not exists profiles_site_id_idx
  on public.profiles (site_id);
create index if not exists risk_scores_node_id_idx
  on public.risk_scores (node_id);
create index if not exists service_requests_assigned_staff_id_idx
  on public.service_requests (assigned_staff_id);
