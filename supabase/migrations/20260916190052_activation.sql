-- Customer account activation: called after a customer sets their password from an invite.
-- Marks their profile active and advances their site's invitation status.
create function public.activate_customer() returns void
language plpgsql security definer set search_path = public as $$
declare
  profile_id uuid;
begin
  select id into profile_id from public.profiles where auth_user_id = auth.uid() and role = 'customer';
  if profile_id is null then raise exception 'profile_not_found' using errcode = 'P0001'; end if;
  update public.profiles set account_status = 'active' where id = profile_id;
  update public.sites set invitation_status = 'activated'
  where customer_id = profile_id and invitation_status = 'invited';
end;
$$;

revoke execute on function public.activate_customer() from public, anon;
grant execute on function public.activate_customer() to authenticated;
