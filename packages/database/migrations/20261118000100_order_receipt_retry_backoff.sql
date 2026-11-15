-- migrate:up
-- #491: a failed order receipt (orders/create, orders/paid, orders/updated, refunds/create) waits before
-- its next automated attempt (spec §11: from 5 seconds doubling to a 15-minute cap, 12 attempts).
-- NULL means due now: pending receipts and receipts failed before this migration. Nullable without a
-- default: no table rewrite. Running images ignore the column.
ALTER TABLE public.inbox_messages ADD COLUMN next_attempt_at timestamptz;

-- migrate:down
ALTER TABLE public.inbox_messages DROP COLUMN next_attempt_at;
