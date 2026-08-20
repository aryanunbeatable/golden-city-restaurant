-- Headcount for scheduled dine-in phone orders.
-- Apply with: supabase db push   (or paste into the SQL editor)
--
-- No table is reserved in advance, so this is advisory rather than a booking —
-- but a dine-in order arriving at 8pm is very different to plan for at 2 heads
-- than at 9. Takeaway never carries it.

alter table public.orders add column party_size int;

alter table public.orders add constraint orders_party_size_ck check (
  (service_type = 'dine_in' and party_size is not null and party_size between 1 and 30)
  or
  (service_type is distinct from 'dine_in' and party_size is null)
);
