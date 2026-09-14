-- Realtime subscription for the admin request listener. The default
-- supabase_realtime publication already exists; we only need to bind
-- service_requests when it is not yet included.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_requests'
  ) then
    alter publication supabase_realtime add table service_requests;
  end if;
end $$;
