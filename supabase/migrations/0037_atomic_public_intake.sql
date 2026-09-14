-- Apply public intake limits and insertion in one database transaction so
-- concurrent requests cannot race between an Edge Function check and insert.
create or replace function public.create_public_installation_intake(
  p_name text,
  p_company text,
  p_email text,
  p_phone text,
  p_location_name text,
  p_location_label text,
  p_location_notes text,
  p_latitude double precision,
  p_longitude double precision,
  p_osm_url text,
  p_google_maps_url text,
  p_source_ip_hash text,
  p_request_fingerprint text,
  p_turnstile_hostname text,
  p_turnstile_action text,
  p_disable_cooldown boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_intake_id uuid;
  normalized_email text := lower(trim(p_email));
begin
  -- The service-role-only grant below is the trust boundary for this function.
  perform pg_advisory_xact_lock(hashtextextended('intake-email:' || normalized_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('intake-fingerprint:' || p_request_fingerprint, 0));
  if p_source_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('intake-ip:' || p_source_ip_hash, 0));
  end if;

  if not p_disable_cooldown then
    if exists (
      select 1 from public.service_request_intakes
      where email = normalized_email and created_at >= now() - interval '30 minutes'
    ) then
      raise exception 'recent_email_intake';
    end if;
    if exists (
      select 1 from public.service_request_intakes
      where request_fingerprint = p_request_fingerprint and created_at >= now() - interval '24 hours'
    ) then
      raise exception 'duplicate_installation_intake';
    end if;
    if (
      select count(*) from public.service_request_intakes
      where email = normalized_email and created_at >= now() - interval '24 hours'
    ) >= 3 then
      raise exception 'daily_email_intake_limit';
    end if;
    if p_source_ip_hash is not null and (
      select count(*) from public.service_request_intakes
      where source_ip_hash = p_source_ip_hash and created_at >= now() - interval '1 hour'
    ) >= 5 then
      raise exception 'hourly_ip_intake_limit';
    end if;
  end if;

  insert into public.service_request_intakes (
    name,
    company,
    email,
    phone,
    location_name,
    location_label,
    location_notes,
    latitude,
    longitude,
    osm_url,
    google_maps_url,
    source_ip_hash,
    request_fingerprint,
    turnstile_hostname,
    turnstile_action
  ) values (
    trim(p_name),
    nullif(trim(coalesce(p_company, '')), ''),
    normalized_email,
    trim(p_phone),
    trim(p_location_name),
    nullif(trim(coalesce(p_location_label, '')), ''),
    nullif(trim(coalesce(p_location_notes, '')), ''),
    p_latitude,
    p_longitude,
    p_osm_url,
    p_google_maps_url,
    p_source_ip_hash,
    p_request_fingerprint,
    p_turnstile_hostname,
    p_turnstile_action
  )
  returning id into new_intake_id;

  return new_intake_id;
end;
$$;

revoke all on function public.create_public_installation_intake(
  text, text, text, text, text, text, text, double precision, double precision,
  text, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_public_installation_intake(
  text, text, text, text, text, text, text, double precision, double precision,
  text, text, text, text, text, text, boolean
) to service_role;
