-- Planning manifests are reversible until field installation begins.
-- Once readings exist, the physical and historical record is locked.

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
  existing_node public.sensor_nodes%rowtype;
  desired_count integer;
  gateway_count integer;
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

  select count(*), count(*) filter (where is_gateway)
  into desired_count, gateway_count
  from jsonb_to_recordset(p_manifest)
    as desired(registry_id uuid, position smallint, is_gateway boolean);

  if desired_count <> (select count(distinct registry_id) from jsonb_to_recordset(p_manifest) as ids(registry_id uuid, position smallint, is_gateway boolean)) then
    raise exception 'manifest cannot contain the same node twice';
  end if;
  if desired_count <> (select count(distinct position) from jsonb_to_recordset(p_manifest) as positions(registry_id uuid, position smallint, is_gateway boolean)) then
    raise exception 'manifest positions must be unique';
  end if;
  if gateway_count <> 1 then raise exception 'manifest must contain exactly one gateway'; end if;

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
          is_gateway = item.is_gateway
      where id = registry.deployed_node_id;

      update public.manufactured_nodes
      set assigned_site_id = target_site,
          assigned_pipe_id = p_pipe_id,
          position_in_pipe = item.position,
          is_gateway = item.is_gateway,
          status = 'deployed'
      where id = registry.id;
    else
      perform public.admin_deploy_manufactured_node(
        item.registry_id, p_pipe_id, item.position, item.is_gateway
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.admin_update_deployment_manifest(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_deployment_manifest(uuid, jsonb) to authenticated;
