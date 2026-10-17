-- Index Advisor uses HypoPG to test hypothetical indexes without creating them.
-- Keep both vendor extensions in the dedicated non-API extensions schema.
create schema if not exists extensions;
revoke create on schema extensions from public, anon, authenticated;

create extension if not exists hypopg with schema extensions;
create extension if not exists index_advisor with schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
