-- Store the complete unit state separately from the short customer description.
-- A unit repair report includes every node and every sensor reading/status captured
-- when the customer submits the request.
alter table public.service_requests
  add column repair_report jsonb;

alter table public.service_requests
  add constraint service_requests_repair_report_check
  check (repair_report is null or jsonb_typeof(repair_report) = 'object');

comment on column public.service_requests.repair_report is
  'Customer-captured unit repair report: unit status plus every node and sensor reading/status.';

-- Keep the existing six-argument RPC working, while allowing repair requests to
-- store the structured report without packing it into the 2,000-character details field.
create function private.submit_customer_request_impl(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_units jsonb,
  target_details text,
  target_repair_report jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  request_id uuid;
  requested_target_unit_id uuid := target_unit_id;
begin
  if target_repair_report is not null
    and jsonb_typeof(target_repair_report) <> 'object' then
    raise exception 'invalid_repair_report' using errcode = '22023';
  end if;

  if target_repair_report is not null and target_request_type <> 'repair' then
    raise exception 'repair_report_not_allowed' using errcode = '22023';
  end if;

  if target_request_type = 'repair' and target_unit_id is not null
    and not exists (
      select 1 from public.units
      where id = target_unit_id
        and site_id = target_site_id
        and status <> 'archived'
        and archived_at is null
    ) then
    raise exception 'target_unit_unavailable' using errcode = 'P0001';
  end if;

  request_id := private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    case when target_request_type = 'repair' then null::uuid else target_unit_id end,
    target_requested_count,
    target_requested_units,
    target_details
  );

  update public.service_requests
  set target_unit_id = requested_target_unit_id,
      repair_report = target_repair_report
  where id = request_id;

  return request_id;
end;
$$;

create function public.submit_customer_request(
  target_site_id uuid,
  target_request_type public.service_request_type,
  target_unit_id uuid,
  target_requested_count smallint,
  target_requested_units jsonb,
  target_details text,
  target_repair_report jsonb
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.submit_customer_request_impl(
    target_site_id,
    target_request_type,
    target_unit_id,
    target_requested_count,
    target_requested_units,
    target_details,
    target_repair_report
  )
$$;

revoke all on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_customer_request_impl(uuid, public.service_request_type, uuid, smallint, jsonb, text, jsonb)
  to authenticated;
revoke all on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_customer_request(uuid, public.service_request_type, uuid, smallint, jsonb, text, jsonb)
  to authenticated;
