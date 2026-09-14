-- Realtime subscriptions still honor each table's RLS policies. Add only the
-- event streams used by Admin intake and the authenticated customer PWA.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_request_intakes'
    ) then
      alter publication supabase_realtime add table public.service_request_intakes;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'readings'
    ) then
      alter publication supabase_realtime add table public.readings;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts'
    ) then
      alter publication supabase_realtime add table public.alerts;
    end if;
  end if;
end;
$$;
