-- MAC address is the only staff-managed hardware identity.
-- Keep the legacy serial_number column for compatibility, but derive it from MAC.

create or replace function public.sync_manufactured_node_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  compact_mac text;
begin
  compact_mac := upper(regexp_replace(coalesce(new.mac_addr, ''), '[^0-9A-F]', '', 'g'));
  if length(compact_mac) <> 12 then
    raise exception 'MAC address must contain exactly 12 hexadecimal characters';
  end if;

  new.mac_addr := substr(compact_mac, 1, 2) || ':' ||
    substr(compact_mac, 3, 2) || ':' ||
    substr(compact_mac, 5, 2) || ':' ||
    substr(compact_mac, 7, 2) || ':' ||
    substr(compact_mac, 9, 2) || ':' ||
    substr(compact_mac, 11, 2);
  new.serial_number := 'NODE-' || compact_mac;
  return new;
end;
$$;

update public.manufactured_nodes
set mac_addr = upper(mac_addr),
    serial_number = 'NODE-' || replace(upper(mac_addr), ':', '');

drop trigger if exists sync_manufactured_node_identity on public.manufactured_nodes;
create trigger sync_manufactured_node_identity
before insert or update of mac_addr on public.manufactured_nodes
for each row execute function public.sync_manufactured_node_identity();

revoke all on function public.sync_manufactured_node_identity() from public, anon;
grant execute on function public.sync_manufactured_node_identity() to authenticated, service_role;
