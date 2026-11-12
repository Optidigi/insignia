-- migrate:up
-- #374, step 1 of 2 (owner decision, 12 November 2026: no rollback to a web image from before #348).
-- The next web image stops writing the legacy issued count. It may write a row only once the count
-- is optional; web image bf512171 still writes it and keeps working. Apply before replacing web.
ALTER TABLE buyer_visitor_admission ALTER COLUMN issued DROP NOT NULL;
-- migrate:down
UPDATE buyer_visitor_admission SET issued=GREATEST(cardinality(issued_at),1) WHERE issued IS NULL;
ALTER TABLE buyer_visitor_admission ALTER COLUMN issued SET NOT NULL;
