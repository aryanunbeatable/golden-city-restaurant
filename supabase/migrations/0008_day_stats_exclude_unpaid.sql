-- The history calendar's per-day totals must ignore abandoned phone checkouts.
-- Apply with: supabase db push   (or paste into the SQL editor)
--
-- order_day_stats() previously excluded only 'cancelled'. An order sitting in
-- 'awaiting_payment' is someone who opened the payment sheet and walked away —
-- no money arrived, so counting it as revenue would overstate every day it
-- happens on. Same rule as the client-side history queries.

create or replace function public.order_day_stats(p_start timestamptz, p_end timestamptz)
returns table (day_key date, order_count bigint, revenue numeric)
language sql stable as $$
  select
    ((o.created_at at time zone 'Asia/Kolkata') - interval '4 hours')::date as day_key,
    count(*) as order_count,
    coalesce(sum(i.line_total), 0) as revenue
  from public.orders o
  left join lateral (
    select coalesce(sum(quantity * unit_price), 0) as line_total
    from public.order_items
    where order_id = o.id
  ) i on true
  where o.created_at >= p_start
    and o.created_at <  p_end
    and o.status not in ('cancelled', 'awaiting_payment')
  group by 1
$$;
