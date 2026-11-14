-- migrate:up
-- #474: per-kind failure bookkeeping for the host inspector's artwork cleanup (spec §11).
-- cleanup_* covers the deletion/tombstone sweep; quarantine_cleanup_* covers a USABLE row's quarantine key.
-- *_attempts counts consecutive attempts since the last success (a success resets it to 0) and drives the
-- exponential backoff; *_failure is the last failure code (bounded vocabulary, no keys or personal data);
-- *_review_at is set at the 12th consecutive failure and cleared by a success. Constant defaults: no rewrite.
ALTER TABLE public.artwork_assets
  ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN cleanup_failure text,
  ADD COLUMN cleanup_review_at timestamptz,
  ADD COLUMN quarantine_cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN quarantine_cleanup_failure text,
  ADD COLUMN quarantine_cleanup_review_at timestamptz,
  ADD CONSTRAINT artwork_cleanup_attempts_check CHECK (cleanup_attempts >= 0 AND quarantine_cleanup_attempts >= 0),
  ADD CONSTRAINT artwork_cleanup_failure_check CHECK (
    (cleanup_failure IS NULL OR cleanup_failure IN ('STORAGE_UNAVAILABLE','STATE_UNAVAILABLE')) AND
    (quarantine_cleanup_failure IS NULL OR quarantine_cleanup_failure IN ('STORAGE_UNAVAILABLE','STATE_UNAVAILABLE')));
-- Rows needing review are few; the inspector counts them every sweep for its gauge.
CREATE INDEX artwork_cleanup_review ON public.artwork_assets(asset_id)
  WHERE cleanup_review_at IS NOT NULL OR quarantine_cleanup_review_at IS NOT NULL;

-- migrate:down
DROP INDEX public.artwork_cleanup_review;
ALTER TABLE public.artwork_assets
  DROP CONSTRAINT artwork_cleanup_failure_check,
  DROP CONSTRAINT artwork_cleanup_attempts_check,
  DROP COLUMN quarantine_cleanup_review_at,
  DROP COLUMN quarantine_cleanup_failure,
  DROP COLUMN quarantine_cleanup_attempts,
  DROP COLUMN cleanup_review_at,
  DROP COLUMN cleanup_failure,
  DROP COLUMN cleanup_attempts;
