-- Replace a broken node without deleting its sensor history.
-- The existing sensor_node row remains the historical identity; only its
-- current hardware MAC is changed to the replacement device.

create table if not exists public.node_replacements (
  id                         uuid primary key default gen_random_uuid(),
  pipe_id                    uuid not null references public.pipes(id) on delete restrict,
  sensor_node_id             uuid not null references public.sensor_nodes(id) on delete restrict,
  old_manufactured_node_id   uuid not null references public.manufactured_nodes(id) on delete restrict,
  new_manufactured_node_id   uuid not null references public.manufactured_nodes(id) on delete restrict,
  position_in_pipe           smallint not null,
  old_mac_addr               text not null,
  new_mac_addr               text not null,
  replaced_at                timestamptz not null default now(),
  replaced_by                uuid references public.profiles(id) on delete set null
);

create index if not exists node_replacements_pipe_idx
  on public.node_replacements (pipe_id, replaced_at desc);

alter table public.node_replacements enable row level security;
create policy "admins manage node replacements"
on public.node_replacements for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
grant select, insert on public.node_replacements to authenticated;

create or replace function public.admin_replace_node(
  p_pipe_id uuid,
  p_sensor_node_id uuid,
  p_replacement_registry_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_unit public.pipes%rowtype;
  existing_node public.sensor_nodes%rowtype;
  old_registry public.manufactured_nodes%rowtype;
  replacement_registry public.manufactured_nodes%rowtype;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into current_unit
  from public.pipes
  where id = p_pipe_id and deployment_status = 'ready'
  for update;
  if not found then raise exception 'active monitoring unit not found'; end if;

  select * into existing_node
  from public.sensor_nodes
  where id = p_sensor_node_id and pipe_id = p_pipe_id
  for update;
  if not found then raise exception 'node is not part of this monitoring unit'; end if;

  select * into old_registry
  from public.manufactured_nodes
  where deployed_node_id = p_sensor_node_id
  for update;
  if not found then raise exception 'manufactured record for the broken node was not found'; end if;

  select * into replacement_registry
  from public.manufactured_nodes
  where id = p_replacement_registry_id
  for update;
  if not found or replacement_registry.status <> 'manufactured'
      or replacement_registry.assigned_site_id is not null
      or replacement_registry.assigned_pipe_id is not null
      or replacement_registry.deployed_node_id is not null then
    raise exception 'available replacement node not found';
  end if;

  update public.manufactured_nodes
  set assigned_site_id = null,
      assigned_pipe_id = null,
      position_in_pipe = null,
      is_gateway = false,
      deployed_node_id = null,
      status = 'retired'
  where id = old_registry.id;

  update public.sensor_nodes
  set mac_addr = replacement_registry.mac_addr
  where id = existing_node.id;

  update public.manufactured_nodes
  set assigned_site_id = current_unit.site_id,
      assigned_pipe_id = p_pipe_id,
      position_in_pipe = existing_node.position_in_pipe,
      is_gateway = existing_node.is_gateway,
      deployed_node_id = existing_node.id,
      status = 'deployed'
  where id = replacement_registry.id;

  insert into public.node_replacements (
    pipe_id,
    sensor_node_id,
    old_manufactured_node_id,
    new_manufactured_node_id,
    position_in_pipe,
    old_mac_addr,
    new_mac_addr,
    replaced_by
  ) values (
    p_pipe_id,
    existing_node.id,
    old_registry.id,
    replacement_registry.id,
    existing_node.position_in_pipe,
    existing_node.mac_addr,
    replacement_registry.mac_addr,
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_replace_node(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_replace_node(uuid, uuid, uuid) to authenticated;
