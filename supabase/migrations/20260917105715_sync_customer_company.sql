-- Keep the active site's company display aligned with the customer's profile company.
create function public.sync_customer_company_from_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.company_name is distinct from old.company_name then
    update public.sites
    set company_name = new.company_name
    where customer_id = new.id
      and archived_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_customer_company_from_profile() from public, anon, authenticated, service_role;

drop trigger if exists profiles_sync_customer_company on public.profiles;
create trigger profiles_sync_customer_company
after update of company_name on public.profiles
for each row execute function public.sync_customer_company_from_profile();
