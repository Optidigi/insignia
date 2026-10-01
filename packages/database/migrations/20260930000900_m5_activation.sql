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

-- Index-visible disposition keeps fallback lookup bounded even after a long
-- tail of resolved, abandoned requests. Activated historical rows remain visible.
ALTER TABLE publication_operations ADD COLUMN availability_resolved_at timestamptz;
CREATE INDEX m5_current_publication_visible_idx ON publication_operations
  (shop_id,config_id,installation_generation,operation_sequence DESC)
  WHERE availability_resolved_at IS NULL OR status='activated';

-- Separately reviewed observation-only operator dispositions. These never claim
-- that this process caused restoration and never rewrite activation evidence.
CREATE TABLE m5_availability_resolutions (
  shop_id text NOT NULL, config_id text NOT NULL, operation_id text NOT NULL,
  command_key text NOT NULL CHECK (command_key ~ '^[A-Za-z0-9_-]{1,128}$'),
  resolution_digest text NOT NULL CHECK (resolution_digest ~ '^[a-f0-9]{64}$'),
  resolution jsonb NOT NULL CHECK (jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v1'
    AND (resolution->>'outcome') IS NOT DISTINCT FROM 'ORIGINAL_STATE_OBSERVED'
    AND (resolution->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (resolution->>'configId') IS NOT DISTINCT FROM config_id
    AND (resolution->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (resolution->>'commandKey') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{currentScope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{originalHold,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{originalHold,before,scope,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{observed,productId}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,productId}')
    AND (resolution#>>'{observed,state}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,state}')
    AND (resolution#>>'{observed,visibilityDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,visibilityDigest}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v1'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id,config_id,operation_id), UNIQUE (shop_id,command_key),
  UNIQUE (shop_id,config_id,operation_id,resolution_digest),
  FOREIGN KEY (shop_id,config_id,operation_id) REFERENCES publication_operations(shop_id,config_id,operation_id)
);
CREATE TRIGGER m5_availability_resolution_immutable BEFORE UPDATE OR DELETE ON m5_availability_resolutions
  FOR EACH ROW EXECUTE FUNCTION reject_activation_evidence_mutation();

CREATE TABLE m5_activation_state (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  operation_id text NOT NULL,
  kind text NOT NULL DEFAULT 'WAITING_RELEASE' CHECK (kind IN
    ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING','RESTORED','RESOLVED','OPERATOR_HOLD')),
  hold jsonb,
  evidence_digest text,
  resolution_digest text,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, operation_id) REFERENCES publication_operations(shop_id, config_id, operation_id),
  FOREIGN KEY (shop_id, config_id, operation_id, evidence_digest)
    REFERENCES m5_activation_evidence(shop_id, config_id, operation_id, evidence_digest),
  FOREIGN KEY (shop_id,config_id,operation_id,resolution_digest) REFERENCES m5_availability_resolutions(shop_id,config_id,operation_id,resolution_digest),
  CHECK (kind <> 'RESOLVED' OR resolution_digest IS NOT NULL),
  CHECK (hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)),
  CHECK (kind NOT IN ('HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING') OR hold IS NOT NULL),
  CHECK (kind NOT IN ('RESTORATION_PENDING','RESTORED') OR evidence_digest IS NOT NULL)
);
CREATE INDEX m5_activation_unresolved_hold ON m5_activation_state(shop_id, config_id)
  WHERE hold IS NOT NULL AND kind NOT IN ('RESTORED','RESOLVED');
CREATE FUNCTION enforce_activation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.shop_id, NEW.config_id, NEW.operation_id) IS DISTINCT FROM (OLD.shop_id, OLD.config_id, OLD.operation_id)
    OR NEW.version <> OLD.version + 1
    OR (OLD.evidence_digest IS NOT NULL AND NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest)
    OR (OLD.hold IS NOT NULL AND (NEW.hold IS NULL OR NEW.hold->'before' IS DISTINCT FROM OLD.hold->'before'
      OR NEW.hold->>'operationId' IS DISTINCT FROM OLD.hold->>'operationId'
      OR NEW.hold->>'version' IS DISTINCT FROM OLD.hold->>'version'
      OR (OLD.hold->'held' <> 'null'::jsonb AND NEW.hold->'held' IS DISTINCT FROM OLD.hold->'held')))
    OR (OLD.resolution_digest IS NOT NULL AND NEW.resolution_digest IS DISTINCT FROM OLD.resolution_digest)
    OR (OLD.kind IN ('RESTORED','RESOLVED') AND NEW.kind <> OLD.kind)
    OR (OLD.kind='OPERATOR_HOLD' AND NEW.kind <> OLD.kind AND NOT (
      NEW.kind IN ('RESTORED','RESOLVED') AND NEW.resolution_digest IS NOT NULL AND EXISTS (
        SELECT 1 FROM m5_availability_resolutions r WHERE r.shop_id=OLD.shop_id AND r.config_id=OLD.config_id
          AND r.operation_id=OLD.operation_id AND r.resolution_digest=NEW.resolution_digest
          AND r.resolution->'originalHold' IS NOT DISTINCT FROM OLD.hold
          AND r.resolution->'activationEvidenceDigest' IS NOT DISTINCT FROM COALESCE(to_jsonb(OLD.evidence_digest),'null'::jsonb)
      ))) THEN
    RAISE EXCEPTION 'activation state identity, hold ownership or version changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> OLD.kind AND NOT (
    (OLD.kind IN ('WAITING_RELEASE','WAITING_HOLD') AND NEW.kind IN ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','HELD','RESTORED')) OR
    (OLD.kind = 'HOLD_INTENT' AND NEW.kind = 'ACQUISITION_PENDING') OR
    (OLD.kind = 'ACQUISITION_PENDING' AND NEW.kind = 'HELD') OR
    (OLD.kind = 'HELD' AND NEW.kind IN ('WAITING_RELEASE','RESTORATION_PENDING')) OR
    (OLD.kind = 'RESTORATION_PENDING' AND NEW.kind = 'RESTORED') OR
    (OLD.kind='OPERATOR_HOLD' AND NEW.kind IN ('RESTORED','RESOLVED') AND NEW.resolution_digest IS NOT NULL) OR
    NEW.kind = 'OPERATOR_HOLD'
  ) THEN RAISE EXCEPTION 'invalid activation state transition' USING ERRCODE = 'check_violation'; END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER m5_activation_state_guard BEFORE UPDATE ON m5_activation_state
  FOR EACH ROW EXECUTE FUNCTION enforce_activation_state();

-- Preserve the original transition guard for every historical field. A separate
-- guard permits only the one-time index disposition backed by an immutable
-- resolution and its resolved state; it cannot rewrite terminal history.
DROP TRIGGER publication_operations_transition_guard ON publication_operations;
CREATE TRIGGER publication_operations_transition_guard BEFORE UPDATE ON publication_operations
  FOR EACH ROW WHEN ((to_jsonb(OLD)-'availability_resolved_at') IS DISTINCT FROM
    (to_jsonb(NEW)-'availability_resolved_at')) EXECUTE FUNCTION enforce_publication_transition();
CREATE FUNCTION enforce_availability_resolution_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.availability_resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'availability disposition cannot precede publication' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.availability_resolved_at IS DISTINCT FROM OLD.availability_resolved_at AND (
    OLD.availability_resolved_at IS NOT NULL OR NEW.availability_resolved_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM m5_availability_resolutions r JOIN m5_activation_state s USING (shop_id,config_id,operation_id)
      WHERE r.shop_id=NEW.shop_id AND r.config_id=NEW.config_id AND r.operation_id=NEW.operation_id
        AND s.kind='RESOLVED' AND s.resolution_digest=r.resolution_digest
        AND (r.resolution->>'createdAt')::timestamptz=NEW.availability_resolved_at
    )
  ) THEN RAISE EXCEPTION 'availability disposition requires immutable resolved evidence' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_availability_marker_guard BEFORE INSERT OR UPDATE ON publication_operations
  FOR EACH ROW EXECUTE FUNCTION enforce_availability_resolution_marker();
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
DROP TRIGGER publication_availability_marker_guard ON publication_operations;
DROP FUNCTION enforce_availability_resolution_marker();
DROP TRIGGER publication_operations_transition_guard ON publication_operations;
CREATE TRIGGER publication_operations_transition_guard BEFORE UPDATE ON publication_operations
  FOR EACH ROW EXECUTE FUNCTION enforce_publication_transition();
DROP INDEX m5_current_publication_visible_idx;
ALTER TABLE publication_operations DROP COLUMN availability_resolved_at;
DROP TRIGGER m5_activation_binding_guard ON m4_publication_progress;
DROP FUNCTION enforce_m5_activation_binding();
DROP TABLE m5_activation_state;
DROP FUNCTION enforce_activation_state();
DROP TABLE m5_availability_resolutions;
DROP TABLE m5_activation_evidence;
DROP FUNCTION reject_activation_evidence_mutation();
