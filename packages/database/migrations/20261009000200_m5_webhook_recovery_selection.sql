-- migrate:up
-- Selection is transport scheduling metadata, never a successful audit, ACK,
-- installation authority or permission to send/recreate a queue job.
ALTER TABLE shopify_webhook_deliveries ADD COLUMN queue_recovery_selected_at timestamptz
  CHECK (queue_recovery_selected_at IS NULL OR isfinite(queue_recovery_selected_at));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    GRANT UPDATE(queue_recovery_selected_at) ON shopify_webhook_deliveries TO insignia_queue_consume;
  END IF;
END $$;

-- migrate:down
-- Preserve committed selection progress; silently forgetting it restores the
-- starvation defect while pretending transport evidence has not changed.
LOCK TABLE inbox_messages IN ACCESS EXCLUSIVE MODE;
LOCK TABLE shopify_webhook_deliveries IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM shopify_webhook_deliveries WHERE queue_recovery_selected_at IS NOT NULL) THEN
    RAISE EXCEPTION 'durable webhook recovery selection evidence prevents rollback' USING ERRCODE='check_violation';
  END IF;
END $$;
ALTER TABLE shopify_webhook_deliveries DROP COLUMN queue_recovery_selected_at;
