-- migrate:up
-- #374, step 2 of 2: drop the legacy issued count once every web instance runs an image that no
-- longer writes it. The sliding window lives only in issued_at; the column's check and its web
-- UPDATE privilege go with it. Web images before this step (bf512171 and older) cannot run after it.
ALTER TABLE buyer_visitor_admission DROP COLUMN issued;
-- migrate:down
-- Only restores the shape migration 60 expects; the count is rebuilt from issued_at.
ALTER TABLE buyer_visitor_admission ADD COLUMN issued integer CONSTRAINT buyer_visitor_admission_issued_check CHECK(issued >= 1);
UPDATE buyer_visitor_admission SET issued=GREATEST(cardinality(issued_at),1);
