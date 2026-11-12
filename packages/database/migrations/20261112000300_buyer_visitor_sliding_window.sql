-- migrate:up
-- Owner decision, 12 November 2026 (#348): the per-visitor session limit is a sliding hour, not a
-- fixed window opened by the first session. Each row keeps the issue times of the sessions still
-- inside the last hour; the limit itself lives only in BUYER_SESSION_POLICY.
-- window_at now records the latest issue, so the existing hourly purge removes a row only once
-- none of its sessions counts. issued mirrors the array length for web images from before this
-- change, which still write the old columns during a rolling deploy.
ALTER TABLE buyer_visitor_admission ADD COLUMN issued_at timestamptz[] NOT NULL DEFAULT '{}';
-- Existing windows keep their sessions until the hour the fixed window would have ended.
UPDATE buyer_visitor_admission SET issued_at=array_fill(window_at, ARRAY[issued]);
ALTER TABLE buyer_visitor_admission DROP CONSTRAINT buyer_visitor_admission_issued_check,
 ADD CONSTRAINT buyer_visitor_admission_issued_check CHECK(issued >= 1);
-- migrate:down
UPDATE buyer_visitor_admission SET issued=20 WHERE issued > 20;
ALTER TABLE buyer_visitor_admission DROP CONSTRAINT buyer_visitor_admission_issued_check,
 ADD CONSTRAINT buyer_visitor_admission_issued_check CHECK(issued BETWEEN 1 AND 20),
 DROP COLUMN issued_at;
