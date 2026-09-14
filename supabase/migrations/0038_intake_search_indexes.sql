-- Public intake uses the same one-key partial-text search as the canonical
-- request queue. Keep each promised field indexed as intake volume grows.
create index if not exists service_request_intakes_location_name_trgm_idx
  on public.service_request_intakes using gin (location_name extensions.gin_trgm_ops);
create index if not exists service_request_intakes_name_trgm_idx
  on public.service_request_intakes using gin (name extensions.gin_trgm_ops);
create index if not exists service_request_intakes_email_trgm_idx
  on public.service_request_intakes using gin (email extensions.gin_trgm_ops);
create index if not exists service_request_intakes_company_trgm_idx
  on public.service_request_intakes using gin (company extensions.gin_trgm_ops);
