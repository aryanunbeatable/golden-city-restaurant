-- Per-day totals for the history calendar.
-- Apply with: supabase db push   (or paste into the SQL editor)

-- The calendar shows a count and a rupee total in all ~31 cells at once.
-- Fetching the month's orders and their items just to sum them client-side is
-- megabytes over the wire for a few dozen numbers; this returns the numbers.
--
-- day_key applies the same 4AM IST kitchen-day boundary as src/lib/business-day.ts:
-- shift into IST, subtract the 4h cutoff, and the calendar date that lands on is
-- the service day. Cancelled orders are excluded — a voided order must not
-- change a day's totals.
create function public.order_day_stats(p_start timestamptz, p_end timestamptz)
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
    and o.status <> 'cancelled'
  group by 1
$$;

grant execute on function public.order_day_stats(timestamptz, timestamptz) to anon, authenticated;
