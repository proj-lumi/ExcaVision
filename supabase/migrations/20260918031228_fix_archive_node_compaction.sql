-- Compact assigned node positions without transient unique-index collisions.
create or replace function private.archive_node_impl(target_node_id uuid) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  target public.nodes%rowtype;
  shifted record;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into target
  from public.nodes
  where id = target_node_id;

  if not found then
    raise exception 'node_not_found' using errcode = 'P0001';
  end if;
  if target.status = 'archived' then return; end if;

  if target.unit_id is not null and target.position is not null then
    perform 1
    from public.nodes
    where unit_id = target.unit_id and status = 'assigned'
    order by id
    for update;
  end if;

  -- Remove the target from the active-position index first.
  update public.nodes
  set status = 'archived', archived_at = now()
  where id = target_node_id;

  if target.unit_id is not null and target.position is not null then
    -- Ascending order moves each row into the position just freed by the
    -- previous row, so no duplicate active position exists mid-transaction.
    for shifted in
      select id, position
      from public.nodes
      where unit_id = target.unit_id
        and status = 'assigned'
        and position > target.position
      order by position asc, id asc
    loop
      update public.nodes
      set position = shifted.position - 1
      where id = shifted.id;
    end loop;
    perform public.sync_unit_status(target.unit_id);
  end if;
end;
$$;

notify pgrst, 'reload schema';
