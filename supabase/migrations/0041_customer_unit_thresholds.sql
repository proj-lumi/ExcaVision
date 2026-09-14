-- Customers may tune the alert threshold for units at their own site.
-- Direct table writes remain restricted to Admin; customers use this ownership-
-- checked RPC instead.

alter table public.pipes
  drop constraint if exists pipes_alert_threshold_deg_check;
alter table public.pipes
  add constraint pipes_alert_threshold_deg_check
  check (alert_threshold_deg >= 0.1 and alert_threshold_deg <= 45.0);

create or replace function public.update_my_monitoring_unit_threshold(
  p_pipe_id uuid,
  p_threshold_deg real
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_threshold_deg < 0.1 or p_threshold_deg > 45.0 then
    raise exception 'threshold must be between 0.1 and 45 degrees';
  end if;

  update public.pipes
  set alert_threshold_deg = round(p_threshold_deg::numeric, 1)::real
  where id = p_pipe_id
    and site_id = public.my_site_id()
    and cancelled_at is null;

  if not found then
    raise exception 'monitoring unit is not part of your site';
  end if;
end;
$$;

revoke all on function public.update_my_monitoring_unit_threshold(uuid, real) from public, anon;
grant execute on function public.update_my_monitoring_unit_threshold(uuid, real) to authenticated;
