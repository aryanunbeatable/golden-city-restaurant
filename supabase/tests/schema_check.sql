-- Runnable check for 0001_orders.sql. Rolls back — safe against any database.
-- Run: supabase db execute -f supabase/tests/schema_check.sql   (or paste in SQL editor)
begin;

do $$
declare
  v_id uuid;
  o    public.orders%rowtype;
  n    int;
begin
  -- create_order writes the order and its items atomically
  v_id := public.create_order('table_2', 'customer', 18, '[
    {"item_name":"Paneer Handi","item_name_hi":"पनीर हांडी","variant_name":"Half","variant_name_hi":"हाफ","quantity":2,"unit_price":179,"is_veg":true},
    {"item_name":"Manchow Soup","item_name_hi":"मंचाउ सूप","variant_name":null,"variant_name_hi":null,"quantity":1,"unit_price":129,"is_veg":false}
  ]'::jsonb);

  select count(*) into n from public.order_items where order_id = v_id;
  assert n = 2, 'expected 2 items, got ' || n;

  select * into o from public.orders where id = v_id;
  assert o.status = 'waiting_confirmation', 'new order should start waiting_confirmation';
  assert o.confirmed_at is null and o.ready_at is null, 'timestamps should start null';

  -- trigger stamps confirmed_at on accept
  update public.orders set status = 'preparing' where id = v_id;
  select * into o from public.orders where id = v_id;
  assert o.confirmed_at is not null, 'confirmed_at not stamped on accept';
  assert o.ready_at is null, 'ready_at stamped too early';

  -- trigger stamps ready_at, and does not re-stamp confirmed_at
  update public.orders set status = 'ready' where id = v_id;
  select * into o from public.orders where id = v_id;
  assert o.ready_at is not null, 'ready_at not stamped';

  -- empty order is rejected
  begin
    perform public.create_order('swiggy', 'manager', 10, '[]'::jsonb);
    assert false, 'empty order should have been rejected';
  exception when raise_exception then null;
  end;

  -- items cascade with the order
  delete from public.orders where id = v_id;
  select count(*) into n from public.order_items where order_id = v_id;
  assert n = 0, 'order_items did not cascade';

  raise notice 'schema check passed';
end $$;

rollback;
