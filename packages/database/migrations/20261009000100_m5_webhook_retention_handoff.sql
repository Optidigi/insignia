-- migrate:up
-- Existing rows have no durable queue acknowledgement evidence. Do not infer
-- that a missing historical job is permission to create another retry budget.
ALTER TABLE shopify_webhook_deliveries
  ADD COLUMN queue_handoff_state text NOT NULL DEFAULT 'unknown'
    CHECK (queue_handoff_state IN ('unknown', 'unconfirmed', 'confirmed', 'exhausted')),
  ADD COLUMN queue_cleanup_pending boolean NOT NULL DEFAULT false;
ALTER TABLE shopify_webhook_deliveries ALTER COLUMN queue_handoff_state SET DEFAULT 'unconfirmed';
CREATE INDEX shopify_webhook_queue_cleanup ON shopify_webhook_deliveries(inbox_id) WHERE queue_cleanup_pending;
CREATE INDEX shopify_webhook_payload_expiry ON inbox_messages(purge_after,id)
  WHERE source='shopify' AND retention_class='shopify-webhook' AND erasure_state <> 'erased';

-- migrate:down
LOCK TABLE shopify_webhook_deliveries IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  -- Unknown includes committed send reservations and historical ambiguity.
  -- No populated delivery may lose its durable budget/exclusion metadata.
  IF EXISTS(SELECT 1 FROM shopify_webhook_deliveries) THEN
    RAISE EXCEPTION 'durable webhook queue evidence prevents rollback' USING ERRCODE='check_violation';
  END IF;
END $$;
DROP INDEX shopify_webhook_payload_expiry;
DROP INDEX shopify_webhook_queue_cleanup;
ALTER TABLE shopify_webhook_deliveries DROP COLUMN queue_handoff_state, DROP COLUMN queue_cleanup_pending;
