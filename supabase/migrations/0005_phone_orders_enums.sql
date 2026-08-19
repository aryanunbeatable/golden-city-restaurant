-- Phone orders, part 1 of 3: enum values only.
-- Apply with: supabase db push   (or paste into the SQL editor)
--
-- These are split into their own migration on purpose. Postgres refuses to
-- USE a new enum value in the same transaction that ADDs it, and 0006's check
-- constraint refers to 'phone' — so the two cannot share a batch.
-- Run this file, then 0006.

alter type order_source         add value 'phone';
alter type order_payment_method add value 'phone_online';

-- Created but unpaid. Invisible to the manager, the kitchen, history and every
-- total until the Razorpay webhook confirms payment. The row exists from the
-- start so a customer whose browser dies mid-payment still has an order.
alter type order_status         add value 'awaiting_payment';
