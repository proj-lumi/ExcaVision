-- Public installation leads are quarantined until an admin accepts them.
-- Public callers never insert directly into the canonical service_requests queue.

create table if not exists public.service_request_intakes (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewed_by           uuid references public.profiles(id) on delete set null,
  status                text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'spam')),
  review_reason         text,
  accepted_request_id   uuid unique references public.service_requests(id) on delete restrict,
  request_type          text not null default 'Request installation'
    check (request_type = 'Request installation'),
  name                  text not null,
  company               text,
  email                 text not null,
  phone                 text not null,
  location_name         text not null,
  location_label        text,
  location_notes        text,
  latitude              double precision not null check (latitude between 4.2 and 21.5),
  longitude             double precision not null check (longitude between 116.5 and 127.0),
  osm_url               text not null,
  google_maps_url       text,
  source_ip_hash        text,
  request_fingerprint   text not null,
  turnstile_hostname    text,
  turnstile_action      text,
  constraint reviewed_intake_has_audit check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and review_reason is null and accepted_request_id is null)
    or
    (status = 'accepted' and reviewed_at is not null and reviewed_by is not null and accepted_request_id is not null)
    or
    (status in ('rejected', 'spam') and reviewed_at is not null and reviewed_by is not null and nullif(trim(review_reason), '') is not null and accepted_request_id is null)
  )
);

create index if not exists service_request_intakes_pending_idx
  on public.service_request_intakes (created_at desc)
  where status = 'pending';
create index if not exists service_request_intakes_email_created_idx
  on public.service_request_intakes (email, created_at desc);
create index if not exists service_request_intakes_ip_created_idx
  on public.service_request_intakes (source_ip_hash, created_at desc)
  where source_ip_hash is not null;
create index if not exists service_request_intakes_fingerprint_created_idx
  on public.service_request_intakes (request_fingerprint, created_at desc);

alter table public.service_request_intakes enable row level security;

create policy "admins manage service request intakes"
on public.service_request_intakes for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create or replace view public.admin_service_request_intake_list
with (security_invoker = true)
as
select *
from public.service_request_intakes;

grant select on public.admin_service_request_intake_list to authenticated;

create or replace function public.admin_accept_request_intake(p_intake_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  intake public.service_request_intakes%rowtype;
  new_request_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select * into intake
  from public.service_request_intakes
  where id = p_intake_id
  for update;

  if not found then
    raise exception 'intake not found';
  end if;
  if intake.status <> 'pending' then
    raise exception 'intake has already been reviewed';
  end if;

  insert into public.service_requests (
    request_type,
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
    status
  ) values (
    intake.request_type,
    intake.name,
    intake.company,
    intake.email,
    intake.phone,
    intake.location_name,
    intake.location_label,
    intake.location_notes,
    intake.latitude,
    intake.longitude,
    intake.osm_url,
    intake.google_maps_url,
    'submitted'
  )
  returning id into new_request_id;

  update public.service_request_intakes
  set status = 'accepted',
      accepted_request_id = new_request_id,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_intake_id;

  return new_request_id;
end;
$$;

create or replace function public.admin_reject_request_intake(
  p_intake_id uuid,
  p_disposition text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  intake_status text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if p_disposition not in ('rejected', 'spam') then
    raise exception 'invalid intake disposition';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'review reason must contain at least 3 characters';
  end if;

  select status into intake_status
  from public.service_request_intakes
  where id = p_intake_id
  for update;

  if intake_status is null then
    raise exception 'intake not found';
  end if;
  if intake_status <> 'pending' then
    raise exception 'intake has already been reviewed';
  end if;

  update public.service_request_intakes
  set status = p_disposition,
      review_reason = trim(p_reason),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_intake_id;
end;
$$;

revoke all on function public.admin_accept_request_intake(uuid) from public, anon;
revoke all on function public.admin_reject_request_intake(uuid, text, text) from public, anon;
grant execute on function public.admin_accept_request_intake(uuid) to authenticated;
grant execute on function public.admin_reject_request_intake(uuid, text, text) to authenticated;
