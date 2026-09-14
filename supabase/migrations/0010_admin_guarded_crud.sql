-- Guarded edit and delete operations for the final admin dashboard.
-- Historical sensor data must never disappear through ordinary admin cleanup.

grant delete on public.service_requests to authenticated;

create or replace function public.admin_delete_service_request(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  delete from public.service_requests where id = p_request_id;
  if not found then raise exception 'service request not found'; end if;
end;
$$;

create or replace function public.admin_delete_empty_site(p_site_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if exists (select 1 from public.pipes where site_id = p_site_id) then
    raise exception 'delete the site monitoring units first';
  end if;

  delete from public.sites where id = p_site_id;
  if not found then raise exception 'site not found'; end if;
end;
$$;

create or replace function public.admin_delete_empty_monitoring_unit(p_pipe_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if exists (
    select 1 from public.manufactured_nodes
    where assigned_pipe_id = p_pipe_id or deployed_node_id is not null
      and assigned_pipe_id = p_pipe_id
  ) or exists (
    select 1 from public.sensor_nodes where pipe_id = p_pipe_id
  ) then
    raise exception 'a monitoring unit with assigned nodes cannot be deleted';
  end if;

  delete from public.pipes where id = p_pipe_id;
  if not found then raise exception 'monitoring unit not found'; end if;
end;
$$;

create or replace function public.admin_delete_available_node(p_registry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  delete from public.manufactured_nodes
  where id = p_registry_id
    and status = 'manufactured'
    and assigned_site_id is null
    and assigned_pipe_id is null
    and deployed_node_id is null;

  if not found then
    raise exception 'only an unassigned, undeployed node can be deleted';
  end if;
end;
$$;

revoke all on function public.admin_delete_service_request(uuid) from public, anon;
revoke all on function public.admin_delete_empty_site(uuid) from public, anon;
revoke all on function public.admin_delete_empty_monitoring_unit(uuid) from public, anon;
revoke all on function public.admin_delete_available_node(uuid) from public, anon;

grant execute on function public.admin_delete_service_request(uuid) to authenticated;
grant execute on function public.admin_delete_empty_site(uuid) to authenticated;
grant execute on function public.admin_delete_empty_monitoring_unit(uuid) to authenticated;
grant execute on function public.admin_delete_available_node(uuid) to authenticated;
