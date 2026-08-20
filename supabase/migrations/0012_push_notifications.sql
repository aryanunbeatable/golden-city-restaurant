-- Web push subscriptions, and the guard that stops the leave-nudge sweep
-- pinging the same customer twice.
-- Apply with: supabase db push   (or paste into the SQL editor)

-- One subscription per order, on purpose. Keying by phone would need an
-- identity model and would let one order's subscription reach another's
-- customer; keyed to the order it cascades away with the order and cannot.
create table public.push_subscriptions (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,   -- client public key, for payload encryption
  auth       text        not null,   -- client auth secret
  created_at timestamptz not null default now()
);

-- RLS on with NO policies: anon and authenticated get nothing at all. Written
-- and read only by server code holding the service-role key. Same posture as
-- order_contacts — an endpoint plus its keys is a capability to push to
-- someone's phone, not public data.
alter table public.push_subscriptions enable row level security;

-- The every-minute sweep finds orders crossing "10 minutes before due" and
-- must not send twice. Nullable: only set once a nudge has actually gone out.
alter table public.orders add column leave_notified_at timestamptz;

-- Covers the sweep's lookup: scheduled phone orders not yet nudged.
create index orders_leave_nudge_idx on public.orders (scheduled_for)
  where scheduled_for is not null and leave_notified_at is null;
