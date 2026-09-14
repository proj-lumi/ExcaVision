-- 0005_security_advisor_fixes.sql
-- Apply to databases that already ran migrations 0001-0004.

-- Views should enforce permissions and RLS as the caller, not as the owner.
alter view public.node_config set (security_invoker = true);

-- Prevent search_path changes from redirecting this helper to hostile objects.
alter function public.my_site_id() set search_path = public;

-- Gateway RPCs are called with the secret/service credential. SECURITY INVOKER
-- is sufficient because service_role already has the required database access.
alter function public.insert_readings(jsonb) security invoker;
alter function public.upsert_baseline(text, smallint, real, real, real) security invoker;
alter function public.get_current_baselines(text) security invoker;
alter function public.insert_alert(text, smallint, text, text, real) security invoker;

revoke all on function public.insert_readings(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_baseline(text, smallint, real, real, real) from public, anon, authenticated;
revoke all on function public.get_current_baselines(text) from public, anon, authenticated;
revoke all on function public.insert_alert(text, smallint, text, text, real) from public, anon, authenticated;

grant execute on function public.insert_readings(jsonb) to service_role;
grant execute on function public.upsert_baseline(text, smallint, real, real, real) to service_role;
grant execute on function public.get_current_baselines(text) to service_role;
grant execute on function public.insert_alert(text, smallint, text, text, real) to service_role;
