-- migrate:up
-- Add a truthful non-metered marker for new recurring-only quotes; existing facts remain unchanged.
ALTER TABLE accepted_quotes DROP CONSTRAINT accepted_quotes_qualifying_usage_disposition_check;
ALTER TABLE accepted_quotes ADD CONSTRAINT accepted_quotes_qualifying_usage_disposition_check
  CHECK (qualifying_usage_disposition IN ('WAIVE_TRIAL', 'REQUIRES_EVENT_TIME', 'NOT_METERED'));

-- migrate:down
-- A schema rollback cannot discard or relabel immutable recurring-only accepted offers.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM accepted_quotes WHERE qualifying_usage_disposition = 'NOT_METERED') THEN
    RAISE EXCEPTION 'retained_non_metered_quotes_require_forward_compatible_reader';
  END IF;
END $$;
ALTER TABLE accepted_quotes DROP CONSTRAINT accepted_quotes_qualifying_usage_disposition_check;
ALTER TABLE accepted_quotes ADD CONSTRAINT accepted_quotes_qualifying_usage_disposition_check
  CHECK (qualifying_usage_disposition IN ('WAIVE_TRIAL', 'REQUIRES_EVENT_TIME'));
