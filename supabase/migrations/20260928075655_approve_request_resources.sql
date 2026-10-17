-- Approve a customer request by creating all submitted resources in one
-- transaction. Repeated calls are safe and return the existing resources.
create function private.approve_request_resources_impl(target_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  req public.service_requests%rowtype;
  target_site_id uuid;
  target_site_name text;
  unit_spec jsonb;
  unit_index integer;
  target_unit_id uuid;
  unit_name text;
  base_slug text;
  slug_text text;
  suffix integer;
  created_unit_ids jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into req
  from public.service_requests
  where id = target_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if req.status <> 'open' then
    raise exception 'request_not_open' using errcode = 'P0001';
  end if;
  if req.request_type not in ('site_installation', 'add_unit') then
    raise exception 'request_resources_not_supported' using errcode = 'P0001';
  end if;
  if req.requested_units is null
    or jsonb_typeof(req.requested_units) <> 'array'
    or jsonb_array_length(req.requested_units) = 0 then
    raise exception 'requested_units_missing' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(req.requested_units) as item
    group by lower(trim(item->>'name'))
    having count(*) > 1
  ) then
    raise exception 'requested_unit_names_duplicate' using errcode = '22023';
  end if;

  if req.request_type = 'site_installation' then
    target_site_id := req.site_id;
    if target_site_id is null then
      target_site_id := private.create_site_from_request_impl(req.id, req.site_name);
    end if;
  else
    target_site_id := req.site_id;
    if target_site_id is null or not exists (
      select 1 from public.sites where id = target_site_id and archived_at is null
    ) then
      raise exception 'request_site_unavailable' using errcode = 'P0001';
    end if;
  end if;

  select name into target_site_name from public.sites where id = target_site_id;

  for unit_spec, unit_index in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(req.requested_units) with ordinality
  loop
    unit_name := trim(unit_spec->>'name');

    select id into target_unit_id
    from public.units
    where source_request_id = req.id
      and source_request_unit_index = unit_index
      and archived_at is null;

    if target_unit_id is null then
      base_slug := trim(both '-' from regexp_replace(lower(target_site_name || ' ' || unit_name), '[^a-z0-9]+', '-', 'g'));
      if base_slug = '' then base_slug := 'unit'; end if;

      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.units.slug:' || base_slug, 0));
      slug_text := base_slug;
      suffix := 1;
      while exists (select 1 from public.units where slug = slug_text) loop
        suffix := suffix + 1;
        slug_text := base_slug || '-' || suffix;
      end loop;

      insert into public.units (
        slug,
        site_id,
        name,
        status,
        source_request_id,
        source_request_unit_index
      ) values (
        slug_text,
        target_site_id,
        unit_name,
        'setup_pending',
        req.id,
        unit_index
      )
      returning id into target_unit_id;
    end if;

    created_unit_ids := created_unit_ids || jsonb_build_array(target_unit_id);
  end loop;

  return jsonb_build_object(
    'site_id', target_site_id,
    'unit_ids', created_unit_ids
  );
end;
$$;

create function public.approve_request_resources(target_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.approve_request_resources_impl(target_request_id)
$$;

revoke all on function private.approve_request_resources_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.approve_request_resources_impl(uuid)
  to authenticated;

revoke all on function public.approve_request_resources(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_request_resources(uuid)
  to authenticated;

notify pgrst, 'reload schema';
