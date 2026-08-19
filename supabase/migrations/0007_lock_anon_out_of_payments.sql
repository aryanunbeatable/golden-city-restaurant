-- Phone orders, part 3 of 3: stop the public anon key from writing money.
--
-- DO NOT RUN THIS UNTIL the manager's settle/void writes have been moved to
-- server actions — otherwise settling a payment from the counter starts
-- failing. It is deliberately a separate migration for that reason.
--
-- Until now `orders_staff_update` was `for update using (true)`, so anyone
-- holding the public anon key could update any column of any order, including
-- payment_status. That was survivable when payment was a note typed at the
-- counter; with a real gateway it is a way to eat for free.
--
-- Postgres has no column-level RLS, but GRANT is column-aware. anon keeps the
-- kitchen's status transitions — accept, mark ready, served, void — and loses
-- everything else. Manager settlement and the Razorpay webhook run server-side
-- with the service-role key, which bypasses both RLS and these grants.

revoke update on public.orders from anon;
grant  update (status) on public.orders to anon;
