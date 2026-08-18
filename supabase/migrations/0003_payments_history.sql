-- Order history: payment tracking, voids, and a served timestamp.
-- Apply with: supabase db push   (or paste into the SQL editor)

-- ---------- types ----------
-- swiggy/zomato are settled by the platform, never at the counter — they're
-- payment methods in their own right, auto-assigned from the order source.
create type order_payment_method as enum ('table_online','counter_online','counter_cash','swiggy','zomato');
create type order_payment_status as enum ('pending','paid');

-- A mis-punched order can't be deleted (it'd vanish from history and the
-- numbers would silently change); it's cancelled, kept, and excluded from
-- every total. Not in any kitchen-board column, so it drops off the board.
alter type order_status add value 'cancelled';

-- ---------- columns ----------
alter table public.orders
  add column payment_method order_payment_method,          -- null until settled
  add column payment_status order_payment_status not null default 'pending',
  add column served_at      timestamptz;

-- ---------- indexes ----------
-- History browses by date across all orders; the existing composite indexes
-- both lead with another column and can't serve a plain range scan.
create index orders_created_at_idx on public.orders (created_at desc);

-- ---------- timestamp stamping ----------
-- Adds served_at to the existing trigger. Same rule as the others: the server
-- clock decides, never the client.
create or replace function public.stamp_order_times() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('confirmed','preparing') and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;
    if new.status = 'ready' and new.ready_at is null then
      new.ready_at := now();
    end if;
    if new.status = 'served' and new.served_at is null then
      new.served_at := now();
    end if;
  end if;
  return new;
end $$;

-- ---------- order creation ----------
-- Payment is now recorded at punch time where it's known (manager counter
-- entry, aggregators) and left pending where it isn't (customer QR orders,
-- guests paying at the counter later).
drop function if exists public.create_order(order_source, order_placed_by, int, jsonb);

create function public.create_order(
  p_source         order_source,
  p_placed_by      order_placed_by,
  p_prep_minutes   int,
  p_items          jsonb,
  p_payment_method order_payment_method default null,
  p_payment_status order_payment_status default 'pending'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'order must have at least one item';
  end if;

  insert into orders (source, placed_by, estimated_prep_minutes, payment_method, payment_status)
  values (p_source, p_placed_by, p_prep_minutes, p_payment_method, p_payment_status)
  returning id into v_id;

  insert into order_items (order_id, item_name, item_name_hi, variant_name, variant_name_hi,
                           quantity, unit_price, is_veg)
  select v_id,
         i->>'item_name',
         i->>'item_name_hi',
         i->>'variant_name',
         i->>'variant_name_hi',
         (i->>'quantity')::int,
         (i->>'unit_price')::numeric,
         (i->>'is_veg')::boolean
  from jsonb_array_elements(p_items) i;

  return v_id;
end $$;

grant execute on function public.create_order(order_source, order_placed_by, int, jsonb,
                                              order_payment_method, order_payment_status)
  to anon, authenticated;
