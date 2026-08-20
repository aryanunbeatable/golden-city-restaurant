-- Remember which Razorpay order belongs to which of ours.
-- Apply with: supabase db push   (or paste into the SQL editor)
--
-- WHY: when a customer's browser dies between Razorpay capturing the money and
-- our confirm callback running, the order is stuck in awaiting_payment and we
-- have to go ask Razorpay what happened. Razorpay's `receipt` field already
-- carries our order id, so we *can* find it with GET /orders?receipt=... — but
-- that list endpoint is eventually consistent. Measured against the live test
-- API, a freshly created order was fetchable by id immediately and did not
-- appear in the filtered list for about two minutes. Fetching by id has no such
-- lag, so we store the id.
--
-- Nullable on purpose: only phone orders have one, and rows written before this
-- migration never will. The reconcile sweep falls back to the receipt lookup
-- for those.

alter table public.orders add column razorpay_order_id text;

-- Lets the sweep, and later the webhook, go from their id straight to ours.
create index orders_razorpay_order_id_idx on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;
