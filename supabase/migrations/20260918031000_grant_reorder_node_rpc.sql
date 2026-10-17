-- The public invoker wrapper calls this admin-checked implementation.
grant execute on function private.reorder_unit_node_impl(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
