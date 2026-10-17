-- Foreign-key indexes (Supabase Advisor: unindexed_foreign_keys)
create index service_requests_requester_id_idx on public.service_requests(requester_id);
create index service_requests_site_id_idx on public.service_requests(site_id);
create index sites_customer_id_idx on public.sites(customer_id);
create index nodes_unit_id_idx on public.nodes(unit_id);
create index threshold_events_sensor_id_idx on public.threshold_events(sensor_id);
create index anomaly_events_node_id_idx on public.anomaly_events(node_id);
create index anomaly_events_sensor_id_idx on public.anomaly_events(sensor_id);
create index request_attachments_request_id_idx on public.request_attachments(request_id);
create index request_abuse_signals_request_id_idx on public.request_abuse_signals(request_id);

-- Internal helper: derive a unit's status from its assigned nodes.
create function public.sync_unit_status(target_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.units
  set status = case
    when exists (select 1 from public.nodes where unit_id = target_unit_id and status = 'assigned') then 'active'
    else 'setup_pending'
  end,
  updated_at = now()
  where id = target_unit_id and status <> 'archived';
end;
$$;

-- Customer-submitted request (repair / add_nodes / add_unit). Site-scoped and authenticated only.
create function public.submit_customer_request(target_site_id uuid, target_request_type public.service_request_type, target_details text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  request_id uuid;
  current_site public.sites%rowtype;
  current_profile public.profiles%rowtype;
begin
  if target_request_type not in ('repair', 'add_nodes', 'add_unit') then
    raise exception 'invalid_request_type' using errcode = '22023';
  end if;
  if not public.owns_site(target_site_id) then
    raise exception 'site_not_owned' using errcode = '42501';
  end if;
  select * into current_site from public.sites where id = target_site_id;
  select * into current_profile from public.profiles where id = public.current_profile_id();
  insert into public.service_requests (
    request_type, status, requester_id, requester_name, company_name, contact_email, contact_phone,
    site_id, site_name, address_label, latitude, longitude, details
  ) values (
    target_request_type, 'received', current_profile.id, current_profile.full_name, current_profile.company_name,
    current_profile.email, current_profile.phone, current_site.id, current_site.name, current_site.address_label,
    current_site.latitude, current_site.longitude, target_details
  ) returning id into request_id;
  return request_id;
end;
$$;

-- Admin: create a site from a reviewed site_installation request.
create function public.create_site_from_request(target_request_id uuid, target_site_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  req public.service_requests%rowtype;
  profile_id uuid;
  new_site_id uuid;
  base_slug text;
  slug_text text;
  counter int := 0;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  select * into req from public.service_requests where id = target_request_id for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if req.request_type <> 'site_installation' then raise exception 'not_installation' using errcode = 'P0001'; end if;
  if req.status <> 'reviewed' then raise exception 'not_reviewed' using errcode = 'P0001'; end if;
  if req.site_id is not null then raise exception 'already_linked' using errcode = 'P0001'; end if;

  select id into profile_id from public.profiles where role = 'customer' and email = req.contact_email;
  if profile_id is null then
    insert into public.profiles (auth_user_id, role, full_name, email, phone, company_name, account_status)
    values (null, 'customer', req.requester_name, req.contact_email, req.contact_phone, req.company_name, 'pending')
    returning id into profile_id;
  end if;

  base_slug := lower(regexp_replace(target_site_name, '[^a-z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'site'; end if;
  slug_text := base_slug;
  loop
    exit when not exists (select 1 from public.sites where slug = slug_text);
    counter := counter + 1;
    slug_text := base_slug || '-' || counter;
  end loop;

  insert into public.sites (slug, name, address_label, latitude, longitude, company_name, customer_id, source_request_id, invitation_status)
  values (slug_text, target_site_name, req.address_label, req.latitude, req.longitude, req.company_name, profile_id, req.id, 'not_invited')
  returning id into new_site_id;

  update public.service_requests set site_id = new_site_id, requester_id = profile_id where id = req.id;
  return new_site_id;
end;
$$;

-- Admin: assign an unassigned node to a unit (position = next available).
create function public.assign_node(target_node_id uuid, target_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  next_position int;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.nodes where id = target_node_id and status = 'unassigned') then
    raise exception 'node_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.units where id = target_unit_id and status <> 'archived') then
    raise exception 'unit_unavailable' using errcode = 'P0001';
  end if;
  select coalesce(max(position), 0) + 1 into next_position
  from public.nodes where unit_id = target_unit_id and status = 'assigned';
  update public.nodes set status = 'assigned', unit_id = target_unit_id, position = next_position where id = target_node_id;
  perform public.sync_unit_status(target_unit_id);
end;
$$;

-- Admin: archive a node and compact remaining positions.
create function public.archive_node(target_node_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.nodes%rowtype;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  select * into target from public.nodes where id = target_node_id;
  if not found then raise exception 'node_not_found' using errcode = 'P0001'; end if;
  if target.status = 'archived' then return; end if;
  update public.nodes set status = 'archived', archived_at = now() where id = target_node_id;
  if target.unit_id is not null and target.position is not null then
    update public.nodes set position = position - 1
    where unit_id = target.unit_id and status = 'assigned' and position > target.position;
    perform public.sync_unit_status(target.unit_id);
  end if;
end;
$$;

-- Admin: archive a unit and its assigned nodes.
create function public.archive_unit(target_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.units where id = target_unit_id and status <> 'archived') then return; end if;
  update public.units set status = 'archived', archived_at = now() where id = target_unit_id;
  update public.nodes set status = 'archived', archived_at = now()
  where unit_id = target_unit_id and status = 'assigned';
end;
$$;

-- Admin: archive a site and cascade to its units/nodes.
create function public.archive_site(target_site_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  unit_id uuid;
begin
  if not public.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.sites where id = target_site_id and archived_at is null) then return; end if;
  update public.sites set archived_at = now() where id = target_site_id;
  for unit_id in select id from public.units where site_id = target_site_id and status <> 'archived' loop
    perform public.archive_unit(unit_id);
  end loop;
end;
$$;

revoke execute on function public.sync_unit_status(uuid) from public, anon, authenticated;

revoke execute on function public.submit_customer_request(uuid, public.service_request_type, text) from public, anon;
revoke execute on function public.create_site_from_request(uuid, text) from public, anon;
revoke execute on function public.assign_node(uuid, uuid) from public, anon;
revoke execute on function public.archive_node(uuid) from public, anon;
revoke execute on function public.archive_unit(uuid) from public, anon;
revoke execute on function public.archive_site(uuid) from public, anon;

grant execute on function public.submit_customer_request(uuid, public.service_request_type, text) to authenticated;
grant execute on function public.create_site_from_request(uuid, text) to authenticated;
grant execute on function public.assign_node(uuid, uuid) to authenticated;
grant execute on function public.archive_node(uuid) to authenticated;
grant execute on function public.archive_unit(uuid) to authenticated;
grant execute on function public.archive_site(uuid) to authenticated;

-- Customer file uploads: only into the request-attachments bucket, only under their own request folder.
create policy request_files_customer_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'request-attachments'
  and (storage.foldername(name))[1] in (
    select id::text from public.service_requests where requester_id = public.current_profile_id()
  )
);

-- Customer attachment metadata: only for their own requests.
create policy attachments_customer_insert on public.request_attachments for insert to authenticated with check (
  exists (
    select 1 from public.service_requests
    where service_requests.id = request_attachments.request_id
      and service_requests.requester_id = public.current_profile_id()
  )
);
