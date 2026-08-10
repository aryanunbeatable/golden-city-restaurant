-- Golden City Restaurant — orders + order_items
-- Apply with: supabase db push   (or paste into the SQL editor)

-- ---------- types ----------
create type order_source   as enum ('table_1','table_2','table_3','table_4','swiggy','zomato','parcel');
create type order_placed_by as enum ('customer','manager');
create type order_status    as enum ('waiting_confirmation','confirmed','preparing','ready');

-- ---------- tables ----------
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  source                 order_source    not null,
  placed_by              order_placed_by not null,
  status                 order_status    not null default 'waiting_confirmation',
  estimated_prep_minutes int             not null check (estimated_prep_minutes >= 0),
  created_at             timestamptz     not null default now(),
  confirmed_at           timestamptz,
  ready_at               timestamptz
);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  item_name       text not null,
  item_name_hi    text,           -- kitchen EN/हिं toggle; null falls back to item_name
  variant_name    text,
  variant_name_hi text,
  quantity        int  not null check (quantity > 0),
  unit_price      numeric(10,2) not null check (unit_price >= 0),
  is_veg          boolean not null
);

-- ---------- indexes ----------
create index order_items_order_id_idx        on public.order_items (order_id);            -- kitchen/customer fetch by order
create index orders_status_created_at_idx    on public.orders (status, created_at);       -- kitchen kanban columns
create index orders_placed_by_created_at_idx on public.orders (placed_by, created_at desc); -- manager "Active orders"
-- ponytail: no index on source. A 4-table restaurant does maybe 200 rows/day; seq scan wins.

-- ---------- timestamp stamping ----------
-- ponytail: one trigger instead of trusting three separate clients to set these.
create function public.stamp_order_times() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('confirmed','preparing') and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;
    if new.status = 'ready' and new.ready_at is null then
      new.ready_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger orders_stamp_times
  before update on public.orders
  for each row execute function public.stamp_order_times();

-- ---------- atomic order creation ----------
-- The order row and its items MUST land in one transaction. Two separate inserts
-- means the kitchen receives the orders INSERT event, refetches items, and gets an
-- empty list — a card with no dishes on it, and no second event to fix it.
create function public.create_order(
  p_source        order_source,
  p_placed_by     order_placed_by,
  p_prep_minutes  int,
  p_items         jsonb          -- [{item_name, item_name_hi, variant_name, variant_name_hi, quantity, unit_price, is_veg}, ...]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'order must have at least one item';
  end if;

  insert into orders (source, placed_by, estimated_prep_minutes)
  values (p_source, p_placed_by, p_prep_minutes)
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

grant execute on function public.create_order(order_source, order_placed_by, int, jsonb)
  to anon, authenticated;

-- ---------- row level security ----------
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Everyone (incl. the anon QR customer) can read. Order ids are unguessable UUIDs,
-- and the data is 7 dishes and a rupee total — not worth a token-scoping scheme.
create policy orders_read      on public.orders      for select using (true);
create policy order_items_read on public.order_items for select using (true);

-- Anyone holding the anon key can move an order forward. This looks looser
-- than it is: the actual access control in this app is the PIN-gated
-- /manager and /kitchen routes (custom signed-cookie sessions), not Supabase
-- Auth — no staff sign-in flow exists to make `to authenticated` meaningful.
-- Scoping this to `authenticated` silently no-ops every kitchen-board update
-- (0 rows affected, no error) since kitchen/manager clients only ever hold
-- the anon key. Revisit if real Supabase Auth for staff gets built later.
-- No insert/delete policies: inserts go exclusively through create_order().
create policy orders_staff_update on public.orders
  for update using (true) with check (true);

-- ---------- realtime ----------
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
-- ponytail: default replica identity (PK only). Add `replica identity full` only if
-- you later need old-row values or DELETE events matched by a non-PK filter.
