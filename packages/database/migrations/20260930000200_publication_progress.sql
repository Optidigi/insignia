-- migrate:up
-- M3 publication_operations remains the immutable intent/outbox authority. This
-- companion row records crash-restart progress without reusing M3's activation flag.
CREATE TABLE m4_publication_progress (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  operation_id text NOT NULL,
  phase text NOT NULL DEFAULT 'prepared' CHECK (phase IN
    ('prepared', 'shop-config-written', 'pending-written', 'policy-written', 'ready-written',
     'activation-pending', 'conflict', 'operator-hold', 'active')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  mode text NOT NULL CHECK (mode IN ('required', 'optional')),
  prior_registration_digest text CHECK (prior_registration_digest ~ '^[a-f0-9]{64}$'),
  prior_policy_digest text CHECK (prior_policy_digest ~ '^[a-f0-9]{64}$'),
  prior_public_config_digest text CHECK (prior_public_config_digest ~ '^[a-f0-9]{64}$'),
  prior_mode text CHECK (prior_mode IN ('required', 'optional')),
  last_observed jsonb,
  last_observed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  activation_evidence text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, operation_id)
    REFERENCES publication_operations(shop_id, config_id, operation_id),
  CHECK (phase <> 'active' OR activation_evidence IS NOT NULL)
);

CREATE FUNCTION enforce_m4_publication_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.shop_id, NEW.config_id, NEW.operation_id, NEW.mode,
      NEW.prior_registration_digest, NEW.prior_policy_digest, NEW.prior_public_config_digest, NEW.prior_mode)
     IS DISTINCT FROM
     (OLD.shop_id, OLD.config_id, OLD.operation_id, OLD.mode,
      OLD.prior_registration_digest, OLD.prior_policy_digest, OLD.prior_public_config_digest, OLD.prior_mode) THEN
    RAISE EXCEPTION 'publication progress identity and prior state are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'publication progress version must advance by one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.phase IN ('conflict', 'operator-hold', 'active') AND NEW.phase <> OLD.phase THEN
    RAISE EXCEPTION 'terminal publication progress cannot advance'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.phase <> OLD.phase AND NOT (
    (OLD.phase = 'prepared' AND NEW.phase = 'shop-config-written') OR
    (OLD.phase = 'shop-config-written' AND NEW.phase = 'pending-written') OR
    (OLD.phase = 'pending-written' AND NEW.phase = 'policy-written') OR
    (OLD.phase = 'policy-written' AND NEW.phase = 'ready-written') OR
    (OLD.phase = 'ready-written' AND NEW.phase IN ('activation-pending', 'active')) OR
    (OLD.phase = 'activation-pending' AND NEW.phase = 'active') OR
    NEW.phase IN ('conflict', 'operator-hold')
  ) THEN
    RAISE EXCEPTION 'invalid publication progress transition' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER m4_publication_progress_guard BEFORE UPDATE ON m4_publication_progress
  FOR EACH ROW EXECUTE FUNCTION enforce_m4_publication_progress();

-- migrate:down
DROP TRIGGER m4_publication_progress_guard ON m4_publication_progress;
DROP FUNCTION enforce_m4_publication_progress();
DROP TABLE m4_publication_progress;
