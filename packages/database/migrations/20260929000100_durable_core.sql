-- migrate:up
CREATE TABLE shops (
  shop_id text PRIMARY KEY CHECK (shop_id <> ''),
  shop_domain text NOT NULL UNIQUE CHECK (shop_domain = lower(shop_domain) AND shop_domain <> ''),
  current_generation bigint NOT NULL DEFAULT 0 CHECK (current_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installation_generations (
  shop_id text NOT NULL REFERENCES shops(shop_id),
  generation bigint NOT NULL CHECK (generation > 0),
  external_installation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  PRIMARY KEY (shop_id, generation),
  CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);
ALTER TABLE shops ADD CONSTRAINT shops_current_installation_fk
  FOREIGN KEY (shop_id, current_generation) REFERENCES installation_generations(shop_id, generation)
  DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION enforce_generation_increase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_generation <> OLD.current_generation AND
     NEW.current_generation <> OLD.current_generation + 1 THEN
    RAISE EXCEPTION 'installation generation must increase by one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shops_generation_guard BEFORE UPDATE ON shops
  FOR EACH ROW EXECUTE FUNCTION enforce_generation_increase();

CREATE TABLE product_configs (
  shop_id text NOT NULL REFERENCES shops(shop_id),
  config_id text NOT NULL CHECK (config_id <> ''),
  external_product_id text NOT NULL CHECK (external_product_id <> ''),
  draft_schema_version text NOT NULL CHECK (draft_schema_version <> ''),
  draft_value jsonb NOT NULL,
  draft_version bigint NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  publication_sequence bigint NOT NULL DEFAULT 0 CHECK (publication_sequence >= 0),
  effective_revision_id text,
  effective_operation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, config_id),
  UNIQUE (shop_id, external_product_id),
  CHECK ((effective_revision_id IS NULL) = (effective_operation_id IS NULL))
);

CREATE TABLE config_revisions (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  revision_id text NOT NULL CHECK (revision_id <> ''),
  schema_version text NOT NULL CHECK (schema_version <> ''),
  published_value jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_ref text,
  PRIMARY KEY (shop_id, revision_id),
  UNIQUE (shop_id, config_id, revision_id),
  FOREIGN KEY (shop_id, config_id) REFERENCES product_configs(shop_id, config_id)
);
ALTER TABLE product_configs ADD CONSTRAINT product_configs_effective_revision_fk
  FOREIGN KEY (shop_id, config_id, effective_revision_id)
  REFERENCES config_revisions(shop_id, config_id, revision_id);

CREATE FUNCTION reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'config revisions are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER config_revisions_immutable BEFORE UPDATE OR DELETE ON config_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();

CREATE TABLE publication_operations (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  operation_id text NOT NULL CHECK (operation_id <> ''),
  revision_id text NOT NULL,
  installation_generation bigint NOT NULL,
  operation_sequence bigint NOT NULL CHECK (operation_sequence > 0),
  expected_projection jsonb NOT NULL,
  expected_projection_digest text NOT NULL CHECK (expected_projection_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'acknowledged', 'observed', 'activated', 'failed', 'superseded')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  observed_at timestamptz,
  observed_projection jsonb,
  observed_projection_digest text CHECK (observed_projection_digest IS NULL OR observed_projection_digest ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz,
  failed_at timestamptz,
  failure_class text,
  superseded_at timestamptz,
  PRIMARY KEY (shop_id, operation_id),
  UNIQUE (shop_id, config_id, operation_id),
  UNIQUE (shop_id, config_id, operation_sequence),
  FOREIGN KEY (shop_id, config_id) REFERENCES product_configs(shop_id, config_id),
  FOREIGN KEY (shop_id, config_id, revision_id) REFERENCES config_revisions(shop_id, config_id, revision_id),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation),
  CHECK ((observed_at IS NULL) = (observed_projection IS NULL)),
  CHECK ((observed_at IS NULL) = (observed_projection_digest IS NULL)),
  CHECK (status <> 'activated' OR (activated_at IS NOT NULL AND observed_at IS NOT NULL AND acknowledged_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status <> 'superseded' OR superseded_at IS NOT NULL)
);
ALTER TABLE product_configs ADD CONSTRAINT product_configs_effective_operation_fk
  FOREIGN KEY (shop_id, config_id, effective_operation_id)
  REFERENCES publication_operations(shop_id, config_id, operation_id);

CREATE FUNCTION enforce_effective_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op publication_operations%ROWTYPE;
DECLARE current_installation bigint;
BEGIN
  IF NEW.publication_sequence < OLD.publication_sequence THEN
    RAISE EXCEPTION 'publication sequence cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.effective_revision_id, OLD.effective_operation_id)
     IS DISTINCT FROM (NEW.effective_revision_id, NEW.effective_operation_id) THEN
    SELECT current_generation INTO current_installation FROM shops WHERE shop_id = NEW.shop_id;
    IF NEW.effective_revision_id IS NULL AND NEW.effective_operation_id IS NULL AND
       OLD.effective_operation_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM publication_operations old_op
         WHERE old_op.shop_id = NEW.shop_id AND old_op.config_id = NEW.config_id
           AND old_op.operation_id = OLD.effective_operation_id
           AND old_op.installation_generation <> current_installation
       ) THEN
      RETURN NEW;
    END IF;
    SELECT * INTO op FROM publication_operations
      WHERE shop_id = NEW.shop_id AND config_id = NEW.config_id
        AND operation_id = NEW.effective_operation_id;
    IF NOT FOUND OR NEW.effective_revision_id IS DISTINCT FROM op.revision_id
       OR op.status <> 'activated'
       OR op.installation_generation <> current_installation
       OR op.operation_sequence <> NEW.publication_sequence
       OR op.observed_projection IS DISTINCT FROM op.expected_projection
       OR op.observed_projection_digest IS DISTINCT FROM op.expected_projection_digest THEN
      RAISE EXCEPTION 'publication activation preconditions not met' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_configs_effective_guard BEFORE UPDATE ON product_configs
  FOR EACH ROW EXECUTE FUNCTION enforce_effective_activation();

CREATE FUNCTION enforce_publication_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.shop_id, OLD.config_id, OLD.operation_id, OLD.revision_id,
      OLD.installation_generation, OLD.operation_sequence, OLD.expected_projection,
      OLD.expected_projection_digest, OLD.requested_at)
     IS DISTINCT FROM
     (NEW.shop_id, NEW.config_id, NEW.operation_id, NEW.revision_id,
      NEW.installation_generation, NEW.operation_sequence, NEW.expected_projection,
      NEW.expected_projection_digest, NEW.requested_at) THEN
    RAISE EXCEPTION 'publication identity and expected projection are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('activated', 'failed', 'superseded') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal publication operation is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'requested' AND NEW.status IN ('acknowledged', 'failed', 'superseded')) OR
      (OLD.status = 'acknowledged' AND NEW.status IN ('observed', 'failed', 'superseded')) OR
      (OLD.status = 'observed' AND NEW.status IN ('activated', 'failed', 'superseded'))
    ) THEN
    RAISE EXCEPTION 'invalid publication transition' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'activated' AND OLD.status <> 'activated' AND (
      NEW.observed_projection IS DISTINCT FROM NEW.expected_projection OR
      NEW.observed_projection_digest IS DISTINCT FROM NEW.expected_projection_digest OR
      NEW.operation_sequence <> (SELECT publication_sequence FROM product_configs
        WHERE shop_id = NEW.shop_id AND config_id = NEW.config_id) OR
      NEW.installation_generation <> (SELECT current_generation FROM shops WHERE shop_id = NEW.shop_id)
    ) THEN
    RAISE EXCEPTION 'publication activation preconditions not met' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_operations_transition_guard BEFORE UPDATE ON publication_operations
  FOR EACH ROW EXECUTE FUNCTION enforce_publication_transition();

CREATE TABLE idempotency_records (
  shop_id text NOT NULL REFERENCES shops(shop_id),
  namespace text NOT NULL CHECK (namespace <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  result_ref text,
  failure_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (shop_id, namespace, idempotency_key),
  CHECK (status <> 'completed' OR (result_ref IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'failed' OR (failure_class IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE inbox_messages (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source <> ''),
  external_delivery_id text,
  shop_id text REFERENCES shops(shop_id),
  installation_generation bigint,
  payload bytea NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_class text,
  lease_owner text,
  lease_until timestamptz,
  retention_class text NOT NULL CHECK (retention_class <> ''),
  purge_after timestamptz,
  erasure_state text NOT NULL DEFAULT 'retained' CHECK (erasure_state IN ('retained', 'pending', 'erased')),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation),
  CHECK (installation_generation IS NULL OR shop_id IS NOT NULL),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK (octet_length(payload) <= 8388608),
  CHECK (purge_after IS NOT NULL AND purge_after > collected_at AND purge_after <= collected_at + interval '180 days')
);
CREATE UNIQUE INDEX inbox_tenant_delivery_unique ON inbox_messages(shop_id, installation_generation, source, external_delivery_id) NULLS NOT DISTINCT
  WHERE shop_id IS NOT NULL AND external_delivery_id IS NOT NULL;
CREATE UNIQUE INDEX inbox_unresolved_delivery_unique ON inbox_messages(source, external_delivery_id)
  WHERE shop_id IS NULL AND external_delivery_id IS NOT NULL;
CREATE INDEX inbox_claimable_idx ON inbox_messages(state, lease_until, received_at);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops(shop_id),
  installation_generation bigint,
  event_type text NOT NULL CHECK (event_type <> ''),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  aggregate_ref text NOT NULL CHECK (aggregate_ref <> ''),
  payload jsonb NOT NULL,
  business_key text,
  occurred_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_class text,
  lease_owner text,
  lease_until timestamptz,
  retention_class text NOT NULL CHECK (retention_class <> ''),
  purge_after timestamptz,
  erasure_state text NOT NULL DEFAULT 'retained' CHECK (erasure_state IN ('retained', 'pending', 'erased')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK (octet_length(payload::text) <= 8388608),
  CHECK (purge_after IS NOT NULL AND purge_after > collected_at AND purge_after <= collected_at + interval '180 days')
);
CREATE UNIQUE INDEX outbox_business_key_unique ON outbox_events(shop_id, event_type, business_key)
  WHERE business_key IS NOT NULL;
CREATE INDEX outbox_claimable_idx ON outbox_events(shop_id, state, available_at, lease_until);

CREATE FUNCTION enforce_payload_collection_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.collected_at := clock_timestamp();
  ELSIF NEW.collected_at IS DISTINCT FROM OLD.collected_at THEN
    RAISE EXCEPTION 'payload collection time is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inbox_collection_guard BEFORE INSERT OR UPDATE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION enforce_payload_collection_time();
CREATE TRIGGER outbox_collection_guard BEFORE INSERT OR UPDATE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION enforce_payload_collection_time();

-- migrate:down
DROP TABLE outbox_events;
DROP TABLE inbox_messages;
DROP FUNCTION enforce_payload_collection_time();
DROP TABLE idempotency_records;
DROP TRIGGER product_configs_effective_guard ON product_configs;
DROP FUNCTION enforce_effective_activation();
DROP TRIGGER publication_operations_transition_guard ON publication_operations;
DROP FUNCTION enforce_publication_transition();
ALTER TABLE product_configs DROP CONSTRAINT product_configs_effective_operation_fk;
DROP TABLE publication_operations;
ALTER TABLE product_configs DROP CONSTRAINT product_configs_effective_revision_fk;
DROP TRIGGER config_revisions_immutable ON config_revisions;
DROP FUNCTION reject_revision_mutation();
DROP TABLE config_revisions;
DROP TABLE product_configs;
ALTER TABLE shops DROP CONSTRAINT shops_current_installation_fk;
DROP TRIGGER shops_generation_guard ON shops;
DROP FUNCTION enforce_generation_increase();
DROP TABLE installation_generations;
DROP TABLE shops;
