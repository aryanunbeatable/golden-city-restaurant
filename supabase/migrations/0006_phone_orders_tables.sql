-- Phone orders, part 2 of 3: columns, constraints and the OTP tables.
-- Run 0005 first — this file uses the enum values it adds.
-- Apply with: supabase db push   (or paste into the SQL editor)

create type order_service_type as enum ('takeaway','dine_in');

-- ---------- order columns ----------
alter table public.orders
  add column service_type      order_service_type,  -- phone orders only
  add column scheduled_for     timestamptz,         -- when the food must be READY
  add column customer_name     text,
  add column customer_phone    text,                -- never shown on the kitchen board
  add column payment_reference text,                -- razorpay payment id, needed to refund
  add column refunded_at       timestamptz;

-- A phone order is only meaningful with a name, a number and a ready-by time;
-- nothing else may carry them. Enforced here rather than in the app because
-- three separate clients write orders.
alter table public.orders add constraint orders_phone_fields_ck check (
  (source = 'phone' and service_type is not null and scheduled_for is not null
                    and customer_name is not null and customer_phone is not null)
  or
  (source <> 'phone' and service_type is null and scheduled_for is null)
);

-- The kitchen's SCHEDULED column and the manager's approval queue both order
-- by when the food is due.
create index orders_scheduled_for_idx on public.orders (scheduled_for)
  where scheduled_for is not null;

-- ---------- OTP ----------
-- One row per number. The code is stored hashed — a leaked table must not hand
-- out working codes.
create table public.phone_verifications (
  phone      text primary key,
  code_hash  text        not null,
  expires_at timestamptz not null,
  attempts   int         not null default 0,
  created_at timestamptz not null default now()
);

-- Send log backing the rate limits. Serverless functions share no memory, so
-- the counter has to live in the database.
create table public.otp_send_log (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  ip         text,
  created_at timestamptz not null default now()
);
create index otp_send_log_phone_created_idx on public.otp_send_log (phone, created_at desc);
create index otp_send_log_ip_created_idx    on public.otp_send_log (ip, created_at desc);

-- RLS on with NO policies: anon and authenticated get nothing at all. These
-- tables are read and written only by server code holding the service-role key.
alter table public.phone_verifications enable row level security;
alter table public.otp_send_log        enable row level security;
