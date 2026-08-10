-- Adds a terminal 'served' status so the kitchen board can drop a ready
-- order off-screen once staff physically deliver it.
-- Apply with: supabase db push   (or paste into the SQL editor)

-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value, but is safe on its own.
alter type order_status add value 'served';
