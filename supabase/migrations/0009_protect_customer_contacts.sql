-- Take customer phone numbers off the world-readable orders table, and add a
-- rate-limit ledger for the public ordering endpoint.
-- Run 0008 first if you haven't. Apply with: supabase db push (or SQL editor).
--
-- WHY: public.orders is readable by anyone, by design — `orders_read` is
-- `for select using (true)` and the anon key that satisfies it is embedded in
-- the customer site's JavaScript. That was a considered tradeoff when a row
-- held "seven dishes and a rupee total". It stops being acceptable the moment
-- the row holds a name and a mobile number, which anyone could then dump with
-- a single curl against the REST API.
--
-- Column-level GRANTs were the other option, but revoking one column from
-- anon breaks every `select("*")` in the app and it is not clear they filter
-- Realtime payloads. Moving the number to its own locked table cannot leak
-- through either path.

create table public.order_contacts (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  phone      text        not null,
  created_at timestamptz not null default now()
);

-- RLS on, no policies: anon and authenticated get nothing. Read only by
-- server code holding the service-role key — the manager's approval queue.
alter table public.order_contacts enable row level security;

-- The constraint mentions customer_phone, so it has to go before the column.
alter table public.orders drop constraint orders_phone_fields_ck;
alter table public.orders drop column customer_phone;

-- customer_name stays on orders: the kitchen card needs it to call out whose
-- bag is ready, and the kitchen board reads with the anon key over Realtime.
-- A first name is far less identifying than a name paired with a number.
alter table public.orders add constraint orders_phone_fields_ck check (
  (source = 'phone' and service_type is not null and scheduled_for is not null
                    and customer_name is not null)
  or
  (source <> 'phone' and service_type is null and scheduled_for is null)
);

-- ---------- rate limiting ----------
-- /order is public and unauthenticated: every call writes an order row, its
-- items, and a Razorpay order. Serverless functions share no memory, so the
-- counter lives here. Replaces otp_send_log, which was the same idea with a
-- narrower name.
drop table if exists public.otp_send_log;

create table public.rate_limit_events (
  id         uuid primary key default gen_random_uuid(),
  bucket     text not null,   -- 'phone_order' | 'otp_send'
  key        text not null,   -- phone number, or client IP
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx
  on public.rate_limit_events (bucket, key, created_at desc);

alter table public.rate_limit_events enable row level security;
