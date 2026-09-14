-- Final minimal admin backend for the October product.
-- Staff can manage requests, sites, monitoring units, inventory, and deployments.
-- The browser uses an authenticated admin account, never the service-role key.

alter table public.pipes
  add column if not exists expected_node_count smallint not null default 1
    check (expected_node_count >= 1),
  add column if not exists deployment_status text not null default 'planning'
    check (deployment_status in ('planning', 'installation', 'commissioning', 'ready')),
  add column if not exists commissioning_notes text;

create table if not exists public.service_requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  request_type      text not null,
  name              text not null,
  company           text,
  email             text not null,
  phone             text not null,
  location_name     text not null,
  location_label    text,
  location_notes    text,
  latitude          double precision not null check (latitude between 4.2 and 21.5),
  longitude         double precision not null check (longitude between 116.5 and 127.0),
  osm_url           text not null,
  google_maps_url   text,
  status            text not null default 'submitted'
    check (status in (
      'submitted',
      'under_review',
      'clarification_needed',
      'proposal_ready',
      'approved',
      'changes_requested',
      'closed'
    )),
  assigned_staff_id uuid references public.profiles(id) on delete set null
);

create index if not exists service_requests_status_created_idx
  on public.service_requests (status, created_at desc);

alter table public.service_requests enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Staff access is additive to customer RLS. Customer policies remain unchanged.
drop policy if exists "admins manage sites" on public.sites;
create policy "admins manage sites"
on public.sites for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage pipes" on public.pipes;
create policy "admins manage pipes"
on public.pipes for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage sensor nodes" on public.sensor_nodes;
create policy "admins manage sensor nodes"
on public.sensor_nodes for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage sensors" on public.sensors;
create policy "admins manage sensors"
on public.sensors for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage manufactured nodes" on public.manufactured_nodes;
create policy "admins manage manufactured nodes"
on public.manufactured_nodes for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage service requests" on public.service_requests;
create policy "admins manage service requests"
on public.service_requests for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.pipes to authenticated;
grant select, insert, update on public.sensor_nodes to authenticated;
grant select, insert, update on public.sensors to authenticated;
grant select, insert, update on public.manufactured_nodes to authenticated;
grant select, update on public.service_requests to authenticated;
revoke all on public.service_requests from anon;

create or replace function public.validate_deployment_ready()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  deployed_count integer;
  gateway_count integer;
begin
  if old.deployment_status = 'ready' and new.deployment_status <> 'ready' then
    raise exception 'a ready deployment cannot be reopened';
  end if;

  if new.deployment_status = 'ready' then
    select count(*), count(*) filter (where is_gateway)
      into deployed_count, gateway_count
    from public.manufactured_nodes
    where assigned_pipe_id = new.id and status = 'deployed';

    if deployed_count <> new.expected_node_count then
      raise exception 'assigned node count must match expected node count';
    end if;
    if gateway_count <> 1 then
      raise exception 'a ready deployment must have exactly one gateway';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pipes_validate_ready on public.pipes;
create trigger pipes_validate_ready
before update of deployment_status on public.pipes
for each row execute function public.validate_deployment_ready();

-- One transactional admin operation assigns and deploys a registered node.
create or replace function public.admin_deploy_manufactured_node(
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
  target_site uuid;
  new_node_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select site_id into target_site
  from public.pipes
  where id = p_pipe_id and deployment_status <> 'ready';

  if target_site is null then
    raise exception 'open monitoring unit not found';
  end if;

  update public.manufactured_nodes
  set assigned_site_id = target_site,
      assigned_pipe_id = p_pipe_id,
      position_in_pipe = p_position,
      is_gateway = p_is_gateway
  where id = p_registry_id
    and status = 'manufactured'
    and deployed_node_id is null;

  if not found then
    raise exception 'available manufactured node not found';
  end if;

  new_node_id := public.deploy_manufactured_node(
    p_registry_id,
    p_pipe_id,
    p_position,
    p_is_gateway
  );

  return new_node_id;
end;
$$;

revoke all on function public.admin_deploy_manufactured_node(uuid, uuid, smallint, boolean)
  from public, anon;
grant execute on function public.admin_deploy_manufactured_node(uuid, uuid, smallint, boolean)
  to authenticated;
