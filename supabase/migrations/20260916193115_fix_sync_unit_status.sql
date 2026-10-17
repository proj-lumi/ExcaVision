-- Fix: the CASE branches in sync_unit_status resolved to `text`, which Postgres
-- will not implicitly cast to the `unit_status` enum. Cast them explicitly.
create or replace function public.sync_unit_status(target_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.units
  set status = case
    when exists (select 1 from public.nodes where unit_id = target_unit_id and status = 'assigned') then 'active'::public.unit_status
    else 'setup_pending'::public.unit_status
  end,
  updated_at = now()
  where id = target_unit_id and status <> 'archived';
end;
$$;
