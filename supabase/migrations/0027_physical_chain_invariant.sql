-- A monitoring unit is one contiguous physical chain.
-- Position 1 is always the gateway; gateway role is never independently assigned.

update public.sensor_nodes
set is_gateway = (position_in_pipe = 1)
where is_gateway is distinct from (position_in_pipe = 1);

update public.manufactured_nodes
set is_gateway = (position_in_pipe = 1)
where assigned_pipe_id is not null
  and is_gateway is distinct from (position_in_pipe = 1);

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
  derived_gateway boolean;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_position < 1 or p_position > 64 then
    raise exception 'position must be between 1 and 64';
  end if;

  -- Keep the legacy parameter name for RPC compatibility, but derive its value.
  p_is_gateway := (p_position = 1);
  derived_gateway := p_is_gateway;

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

  if target_site is null then raise exception 'open monitoring unit not found'; end if;
  if registry.assigned_pipe_id is not null and registry.assigned_pipe_id <> p_pipe_id then
    raise exception 'node is assigned to a different monitoring unit';
  end if;
  if exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and position_in_pipe = p_position
  ) then
    raise exception 'monitoring-unit position is already occupied';
  end if;
  if derived_gateway and exists (
    select 1 from public.sensor_nodes
    where pipe_id = p_pipe_id and is_gateway
  ) then
    raise exception 'monitoring unit already has a gateway';
  end if;

  insert into public.sensor_nodes (pipe_id, position_in_pipe, mac_addr, is_gateway)
  values (p_pipe_id, p_position, registry.mac_addr, derived_gateway)
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
      is_gateway = derived_gateway,
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

create or replace function public.admin_update_deployment_manifest(
  p_pipe_id uuid,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pipe public.pipes%rowtype;
  target_site uuid;
  item record;
  registry public.manufactured_nodes%rowtype;
  desired_count integer;
  positioned_count integer;
  unique_registry_count integer;
  unique_position_count integer;
  minimum_position integer;
  maximum_position integer;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into current_pipe
  from public.pipes
  where id = p_pipe_id
  for update;

  if not found then raise exception 'monitoring unit not found'; end if;
  if current_pipe.deployment_status <> 'planning' then
    raise exception 'manifest can only be edited during planning';
  end if;
  if jsonb_typeof(p_manifest) <> 'array' or jsonb_array_length(p_manifest) < 1 then
    raise exception 'manifest must contain at least one node';
  end if;
  if jsonb_array_length(p_manifest) > 64 then
    raise exception 'manifest cannot contain more than 64 nodes';
  end if;

  if exists (
    select 1
    from public.readings r
    join public.sensors s on s.id = r.sensor_id
    join public.sensor_nodes n on n.id = s.node_id
    where n.pipe_id = p_pipe_id
  ) or exists (
    select 1
    from public.baselines b
    join public.sensors s on s.id = b.sensor_id
    join public.sensor_nodes n on n.id = s.node_id
    where n.pipe_id = p_pipe_id
  ) then
    raise exception 'manifest cannot be edited after sensor history exists';
  end if;

  select
    count(*),
    count(position),
    count(distinct registry_id),
    count(distinct position),
    min(position),
    max(position)
  into
    desired_count,
    positioned_count,
    unique_registry_count,
    unique_position_count,
    minimum_position,
    maximum_position
  from jsonb_to_recordset(p_manifest)
    as desired(registry_id uuid, position smallint, is_gateway boolean);

  if desired_count <> unique_registry_count then
    raise exception 'manifest cannot contain the same node twice';
  end if;
  if positioned_count <> desired_count
    or unique_position_count <> desired_count
    or minimum_position <> 1
    or maximum_position <> desired_count then
    raise exception 'manifest positions must be contiguous from 1 through the assigned node count';
  end if;
  if desired_count > current_pipe.expected_node_count then
    raise exception 'assigned node count cannot exceed planned node count';
  end if;

  select site_id into target_site from public.pipes where id = p_pipe_id;

  for item in
    select * from jsonb_to_recordset(p_manifest)
      as desired(registry_id uuid, position smallint, is_gateway boolean)
  loop
    if item.position < 1 or item.position > 64 then raise exception 'node positions must be between 1 and 64'; end if;
    select * into registry from public.manufactured_nodes where id = item.registry_id for update;
    if not found then raise exception 'one manifest node is unavailable'; end if;
    if registry.status = 'retired' then raise exception 'retired hardware cannot be assigned'; end if;
    if registry.assigned_pipe_id is not null and registry.assigned_pipe_id <> p_pipe_id then
      raise exception 'a manifest node is assigned to another monitoring unit';
    end if;
  end loop;

  -- Move current rows out of the way before applying the new positions.
  update public.sensor_nodes
  set position_in_pipe = position_in_pipe + 1000,
      is_gateway = false
  where pipe_id = p_pipe_id;

  update public.manufactured_nodes
  set position_in_pipe = null,
      is_gateway = false
  where assigned_pipe_id = p_pipe_id;

  -- Remove nodes omitted from the revised manifest.
  for item in
    select m.*
    from public.manufactured_nodes m
    where m.assigned_pipe_id = p_pipe_id
      and not exists (
        select 1 from jsonb_to_recordset(p_manifest)
          as desired(registry_id uuid, position smallint, is_gateway boolean)
        where desired.registry_id = m.id
      )
  loop
    delete from public.sensor_nodes where id = item.deployed_node_id;
    update public.manufactured_nodes
    set assigned_site_id = null,
        assigned_pipe_id = null,
        position_in_pipe = null,
        is_gateway = false,
        deployed_node_id = null,
        status = 'manufactured'
    where id = item.id;
  end loop;

  -- Reapply retained nodes and deploy newly selected inventory records.
  for item in
    select * from jsonb_to_recordset(p_manifest)
      as desired(registry_id uuid, position smallint, is_gateway boolean)
    order by position
  loop
    select * into registry from public.manufactured_nodes where id = item.registry_id for update;
    if registry.deployed_node_id is not null then
      update public.sensor_nodes
      set position_in_pipe = item.position,
          is_gateway = (item.position = 1)
      where id = registry.deployed_node_id;

      update public.manufactured_nodes
      set assigned_site_id = target_site,
          assigned_pipe_id = p_pipe_id,
          position_in_pipe = item.position,
          is_gateway = (item.position = 1),
          status = 'deployed'
      where id = registry.id;
    else
      perform public.admin_deploy_manufactured_node(
        item.registry_id, p_pipe_id, item.position, (item.position = 1)
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_update_deployment_manifest(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_deployment_manifest(uuid, jsonb) to authenticated;
