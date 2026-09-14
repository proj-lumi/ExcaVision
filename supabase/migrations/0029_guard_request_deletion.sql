-- Permanent deletion is only for an open, pre-approval record entered in error.
-- Approved and closed requests must retain their audit trail.

create or replace function public.admin_delete_service_request(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_request public.service_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into source_request
  from public.service_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'service request not found'; end if;
  if source_request.status in ('approved', 'closed')
     or source_request.created_site_id is not null
     or source_request.created_pipe_id is not null
     or source_request.fulfillment_path is not null
     or exists (
       select 1 from public.service_request_targets
       where service_request_id = source_request.id
     ) then
    raise exception 'close this request instead so its work history is preserved';
  end if;

  delete from public.service_requests where id = source_request.id;
end;
$$;

revoke all on function public.admin_delete_service_request(uuid) from public, anon;
grant execute on function public.admin_delete_service_request(uuid) to authenticated;
