-- migrate:up
CREATE INDEX idempotency_records_m5_publish_result_ref_idx
  ON idempotency_records (shop_id, result_ref)
  WHERE namespace = 'm5-publish-config' AND status = 'completed';

-- migrate:down
DROP INDEX idempotency_records_m5_publish_result_ref_idx;
