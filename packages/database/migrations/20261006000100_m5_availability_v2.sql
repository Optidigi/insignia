-- migrate:up
-- Add version branches only. Existing v1 JSONB is never transformed or reinterpreted.
-- Original v1 predicates are preserved, with explicit version fences preventing cross-version interpretation.
DO $$ DECLARE item record; removed integer:=0; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='m5_activation_evidence'::regclass AND contype='c' AND (position('m5-activation-evidence-v1' in pg_get_constraintdef(oid))>0 OR position('decisionVersion' in pg_get_constraintdef(oid))>0) LOOP
  EXECUTE format('ALTER TABLE m5_activation_evidence DROP CONSTRAINT %I',item.conname); removed:=removed+1;
 END LOOP;
 IF removed<>2 THEN RAISE EXCEPTION 'Unexpected m5_activation_evidence v1 constraint baseline'; END IF;
END $$;
DO $$ DECLARE item record; removed integer:=0; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='m5_activation_state'::regclass AND contype='c' AND (position('m5-availability-hold-v1' in pg_get_constraintdef(oid))>0) LOOP
  EXECUTE format('ALTER TABLE m5_activation_state DROP CONSTRAINT %I',item.conname); removed:=removed+1;
 END LOOP;
 IF removed<>1 THEN RAISE EXCEPTION 'Unexpected m5_activation_state v1 constraint baseline'; END IF;
END $$;
DO $$ DECLARE item record; removed integer:=0; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='m5_availability_resolutions'::regclass AND contype='c' AND (position('m5-availability-resolution-v1' in pg_get_constraintdef(oid))>0) LOOP
  EXECUTE format('ALTER TABLE m5_availability_resolutions DROP CONSTRAINT %I',item.conname); removed:=removed+1;
 END LOOP;
 IF removed<>1 THEN RAISE EXCEPTION 'Unexpected m5_availability_resolutions v1 constraint baseline'; END IF;
END $$;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_version CHECK ((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1') OR COALESCE((jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2'),false));
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_identity CHECK (((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1' AND (evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '1'::jsonb) OR COALESCE(((evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v2' AND ((evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '2'::jsonb)),false));
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_014_hold_version CHECK ((hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)) OR COALESCE((hold IS NULL OR (((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id)
    AND (hold#>>'{before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND COALESCE((hold#>>'{before,intentDigest}') ~ '^[a-f0-9]{64}$',false)
    AND COALESCE((hold#>>'{before,effectiveDigest}') ~ '^[a-f0-9]{64}$',false)
    AND jsonb_typeof(hold#>'{before,configuredIntent,includedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,publicationSettings}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,configuredIntent,scheduled}') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(hold#>'{before,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM 'array'
    AND (hold->'held'='null'::jsonb OR (jsonb_typeof(hold->'held')='object'
      AND (hold#>>'{held,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
      AND (hold#>'{held,scope}') IS NOT DISTINCT FROM (hold#>'{before,scope}')
      AND (hold#>>'{held,productId}') IS NOT DISTINCT FROM (hold#>>'{before,productId}')
      AND (hold#>>'{held,state}') IS NOT DISTINCT FROM 'unavailable'
      AND (hold#>'{held,configuredIntent}') IS NOT DISTINCT FROM (hold#>'{before,configuredIntent}')
      AND (hold#>>'{held,intentDigest}') IS NOT DISTINCT FROM (hold#>>'{before,intentDigest}')
      AND (hold#>'{held,effectiveVisibility,publishedPublicationIds}')='[]'::jsonb
      AND (hold#>'{held,effectiveVisibility,onlineStore}')='{"publishedAtPresent":false,"urlPresent":false}'::jsonb)))),false));
ALTER TABLE m5_availability_resolutions ADD CONSTRAINT m5_014_resolution_version CHECK ((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v1'
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
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
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key) OR COALESCE((jsonb_typeof(resolution)='object'
    AND (resolution->>'version') IS NOT DISTINCT FROM 'm5-availability-resolution-v2'
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
    AND (resolution#>'{observed,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,configuredIntent}')
    AND (resolution#>>'{observed,intentDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,intentDigest}')
    AND (resolution#>>'{observed,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{originalHold,before,effectiveDigest}')
    AND (resolution#>'{observed,effectiveVisibility,publishedPublicationIds}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,publishedPublicationIds}')
    AND (resolution#>'{observed,effectiveVisibility,onlineStore}') IS NOT DISTINCT FROM (resolution#>'{originalHold,before,effectiveVisibility,onlineStore}')
    AND (resolution#>'{observed,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{decision,version}') IS NOT DISTINCT FROM 'm5-availability-recovery-decision-v2'
    AND (resolution#>>'{decision,outstandingWrites}') IS NOT DISTINCT FROM 'SETTLED_BY_TRUSTED_OPERATOR'
    AND (resolution#>>'{decision,shopId}') IS NOT DISTINCT FROM shop_id
    AND (resolution#>>'{decision,configId}') IS NOT DISTINCT FROM config_id
    AND (resolution#>>'{decision,operationId}') IS NOT DISTINCT FROM operation_id
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key
    AND (resolution#>>'{originalHold,version}') IS NOT DISTINCT FROM 'm5-availability-hold-v2'
    AND (resolution#>>'{originalHold,before,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{observed,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>>'{reviewedObservation,version}') IS NOT DISTINCT FROM 'm5-product-availability-snapshot-v2'
    AND (resolution#>'{reviewedObservation,scope}') IS NOT DISTINCT FROM (resolution->'currentScope')
    AND (resolution#>>'{reviewedObservation,productId}') IS NOT DISTINCT FROM (resolution#>>'{observed,productId}')
    AND (resolution#>>'{reviewedObservation,state}') IS NOT DISTINCT FROM (resolution#>>'{observed,state}')
    AND (resolution#>'{reviewedObservation,configuredIntent}') IS NOT DISTINCT FROM (resolution#>'{observed,configuredIntent}')
    AND (resolution#>>'{reviewedObservation,effectiveDigest}') IS NOT DISTINCT FROM (resolution#>>'{observed,effectiveDigest}')),false));

-- V2 evidence cannot borrow historical v1 hold/snapshot meanings. V1 rows bypass
-- this additive constraint and retain their original constraints unchanged.
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_v2_hold CHECK (
 evidence->>'version'<>'m5-activation-evidence-v2' OR COALESCE((
  (evidence->>'admissionClass'='SAME_MODE' AND evidence->'hold'='null'::jsonb AND evidence->'holdObservation'='null'::jsonb)
  OR (evidence->>'admissionClass' IN ('FIRST_PUBLICATION','MODE_CHANGE')
   AND evidence#>>'{hold,version}'='m5-availability-hold-v2'
   AND evidence#>>'{hold,operationId}'=operation_id
   AND evidence#>>'{hold,before,version}'='m5-product-availability-snapshot-v2'
   AND evidence#>>'{hold,held,version}'='m5-product-availability-snapshot-v2'
   AND evidence#>>'{holdObservation,version}'='m5-product-availability-snapshot-v2'
   AND evidence#>>'{hold,before,scope,shopId}'=shop_id
   AND evidence#>>'{hold,before,scope,installationGeneration}'=installation_generation::text
   AND evidence#>>'{hold,before,scope,appClientId}'=evidence#>>'{functionObservation,appClientId}'
   AND evidence#>'{hold,held,scope}'=evidence#>'{hold,before,scope}'
   AND evidence#>'{holdObservation,scope}'=evidence#>'{hold,before,scope}'
   AND COALESCE((evidence#>>'{hold,before,productId}') ~ '^gid://shopify/Product/[1-9][0-9]{0,30}$',false)
   AND evidence#>>'{hold,held,productId}'=evidence#>>'{hold,before,productId}'
   AND evidence#>>'{holdObservation,productId}'=evidence#>>'{hold,before,productId}'
   AND evidence#>>'{hold,held,state}'='unavailable'
   AND evidence#>>'{holdObservation,state}'='unavailable'
   AND jsonb_typeof(evidence#>'{hold,before,providerUpdatedAt}')='string'
   AND jsonb_typeof(evidence#>'{hold,held,providerUpdatedAt}')='string'
   AND jsonb_typeof(evidence#>'{holdObservation,providerUpdatedAt}')='string'
   AND jsonb_typeof(evidence#>'{hold,before,configuredIntent}')='object'
   AND evidence#>'{hold,before,configuredIntent,scheduled}'='[]'::jsonb
   AND evidence#>'{hold,held,configuredIntent}'=evidence#>'{hold,before,configuredIntent}'
   AND evidence#>'{holdObservation,configuredIntent}'=evidence#>'{hold,before,configuredIntent}'
   AND COALESCE((evidence#>>'{hold,before,intentDigest}') ~ '^[a-f0-9]{64}$',false)
   AND evidence#>>'{hold,held,intentDigest}'=evidence#>>'{hold,before,intentDigest}'
   AND evidence#>>'{holdObservation,intentDigest}'=evidence#>>'{hold,before,intentDigest}'
   AND COALESCE((evidence#>>'{hold,held,effectiveDigest}') ~ '^[a-f0-9]{64}$',false)
   AND evidence#>>'{holdObservation,effectiveDigest}'=evidence#>>'{hold,held,effectiveDigest}'
   AND evidence#>'{hold,held,effectiveVisibility,publishedPublicationIds}'='[]'::jsonb
   AND evidence#>'{holdObservation,effectiveVisibility,publishedPublicationIds}'='[]'::jsonb
   AND evidence#>'{hold,held,effectiveVisibility,onlineStore}'='{"publishedAtPresent":false,"urlPresent":false}'::jsonb
   AND evidence#>'{holdObservation,effectiveVisibility,onlineStore}'='{"publishedAtPresent":false,"urlPresent":false}'::jsonb)
 ),false));

-- One audit predicate fences both mutable state and immutable activation evidence.
-- V1 rows bypass these additive constraints and are never rewritten.
CREATE FUNCTION valid_availability_v2_audit(candidate jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT COALESCE((
  (NOT candidate ? 'acquisitionAcknowledgement' OR (
   candidate#>>'{acquisitionAcknowledgement,version}'='m5-availability-mutation-ack-v2'
   AND candidate#>'{acquisitionAcknowledgement,scope}'=candidate#>'{before,scope}'
   AND candidate#>>'{acquisitionAcknowledgement,productId}'=candidate#>>'{before,productId}'
   AND candidate#>>'{acquisitionAcknowledgement,state}'='unavailable'
   AND jsonb_typeof(candidate#>'{acquisitionAcknowledgement,providerUpdatedAt}')='string'))
  AND (NOT candidate ? 'restorationReceipt' OR (
   candidate#>>'{restorationReceipt,version}'='m5-availability-restoration-receipt-v2'
   AND candidate#>>'{restorationReceipt,kind}' IN ('RESTORED','NOT_DISPATCHED','RESTORATION_PENDING','CONFLICT')
   AND (candidate#>'{restorationReceipt,acknowledgement}'='null'::jsonb OR (
    candidate#>>'{restorationReceipt,acknowledgement,version}'='m5-availability-mutation-ack-v2'
    AND candidate#>'{restorationReceipt,acknowledgement,scope}'=candidate#>'{before,scope}'
    AND candidate#>>'{restorationReceipt,acknowledgement,productId}'=candidate#>>'{before,productId}'
    AND jsonb_typeof(candidate#>'{restorationReceipt,acknowledgement,providerUpdatedAt}')='string'))
   AND (candidate#>'{restorationReceipt,current}'='null'::jsonb OR (
    candidate#>>'{restorationReceipt,current,version}'='m5-product-availability-snapshot-v2'
    AND candidate#>'{restorationReceipt,current,scope}'=candidate#>'{before,scope}'
    AND candidate#>>'{restorationReceipt,current,productId}'=candidate#>>'{before,productId}'))))
 ),false);
$$;
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_014_v2_audit CHECK (
 hold IS NULL OR hold->>'version'<>'m5-availability-hold-v2'
 OR valid_availability_v2_audit(hold));
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_v2_audit CHECK (
 evidence->>'version'<>'m5-activation-evidence-v2' OR evidence->'hold'='null'::jsonb
 OR valid_availability_v2_audit(evidence->'hold'));
CREATE FUNCTION enforce_activation_v2_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.hold->>'version'='m5-availability-hold-v2' AND (
  (OLD.hold ? 'acquisitionAcknowledgement' AND NEW.hold->'acquisitionAcknowledgement' IS DISTINCT FROM OLD.hold->'acquisitionAcknowledgement')
  OR (NOT OLD.hold ? 'acquisitionAcknowledgement' AND NEW.hold ? 'acquisitionAcknowledgement' AND NOT (OLD.kind='ACQUISITION_PENDING' AND NEW.kind IN ('HELD','OPERATOR_HOLD')))
  OR (OLD.hold ? 'restorationReceipt' AND NEW.hold->'restorationReceipt' IS DISTINCT FROM OLD.hold->'restorationReceipt')
  OR (NOT OLD.hold ? 'restorationReceipt' AND NEW.hold ? 'restorationReceipt' AND OLD.kind<>'RESTORATION_CLAIMED')
 ) THEN RAISE EXCEPTION 'v2 availability audit is immutable or out of phase' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m5_activation_v2_audit_guard BEFORE UPDATE ON m5_activation_state FOR EACH ROW EXECUTE FUNCTION enforce_activation_v2_audit();

-- migrate:down
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_v2_audit;
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_v2_hold;
DROP TRIGGER m5_activation_v2_audit_guard ON m5_activation_state;
DROP FUNCTION enforce_activation_v2_audit();
ALTER TABLE m5_activation_state DROP CONSTRAINT m5_014_v2_audit;
DROP FUNCTION valid_availability_v2_audit(jsonb);
-- Reverting after v2 records exist fails closed; no down migration rewrites JSONB.
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_version;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_version_v1 CHECK (jsonb_typeof(evidence) = 'object'
    AND (evidence->>'version') IS NOT DISTINCT FROM 'm5-activation-evidence-v1');
ALTER TABLE m5_activation_evidence DROP CONSTRAINT m5_014_evidence_identity;
ALTER TABLE m5_activation_evidence ADD CONSTRAINT m5_014_evidence_identity_v1 CHECK ((evidence->>'shopId') IS NOT DISTINCT FROM shop_id
    AND (evidence->>'configId') IS NOT DISTINCT FROM config_id
    AND (evidence->>'operationId') IS NOT DISTINCT FROM operation_id
    AND (evidence->>'revisionId') IS NOT DISTINCT FROM revision_id
    AND (evidence->>'installationGeneration') IS NOT DISTINCT FROM installation_generation::text
    AND (evidence->>'operationSequence') IS NOT DISTINCT FROM operation_sequence::text
    AND (evidence->>'authorizationGeneration') IS NOT DISTINCT FROM authorization_generation::text
    AND (evidence->'authorizationEpoch') IS NOT DISTINCT FROM to_jsonb(authorization_epoch)
    AND (evidence->'selectedKeyId') IS NOT DISTINCT FROM to_jsonb(selected_key_id)
    AND (evidence->'decisionVersion') IS NOT DISTINCT FROM '1'::jsonb);
ALTER TABLE m5_activation_state DROP CONSTRAINT m5_014_hold_version;
ALTER TABLE m5_activation_state ADD CONSTRAINT m5_014_hold_version_v1 CHECK (hold IS NULL OR ((hold->>'version') IS NOT DISTINCT FROM 'm5-availability-hold-v1'
    AND (hold->>'operationId') IS NOT DISTINCT FROM operation_id
    AND jsonb_typeof(hold->'before') IS NOT DISTINCT FROM 'object'
    AND (hold#>>'{before,scope,shopId}') IS NOT DISTINCT FROM shop_id));
ALTER TABLE m5_availability_resolutions DROP CONSTRAINT m5_014_resolution_version;
ALTER TABLE m5_availability_resolutions ADD CONSTRAINT m5_014_resolution_version_v1 CHECK (jsonb_typeof(resolution)='object'
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
    AND (resolution#>>'{decision,commandKey}') IS NOT DISTINCT FROM command_key);
