-- Keep Admin request setup resumable after refresh, navigation, or a lost session.
-- The step is an Admin workflow cursor; the site/unit/node records remain the
-- durable work produced by each step.
alter table public.service_requests
  add column setup_step smallint not null default 0;

alter table public.service_requests
  add constraint service_requests_setup_step_check
  check (setup_step between 0 and 8);
