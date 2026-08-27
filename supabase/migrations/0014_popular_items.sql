-- Ranking behind the manager's "Most ordered" strip and the customer "Popular"
-- section.
-- Apply with: supabase db push   (or paste into the SQL editor)

-- Same shape and reasoning as order_day_stats (0004): aggregate in SQL rather
-- than shipping every order_items row to the browser to be counted there.
--
-- Ranked by how many distinct ORDERS contained the item, never by units sold.
-- Five rotis on one bill is one order — otherwise a ₹10 Tawa Roti outranks a
-- ₹579 platter on volume alone and the strip fills with breads.
--
-- p_since null means all time. The caller uses that for the "is there enough
-- data to show this yet" gate: all-time counts only ever grow, so once the gate
-- opens it can never close. That is the latch, with no stored state to keep in
-- sync and nothing that can flicker as the rolling window slides.
--
-- Excluded here: cancelled and abandoned orders (a voided token must not shape
-- the menu), and the aggregators — Swiggy/Zomato demand is driven by their
-- promotions and a different price list, and must not steer what the counter
-- and the dine-in guests see.
--
-- Water bottles are NOT excluded here. counterItem lives in menu.json and stays
-- the single source of truth for what is "sold, not cooked"; the caller filters
-- on it. Encoding those names again in SQL would be a second place to update.
create function public.popular_items(p_since timestamptz default null)
returns table (item_name text, variant_name text, order_count bigint)
language sql stable as $$
  select
    i.item_name,
    i.variant_name,
    count(distinct i.order_id) as order_count
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where (p_since is null or o.created_at >= p_since)
    and o.status not in ('cancelled', 'awaiting_payment')
    and o.source not in ('swiggy', 'zomato')
  group by i.item_name, i.variant_name
  order by order_count desc, i.item_name
$$;

grant execute on function public.popular_items(timestamptz) to anon, authenticated;
