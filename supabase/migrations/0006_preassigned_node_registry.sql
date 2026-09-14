-- 0006_preassigned_node_ownership.sql
-- Final ownership model: ExcaVision sells/registers individual nodes.
-- A pipe is only the deployment grouping (for example, three test nodes).
-- Customers only provision gateway WiFi; they never claim or install nodes.

-- Remove the earlier kit-based design before creating the final node registry.
drop function if exists public.activate_manufactured_kit(uuid);
drop function if exists public.install_manufactured_node(uuid, uuid, smallint, boolean);
drop table if exists public.manufactured_kits cascade;
drop table if exists public.manufactured_nodes cascade;

create table public.manufactured_nodes (
  id               uuid primary key default gen_random_uuid(),
  serial_number    text not null unique,
  mac_addr         text not null unique
                   check (mac_addr ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  batch_code       text,
  assigned_site_id uuid references public.sites(id) on delete set null,
  assigned_pipe_id uuid references public.pipes(id) on delete set null,
  position_in_pipe smallint check (position_in_pipe >= 1),
  is_gateway       boolean not null default false,
  manufactured_at timestamptz not null default now(),
  deployed_node_id uuid unique references public.sensor_nodes(id) on delete set null,
  status           text not null default 'manufactured'
                   check (status in ('manufactured', 'deployed', 'retired')),
  notes            text,
  unique (assigned_pipe_id, position_in_pipe)
);

create unique index manufactured_nodes_one_gateway_per_pipe_idx
  on public.manufactured_nodes (assigned_pipe_id)
  where is_gateway and assigned_pipe_id is not null;

-- The admin's deployment manifest is also enforced in the deployed tables.
create unique index if not exists sensor_nodes_pipe_position_idx
  on public.sensor_nodes (pipe_id, position_in_pipe);

create unique index if not exists sensor_nodes_one_gateway_per_pipe_idx
  on public.sensor_nodes (pipe_id)
  where is_gateway;

create index manufactured_nodes_site_status_idx
  on public.manufactured_nodes (assigned_site_id, status);

alter table public.manufactured_nodes enable row level security;

-- Customers can monitor their pipes, but only Engineer profiles can change
-- the pipe-level threshold. Producer/service operations bypass RLS.
drop policy if exists "own pipes" on public.pipes;
create policy "site reads own pipes"
on public.pipes for select
using (site_id = public.my_site_id());

create policy "engineers manage own pipe thresholds"
on public.pipes for update
using (
  site_id = public.my_site_id()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'engineer'
  )
)
with check (site_id = public.my_site_id());

create policy "site reads assigned manufactured nodes"
on public.manufactured_nodes
for select to authenticated
using (assigned_site_id = public.my_site_id());

-- Producer/support-only deployment. The customer app does not call this function.
-- It materializes one already-assigned manufactured node as sensor_nodes plus
-- its four MPU channel records before the customer receives the node.
create or replace function public.deploy_manufactured_node(
  p_registry_id uuid,
  p_pipe_id uuid,
  p_position smallint,
  p_is_gateway boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  registry public.manufactured_nodes%rowtype;
  target_site uuid;
  new_node_id uuid;
begin
  if p_position < 1 then
    raise exception 'position must be at least 1';
  end if;

  select * into registry
  from public.manufactured_nodes
  where id = p_registry_id
  for update;

  if not found then
    raise exception 'manufactured node not found';
  end if;
  if registry.status = 'retired' then
    raise exception 'manufactured node is retired';
  end if;
  if registry.deployed_node_id is not null then
    raise exception 'manufactured node is already deployed';
  end if;

  select site_id into target_site
  from public.pipes
  where id = p_pipe_id;

  if target_site is null then
    raise exception 'pipe not found';
  end if;
  if registry.assigned_site_id is distinct from target_site then
    raise exception 'node is not assigned to the pipe site';
  end if;
  if registry.assigned_pipe_id is not null
     and registry.assigned_pipe_id is distinct from p_pipe_id then
    raise exception 'node is assigned to a different pipe';
  end if;
  if exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and position_in_pipe = p_position
  ) then
    raise exception 'pipe position is already occupied';
  end if;
  if p_is_gateway and exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and is_gateway
  ) then
    raise exception 'pipe already has a gateway';
  end if;

  insert into public.sensor_nodes
    (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values
    (p_pipe_id, p_position, registry.mac_addr, p_is_gateway)
  returning id into new_node_id;

  insert into public.sensors (node_id, channel, label)
  values
    (new_node_id, 7, 'S1'),
    (new_node_id, 3, 'S2'),
    (new_node_id, 5, 'S3'),
    (new_node_id, 1, 'S4');

  update public.manufactured_nodes
  set assigned_pipe_id = p_pipe_id,
      position_in_pipe = p_position,
      is_gateway = p_is_gateway,
      deployed_node_id = new_node_id,
      status = 'deployed'
  where id = p_registry_id;

  return new_node_id;
end;
$$;

revoke all on table public.manufactured_nodes from anon;
grant select on table public.manufactured_nodes to authenticated;
revoke all on function public.deploy_manufactured_node(uuid, uuid, smallint, boolean)
  from public, anon, authenticated;
grant execute on function public.deploy_manufactured_node(uuid, uuid, smallint, boolean)
  to service_role;
