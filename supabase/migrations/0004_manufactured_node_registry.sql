-- 0004_manufactured_node_registry.sql
-- Producer-owned inventory: customers install known hardware without entering
-- or scanning each ESP32 MAC address.

create table if not exists public.manufactured_nodes (
  id               uuid primary key default gen_random_uuid(),
  serial_number    text not null unique,
  mac_addr         text not null unique
                   check (mac_addr ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  batch_code       text,
  manufactured_at timestamptz not null default now(),
  assigned_site_id uuid references public.sites(id) on delete set null,
  deployed_node_id uuid unique references public.sensor_nodes(id) on delete set null,
  status           text not null default 'manufactured'
                   check (status in ('manufactured', 'assigned', 'deployed', 'retired')),
  notes            text
);

create index if not exists manufactured_nodes_site_status_idx
  on public.manufactured_nodes (assigned_site_id, status);

alter table public.manufactured_nodes enable row level security;

-- Producers use the Supabase service role to create inventory and assign a
-- unit to the customer's site. Customers can only list units assigned there.
create policy "site reads assigned manufactured nodes"
on public.manufactured_nodes
for select to authenticated
using (assigned_site_id = public.my_site_id());

-- Install one pre-registered unit into a pipe. The app passes the registry UUID
-- selected from its assigned-unit list; it never asks the user for a MAC.
create or replace function public.install_manufactured_node(
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
  caller_site uuid;
  caller_role text;
  target_site uuid;
  registry    public.manufactured_nodes%rowtype;
  new_node_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_position < 1 then
    raise exception 'position must be at least 1';
  end if;

  select site_id, role into caller_site, caller_role
  from public.profiles
  where id = auth.uid();

  if caller_role is distinct from 'engineer' then
    raise exception 'engineer role required';
  end if;

  select site_id into target_site
  from public.pipes
  where id = p_pipe_id;

  if caller_site is null or target_site is distinct from caller_site then
    raise exception 'pipe is not in the caller site';
  end if;

  select * into registry
  from public.manufactured_nodes
  where id = p_registry_id
  for update;

  if not found then
    raise exception 'registered unit not found';
  end if;
  if registry.assigned_site_id is distinct from caller_site then
    raise exception 'unit is not assigned to the caller site';
  end if;
  if registry.status = 'retired' then
    raise exception 'unit is retired';
  end if;
  if registry.deployed_node_id is not null then
    raise exception 'unit is already deployed';
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
  set deployed_node_id = new_node_id,
      status = 'deployed'
  where id = p_registry_id;

  return new_node_id;
end;
$$;

revoke all on table public.manufactured_nodes from anon;
grant select on table public.manufactured_nodes to authenticated;
revoke all on function public.install_manufactured_node(uuid, uuid, smallint, boolean) from public, anon;
grant execute on function public.install_manufactured_node(uuid, uuid, smallint, boolean) to authenticated;
