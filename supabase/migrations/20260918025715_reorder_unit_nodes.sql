-- Admin-only node reordering. Position 1 is the Gateway that authenticates
-- telemetry uploads; promoting a node therefore deliberately changes the Gateway.
create function private.reorder_unit_node_impl(
  target_node_id uuid,
  target_position integer
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  target_unit_id uuid;
  target public.nodes%rowtype;
  temporary_position integer;
  assigned_count integer;
  shifted record;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select unit_id into target_unit_id
  from public.nodes
  where id = target_node_id;

  if target_unit_id is null then
    raise exception 'node_not_assigned' using errcode = 'P0001';
  end if;

  -- Lock every affected row in one stable order before moving positions.
  perform 1
  from public.nodes
  where unit_id = target_unit_id and status = 'assigned'
  order by id
  for update;

  select * into target
  from public.nodes
  where id = target_node_id;

  if not found or target.status <> 'assigned' or target.position is null or target.unit_id <> target_unit_id then
    raise exception 'node_not_assigned' using errcode = 'P0001';
  end if;

  select count(*) into assigned_count
  from public.nodes
  where unit_id = target_unit_id and status = 'assigned';

  if target_position < 1 or target_position > assigned_count then
    raise exception 'invalid_node_position' using errcode = '22023';
  end if;
  if target.position = target_position then return; end if;

  -- A temporary free, valid position avoids transient collisions with the
  -- active-unit-position unique index while the remaining rows shift.
  select candidate into temporary_position
  from generate_series(1, 999) as candidate
  where not exists (
    select 1
    from public.nodes as existing
    where existing.unit_id = target_unit_id
      and existing.status = 'assigned'
      and existing.position = candidate
  )
  limit 1;

  if temporary_position is null then
    raise exception 'no_available_node_position' using errcode = 'P0001';
  end if;

  update public.nodes
  set position = temporary_position
  where id = target.id;

  if target_position < target.position then
    -- Descending updates ensure each destination has just been vacated.
    for shifted in
      select id
      from public.nodes
      where unit_id = target_unit_id
        and status = 'assigned'
        and position >= target_position
        and position < target.position
      order by position desc, id desc
    loop
      update public.nodes set position = position + 1 where id = shifted.id;
    end loop;
  else
    -- Ascending updates ensure each destination has just been vacated.
    for shifted in
      select id
      from public.nodes
      where unit_id = target_unit_id
        and status = 'assigned'
        and position > target.position
        and position <= target_position
      order by position asc, id asc
    loop
      update public.nodes set position = position - 1 where id = shifted.id;
    end loop;
  end if;

  update public.nodes
  set position = target_position
  where id = target.id;
end;
$$;

revoke all on function private.reorder_unit_node_impl(uuid, integer) from public, anon, authenticated, service_role;

create function public.reorder_unit_node(
  target_node_id uuid,
  target_position integer
) returns void
language sql
security invoker
set search_path = ''
as $$
  select private.reorder_unit_node_impl(target_node_id, target_position)
$$;

revoke all on function public.reorder_unit_node(uuid, integer) from public, anon;
grant execute on function public.reorder_unit_node(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
