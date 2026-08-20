-- Remember when the reconcile sweep last asked Razorpay about an order.
-- Apply with: supabase db push   (or paste into the SQL editor)
--
-- WHY: an abandoned checkout leaves an orders row in awaiting_payment forever
-- — nothing cancels or deletes them, and they are invisible to the manager,
-- the kitchen and history. The sweep was the only thing reading them, and it
-- took the 10 newest. Two consequences, both real:
--
--   1. Starvation. A genuinely paid order whose browser died could be pushed
--      out of the 10-newest window by later abandoned checkouts and then never
--      looked at again. Its money stayed captured at Razorpay and the order
--      never reached anyone. The sweep exists precisely to stop that.
--   2. Volume. On the per-minute cron, the same dead orders were re-queried at
--      Razorpay roughly 28,800 times a day, forever answering "not paid".
--
-- Stamping each attempt fixes both: the sweep can order by least-recently-
-- checked (so nothing starves) and skip anything asked about recently (so dead
-- orders cost two API calls per back-off interval instead of two per minute).

alter table public.orders add column reconcile_checked_at timestamptz;

-- The sweep's ordering column. Partial, because only unpaid phone orders are
-- ever candidates and that is a tiny slice of the table.
create index orders_reconcile_idx
  on public.orders (reconcile_checked_at nulls first)
  where status = 'awaiting_payment';
