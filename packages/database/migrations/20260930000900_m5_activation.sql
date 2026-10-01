-- migrate:up
CREATE TABLE m5_activation_evidence (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  operation_id text NOT NULL,
  revision_id text NOT NULL,
  installation_generation bigint NOT NULL,
  operation_sequence bigint NOT NULL CHECK (operation_sequence > 0),
  authorization_generation uuid NOT NULL,
  authorization_epoch bigint NOT NULL CHECK (authorization_epoch BETWEEN 0 AND 4294967295),
  selected_key_id integer NOT NULL CHECK (selected_key_id BETWEEN 1 AND 65535),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, config_id, operation_id),
  CHECK ((evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK (COALESCE((evidence->>'admissionClass') IN ('FIRST_PUBLICATION','MODE_CHANGE','SAME_MODE'), false)
    AND COALESCE((evidence->>'revisionHash') ~ '^[a-f0-9]{64}$', false)
    AND COALESCE((evidence->>'desiredProjectionDigest') ~ '^[a-f0-9]{64}$', false)
    AND (evidence->>'observedProjectionDigest') IS NOT DISTINCT FROM (evidence->>'desiredProjectionDigest')
    AND COALESCE((evidence->>'artifactEvidenceDigest') ~ '^[a-f0-9]{64}$', false)
    AND COALESCE((evidence->>'functionObservationDigest') ~ '^[a-f0-9]{64}$', false)
    AND COALESCE(length(evidence->>'artifactEvidenceRef') > 0, false)
    AND COALESCE(jsonb_typeof(evidence->'functionObservation') = 'object', false)
    AND COALESCE(length(evidence->>'createdAt') > 0 AND length(evidence->>'projectionObservedAt') > 0, false)
    AND ((evidence->>'admissionClass' = 'SAME_MODE' AND evidence->'hold' = 'null'::jsonb AND evidence->'holdObservation' = 'null'::jsonb)
      OR (evidence->>'admissionClass' <> 'SAME_MODE' AND jsonb_typeof(evidence->'hold') = 'object'
        AND jsonb_typeof(evidence->'holdObservation') = 'object'))),
  UNIQUE (shop_id, config_id, operation_id, evidence_digest),
  FOREIGN KEY (shop_id, config_id, operation_id) REFERENCES publication_operations(shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, revision_id) REFERENCES config_revisions(shop_id, config_id, revision_id),
  FOREIGN KEY (shop_id, installation_generation, selected_key_id) REFERENCES signing_keys(shop_id, installation_generation, key_id)
);
CREATE FUNCTION reject_activation_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activation evidence is immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER m5_activation_evidence_immutable BEFORE UPDATE OR DELETE ON m5_activation_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_activation_evidence_mutation();

CREATE TABLE m5_activation_state (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  operation_id text NOT NULL,
  kind text NOT NULL DEFAULT 'WAITING_RELEASE' CHECK (kind IN
    ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING','RESTORED','OPERATOR_HOLD')),
  hold jsonb,
  evidence_digest text,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, operation_id) REFERENCES publication_operations(shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, operation_id, evidence_digest)
    REFERENCES m5_activation_evidence(shop_id, config_id, operation_id, evidence_digest),
  CHECK (hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)),
  CHECK (kind NOT IN ('HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING') OR hold IS NOT NULL),
  CHECK (kind NOT IN ('RESTORATION_PENDING','RESTORED') OR evidence_digest IS NOT NULL)
);
CREATE INDEX m5_activation_unresolved_hold ON m5_activation_state(shop_id, config_id)
  WHERE hold IS NOT NULL AND kind <> 'RESTORED';
CREATE FUNCTION enforce_activation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.shop_id, NEW.config_id, NEW.operation_id) IS DISTINCT FROM (OLD.shop_id, OLD.config_id, OLD.operation_id)
    OR NEW.version <> OLD.version + 1
    OR (OLD.evidence_digest IS NOT NULL AND NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest)
    OR (OLD.hold IS NOT NULL AND (NEW.hold IS NULL OR NEW.hold->'before' IS DISTINCT FROM OLD.hold->'before'
      OR NEW.hold->>'operationId' IS DISTINCT FROM OLD.hold->>'operationId'
      OR NEW.hold->>'version' IS DISTINCT FROM OLD.hold->>'version'
      OR (OLD.hold->'held' <> 'null'::jsonb AND NEW.hold->'held' IS DISTINCT FROM OLD.hold->'held')))
    OR (OLD.kind IN ('RESTORED','OPERATOR_HOLD') AND NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'activation state identity, hold ownership or version changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> OLD.kind AND NOT (
    (OLD.kind IN ('WAITING_RELEASE','WAITING_HOLD') AND NEW.kind IN ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','HELD','RESTORED')) OR
    (OLD.kind = 'HOLD_INTENT' AND NEW.kind = 'ACQUISITION_PENDING') OR
    (OLD.kind = 'ACQUISITION_PENDING' AND NEW.kind = 'HELD') OR
    (OLD.kind = 'HELD' AND NEW.kind IN ('WAITING_RELEASE','RESTORATION_PENDING')) OR
    (OLD.kind = 'RESTORATION_PENDING' AND NEW.kind = 'RESTORED') OR
    NEW.kind = 'OPERATOR_HOLD'
  ) THEN RAISE EXCEPTION 'invalid activation state transition' USING ERRCODE = 'check_violation'; END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER m5_activation_state_guard BEFORE UPDATE ON m5_activation_state
  FOR EACH ROW EXECUTE FUNCTION enforce_activation_state();
-- Require real versioned evidence for M5-owned decisions. Historical M3/M4 fixtures
-- remain internal; no lower-level activation operation is added to the public facade.
CREATE FUNCTION enforce_m5_activation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'active' AND OLD.phase <> 'active' AND EXISTS (
    SELECT 1 FROM m5_activation_state WHERE shop_id=NEW.shop_id AND config_id=NEW.config_id AND operation_id=NEW.operation_id
  ) AND NOT EXISTS (
    SELECT 1 FROM m5_activation_evidence e JOIN publication_operations o USING (shop_id, config_id, operation_id)
    JOIN installation_generations i ON i.shop_id=o.shop_id AND i.generation=o.installation_generation
    JOIN product_configs c ON c.shop_id=o.shop_id AND c.config_id=o.config_id
    WHERE e.shop_id=NEW.shop_id AND e.config_id=NEW.config_id AND e.operation_id=NEW.operation_id
      AND e.evidence_digest=NEW.activation_evidence AND e.revision_id=o.revision_id
      AND e.operation_sequence=o.operation_sequence AND e.operation_sequence=c.publication_sequence
      AND e.installation_generation=o.installation_generation AND e.authorization_generation=i.authorization_generation
      AND e.authorization_epoch=i.authorization_epoch
  ) THEN RAISE EXCEPTION 'M5 activation evidence binding missing' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER m5_activation_binding_guard BEFORE UPDATE ON m4_publication_progress
  FOR EACH ROW EXECUTE FUNCTION enforce_m5_activation_binding();

-- migrate:down
DROP TRIGGER m5_activation_binding_guard ON m4_publication_progress;
DROP FUNCTION enforce_m5_activation_binding();
DROP TABLE m5_activation_state;
DROP FUNCTION enforce_activation_state();
DROP TABLE m5_activation_evidence;
DROP FUNCTION reject_activation_evidence_mutation();
