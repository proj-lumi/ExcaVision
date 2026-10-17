-- Final-project commissioning uses physical setup plus Admin registration only.
-- A Gateway waits on Wi-Fi until its MAC is registered as Node 1; no device
-- stores, displays, rotates, or submits a provisioning key.

create or replace function private.register_node_impl(target_mac text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  normalized_mac text := upper(trim(target_mac));
  new_node public.nodes%rowtype;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if normalized_mac !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' then
    raise exception 'invalid_mac_address' using errcode = '22023';
  end if;

  insert into public.nodes (mac_address)
  values (normalized_mac)
  returning * into new_node;

  return jsonb_build_object('node', to_jsonb(new_node));
end;
$$;

create or replace function public.authenticate_gateway_by_mac(target_mac text) returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select nodes.id
  from public.nodes
  join public.units on units.id = nodes.unit_id
  join public.sites on sites.id = units.site_id
  where nodes.mac_address = upper(trim(target_mac))
    and nodes.status = 'assigned'
    and nodes.position = 1
    and units.status = 'active'
    and sites.archived_at is null
  limit 1
$$;

revoke all on function public.authenticate_gateway_by_mac(text)
  from public, anon, authenticated;
grant execute on function public.authenticate_gateway_by_mac(text) to service_role;

-- The old functions and credential table are intentionally removed rather than
-- merely left unused, so no UI or firmware path can reintroduce key setup.
drop function if exists public.rotate_node_ingest_key(uuid);
drop function if exists private.rotate_node_ingest_key_impl(uuid);
drop function if exists public.authenticate_gateway(text, text);
drop table if exists private.node_credentials;
