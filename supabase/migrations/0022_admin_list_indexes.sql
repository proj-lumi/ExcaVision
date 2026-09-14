-- Keep server-side admin search and paging responsive as operational data grows.

create extension if not exists pg_trgm with schema extensions;

create index if not exists service_requests_location_name_trgm_idx
  on public.service_requests using gin (location_name extensions.gin_trgm_ops);
create index if not exists service_requests_name_trgm_idx
  on public.service_requests using gin (name extensions.gin_trgm_ops);
create index if not exists service_requests_email_trgm_idx
  on public.service_requests using gin (email extensions.gin_trgm_ops);
create index if not exists service_requests_company_trgm_idx
  on public.service_requests using gin (company extensions.gin_trgm_ops);
create index if not exists service_requests_created_at_idx
  on public.service_requests (created_at desc);

create index if not exists sites_name_trgm_idx
  on public.sites using gin (name extensions.gin_trgm_ops);
create index if not exists pipes_name_trgm_idx
  on public.pipes using gin (name extensions.gin_trgm_ops);
create index if not exists pipes_deployment_created_idx
  on public.pipes (deployment_status, created_at desc);

create index if not exists manufactured_nodes_serial_trgm_idx
  on public.manufactured_nodes using gin (serial_number extensions.gin_trgm_ops);
create index if not exists manufactured_nodes_mac_trgm_idx
  on public.manufactured_nodes using gin (mac_addr extensions.gin_trgm_ops);
create index if not exists manufactured_nodes_status_manufactured_idx
  on public.manufactured_nodes (status, manufactured_at desc);

create index if not exists service_request_targets_request_created_idx
  on public.service_request_targets (service_request_id, created_at);
