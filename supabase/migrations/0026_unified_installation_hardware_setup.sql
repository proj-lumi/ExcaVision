-- Save the planning target and installation manifest as one atomic staff action.
-- The target cannot be lower than the manifest being saved.

create or replace function public.admin_save_installation_hardware_setup(
  p_pipe_id uuid,
  p_expected_node_count smallint,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pipe public.pipes%rowtype;
  manifest_count integer;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_expected_node_count < 1 or p_expected_node_count > 64 then
    raise exception 'planned node count must be between 1 and 64';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then
    raise exception 'manifest must be an array';
  end if;

  select * into current_pipe
  from public.pipes
  where id = p_pipe_id
  for update;

  if not found or current_pipe.deployment_status <> 'planning' then
    raise exception 'planning deployment not found';
  end if;

  manifest_count := jsonb_array_length(p_manifest);
  if manifest_count > p_expected_node_count then
    raise exception 'planned node count cannot be lower than assigned node count';
  end if;

  if manifest_count = 0 and exists (
    select 1 from public.manufactured_nodes where assigned_pipe_id = p_pipe_id
  ) then
    raise exception 'remove individual nodes or keep at least one assigned node';
  end if;

  update public.pipes
  set expected_node_count = p_expected_node_count,
      plan_confirmed = true
  where id = p_pipe_id;

  update public.service_request_targets
  set requested_node_count = p_expected_node_count
  where created_pipe_id = p_pipe_id
    and operation = 'install_unit';

  if manifest_count > 0 then
    perform public.admin_update_deployment_manifest(p_pipe_id, p_manifest);
  end if;
end;
$$;

revoke all on function public.admin_save_installation_hardware_setup(uuid, smallint, jsonb)
  from public, anon;
grant execute on function public.admin_save_installation_hardware_setup(uuid, smallint, jsonb)
  to authenticated;
