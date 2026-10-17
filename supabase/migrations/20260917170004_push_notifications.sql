-- Web Push subscriptions are service-role-only capability data. Browser clients
-- register through the authenticated push-subscriptions Edge Function instead of
-- reading or writing this table through the Data API.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 256),
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create index push_subscriptions_auth_user_idx
  on public.push_subscriptions(auth_user_id);

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- The explicit restrictive policy makes the client denial clear to the Security
-- Advisor while service_role continues to bypass RLS inside Edge Functions.
create policy push_subscriptions_deny_clients
on public.push_subscriptions
as restrictive for all to anon, authenticated
using (false)
with check (false);

-- Returns only subscriptions belonging to the customer who owns the alert's
-- site. It is callable exclusively by service_role from Edge Functions.
create function public.get_push_subscriptions_for_event(
  target_event_kind text,
  target_event_id uuid
) returns table (
  endpoint text,
  p256dh text,
  auth text
)
language sql stable security invoker set search_path = '' as $$
  select subscriptions.endpoint, subscriptions.p256dh, subscriptions.auth
  from public.push_subscriptions as subscriptions
  join public.profiles as profile
    on profile.auth_user_id = subscriptions.auth_user_id
  where profile.account_status = 'active'
    and profile.role = 'customer'
    and (
      target_event_kind = 'threshold'
      and exists (
        select 1
        from public.threshold_events as event
        join public.units as unit on unit.id = event.unit_id
        join public.sites as site on site.id = unit.site_id
        where event.id = target_event_id
          and site.customer_id = profile.id
          and site.archived_at is null
      )
      or target_event_kind = 'anomaly'
      and exists (
        select 1
        from public.anomaly_events as event
        join public.units as unit on unit.id = event.unit_id
        join public.sites as site on site.id = unit.site_id
        where event.id = target_event_id
          and site.customer_id = profile.id
          and site.archived_at is null
      )
    )
$$;

revoke all on function public.get_push_subscriptions_for_event(text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_push_subscriptions_for_event(text, uuid)
  to service_role;

comment on table public.push_subscriptions is
  'Confidential browser push capabilities. They are accessible only to service-role Edge Functions.';
comment on function public.get_push_subscriptions_for_event(text, uuid) is
  'Returns the owning active customer push subscriptions for one persisted alert; service-role only.';
