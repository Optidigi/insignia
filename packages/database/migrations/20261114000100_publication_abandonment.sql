-- migrate:up
-- #466 part B: automatic release of an abandoned publication hold. The design record
-- (docs/architecture/design-466-abandoned-hold-release.md) holds the state tables. Original
-- validators and triggers are copied for down; new rules wrap or replace them.
DO $copy$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.m5_v3_hold(jsonb)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.m5_v3_hold(','FUNCTION public.m5_v3_hold_before_abandonment(');
 definition:=pg_get_functiondef('public.enforce_activation_v3_audit()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_activation_v3_audit()','FUNCTION public.enforce_activation_v3_audit_before_abandonment()');
 definition:=pg_get_functiondef('public.enforce_activation_state()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_activation_state()','FUNCTION public.enforce_activation_state_before_abandonment()');
 definition:=pg_get_functiondef('public.enforce_m4_publication_progress()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_m4_publication_progress()','FUNCTION public.enforce_m4_publication_progress_before_abandonment()');
 definition:=pg_get_functiondef('public.enforce_availability_resolution_marker()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_availability_resolution_marker()','FUNCTION public.enforce_availability_resolution_marker_before_abandonment()');
END $copy$;
-- The copied validator stays executable: the hold CHECK constraint calls it as every writer.
REVOKE ALL ON FUNCTION public.enforce_activation_v3_audit_before_abandonment(),
 public.enforce_activation_state_before_abandonment(), public.enforce_m4_publication_progress_before_abandonment(),
 public.enforce_availability_resolution_marker_before_abandonment() FROM PUBLIC;

-- 1. Progress: terminal phase `abandoned`, reached only from a committed `prepared`.
ALTER TABLE public.m4_publication_progress DROP CONSTRAINT m4_publication_progress_phase_check;
ALTER TABLE public.m4_publication_progress ADD CONSTRAINT m4_publication_progress_phase_check CHECK (phase IN
 ('prepared','shop-config-written','pending-written','policy-written','ready-written',
  'activation-pending','conflict','operator-hold','active','abandoned'));
CREATE OR REPLACE FUNCTION public.enforce_m4_publication_progress() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD.phase = 'abandoned' THEN
    RAISE EXCEPTION 'abandoned publication progress is terminal' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.phase IN ('conflict', 'operator-hold', 'active') AND NEW.phase <> OLD.phase THEN
    RAISE EXCEPTION 'terminal publication progress cannot advance'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.phase <> OLD.phase AND NOT (
    (OLD.phase = 'prepared' AND NEW.phase IN ('shop-config-written', 'abandoned')) OR
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

-- 2. Activation: ABANDON_CLAIMED (one-use claim) and terminal ABANDON_RESTORED.
ALTER TABLE public.m5_activation_state DROP CONSTRAINT m5_activation_state_kind_check;
ALTER TABLE public.m5_activation_state ADD CONSTRAINT m5_activation_state_kind_check CHECK (kind IN
 ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING',
  'RESTORATION_CLAIMED','RESTORED','RESOLVED','OPERATOR_HOLD','ABANDON_CLAIMED','ABANDON_RESTORED'));
ALTER TABLE public.m5_activation_state ADD CONSTRAINT m5_abandonment_hold CHECK (kind NOT IN ('ABANDON_CLAIMED','ABANDON_RESTORED')
 OR (hold IS NOT NULL AND evidence_digest IS NULL AND resolution_digest IS NULL
  AND hold->>'version'='m5-availability-hold-v3' AND hold ? 'abandonmentClaim' AND hold ? 'restorationClaim'));
DROP INDEX public.m5_activation_unresolved_hold;
CREATE INDEX m5_activation_unresolved_hold ON public.m5_activation_state(shop_id, config_id)
  WHERE hold IS NOT NULL AND kind NOT IN ('RESTORED','RESOLVED','ABANDON_RESTORED');

-- The hold JSON gains one immutable key, written only on entry to ABANDON_CLAIMED.
CREATE OR REPLACE FUNCTION public.m5_v3_hold(candidate jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE claim jsonb:=candidate->'abandonmentClaim';
 instant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
BEGIN
 IF NOT coalesce(candidate ? 'abandonmentClaim',false) THEN RETURN public.m5_v3_hold_before_abandonment(candidate); END IF;
 IF NOT coalesce(public.m5_v3_keys(claim,ARRAY['version','operationId','scope','productId','authority','quietSince','claimedAt'],ARRAY['commandKey','inspectDigest'])
   AND claim->>'version'='m5-publication-abandonment-claim-v1'
   AND claim->>'operationId'=candidate->>'operationId'
   AND claim->'scope'=candidate#>'{before,scope}' AND claim->>'productId'=candidate#>>'{before,productId}'
   AND jsonb_typeof(claim->'quietSince')='string' AND claim->>'quietSince' ~ instant
   AND jsonb_typeof(claim->'claimedAt')='string' AND claim->>'claimedAt' ~ instant
   AND claim->>'quietSince'<=claim->>'claimedAt'
   AND ((claim->>'authority'='PROVED_NOT_DISPATCHED' AND NOT claim ?| ARRAY['commandKey','inspectDigest'])
    OR (claim->>'authority'='SETTLED_BY_TRUSTED_OPERATOR'
     AND jsonb_typeof(claim->'commandKey')='string' AND claim->>'commandKey' ~ '^[A-Za-z0-9_-]{1,128}$'
     AND jsonb_typeof(claim->'inspectDigest')='string' AND claim->>'inspectDigest' ~ '^[a-f0-9]{64}$'))
   AND candidate ? 'restorationClaim' AND jsonb_typeof(candidate->'held')='object',false) THEN RETURN false; END IF;
 RETURN public.m5_v3_hold_before_abandonment(candidate-'abandonmentClaim');
END $$;

-- 3a. Append-only abandonment audit, keyed by the activation version (one row per update).
CREATE TABLE public.m5_publication_abandonment_audit (
 shop_id text NOT NULL,
 config_id text NOT NULL,
 operation_id text NOT NULL,
 activation_version bigint NOT NULL CHECK (activation_version > 0),
 event text NOT NULL CHECK (event IN ('CLAIMED','RECEIPT','RESTORED','FLAGGED')),
 from_kind text NOT NULL,
 to_kind text NOT NULL,
 hold jsonb,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object' AND length(detail::text)<=1024),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (shop_id, config_id, operation_id, activation_version),
 FOREIGN KEY (shop_id, config_id, operation_id) REFERENCES public.publication_operations(shop_id, config_id, operation_id)
);
ALTER TABLE public.m5_publication_abandonment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m5_publication_abandonment_audit FROM PUBLIC;
CREATE FUNCTION public.guard_publication_abandonment_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'publication abandonment audit is append-only' USING ERRCODE='check_violation'; END $$;
REVOKE ALL ON FUNCTION public.guard_publication_abandonment_audit() FROM PUBLIC;
CREATE TRIGGER m5_publication_abandonment_audit_immutable BEFORE UPDATE OR DELETE ON public.m5_publication_abandonment_audit
FOR EACH ROW EXECUTE FUNCTION public.guard_publication_abandonment_audit();

-- 3b. The schema-owner audit trigger: claims, receipts and their rearm now also cover
-- ABANDON_CLAIMED. A NOT_DISPATCHED receipt without a current snapshot (a failed pre-write read)
-- may be consumed once like any other: restore() rereads and requires the owned held snapshot
-- before any write. It also appends the abandonment audit.
CREATE OR REPLACE FUNCTION public.enforce_activation_v3_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE product_id text; shopify_shop_id text; generation text; field text;
 receipt jsonb; digest text; consumption boolean:=false; replacement boolean:=false;
 claimed text[]:=ARRAY['RESTORATION_CLAIMED','ABANDON_CLAIMED']; event text; raw text; detail jsonb;
BEGIN
 IF TG_RELID<>'public.m5_activation_state'::regclass THEN RAISE EXCEPTION 'unexpected restoration audit relation' USING ERRCODE='check_violation'; END IF;
 IF NEW.hold->>'version'='m5-availability-hold-v3' THEN
  SELECT 'gid://shopify/Product/'||c.external_product_id,'gid://shopify/Shop/'||s.shopify_shop_id,p.installation_generation::text
   INTO product_id,shopify_shop_id,generation FROM public.product_configs c JOIN public.shops s USING(shop_id)
   JOIN public.publication_operations p USING(shop_id,config_id)
   WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id AND p.operation_id=NEW.operation_id;
  IF NEW.hold#>>'{before,productId}' IS DISTINCT FROM product_id OR NEW.hold#>>'{before,scope,shopifyShopId}' IS DISTINCT FROM shopify_shop_id OR NEW.hold#>>'{before,scope,installationGeneration}' IS DISTINCT FROM generation THEN RAISE EXCEPTION 'v3 availability product binding' USING ERRCODE='check_violation'; END IF;
  IF TG_OP='INSERT' AND NEW.hold#>'{restorationClaim}' ? 'settledNoDispatchReceiptDigest' THEN RAISE EXCEPTION 'retry proof requires existing settled state' USING ERRCODE='check_violation'; END IF;
  IF TG_OP='INSERT' AND NEW.hold ? 'abandonmentClaim' THEN RAISE EXCEPTION 'abandonment claim requires an existing hold' USING ERRCODE='check_violation'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.hold->>'version'='m5-availability-hold-v3' THEN
  receipt:=OLD.hold->'restorationReceipt'; digest:=public.m5_v3_digest(receipt);
  consumption:=coalesce(OLD.kind=ANY(claimed) AND NEW.kind=OLD.kind
   AND OLD.hold->>'operationId'=OLD.operation_id AND public.m5_v3_hold(OLD.hold)
   AND receipt->>'version'='m5-availability-restoration-receipt-v3' AND receipt->>'kind'='NOT_DISPATCHED'
   AND receipt->'acknowledgement'='null'::jsonb AND NOT receipt ? 'compensation'
   AND (receipt->'current'='null'::jsonb OR (public.m5_v3_same(receipt->'current',OLD.hold->'held',OLD.hold#>'{before,scope}')
    AND receipt#>>'{current,state}'='unavailable'))
   AND NEW.hold-'restorationClaim'=OLD.hold-'restorationClaim'
   AND (NEW.hold->'restorationClaim')-'settledNoDispatchReceiptDigest'=(OLD.hold->'restorationClaim')-'settledNoDispatchReceiptDigest'
   AND NEW.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}'=digest
   AND OLD.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}' IS DISTINCT FROM digest,false);
  IF consumption THEN
   INSERT INTO public.m5_restoration_no_dispatch_consumptions(shop_id,config_id,operation_id,receipt_digest,original_claim,original_receipt,consumed_claim)
   VALUES(OLD.shop_id,OLD.config_id,OLD.operation_id,digest,OLD.hold->'restorationClaim',receipt,NEW.hold->'restorationClaim');
  END IF;
  replacement:=coalesce(OLD.kind=ANY(claimed)
   AND OLD.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}'=digest
   AND NEW.hold-'restorationReceipt'=OLD.hold-'restorationReceipt'
   AND EXISTS(SELECT FROM public.m5_restoration_no_dispatch_consumptions a WHERE a.shop_id=OLD.shop_id AND a.config_id=OLD.config_id AND a.operation_id=OLD.operation_id AND a.receipt_digest=digest AND a.original_receipt=receipt AND a.consumed_claim=OLD.hold->'restorationClaim'),false);
  FOREACH field IN ARRAY ARRAY['acquisitionAcknowledgement','restorationClaim','restorationReceipt','abandonmentClaim'] LOOP
   IF OLD.hold ? field AND NEW.hold->field IS DISTINCT FROM OLD.hold->field
    AND NOT (field='restorationClaim' AND consumption) AND NOT(field='restorationReceipt' AND replacement)
    THEN RAISE EXCEPTION 'v3 availability audit is immutable' USING ERRCODE='check_violation'; END IF;
  END LOOP;
  IF (NOT OLD.hold ? 'acquisitionAcknowledgement' AND NEW.hold ? 'acquisitionAcknowledgement' AND NOT (OLD.kind='ACQUISITION_PENDING' AND NEW.kind IN ('HELD','OPERATOR_HOLD')))
   OR (NOT OLD.hold ? 'restorationClaim' AND NEW.hold ? 'restorationClaim' AND NOT ((OLD.kind='RESTORATION_PENDING' AND NEW.kind='RESTORATION_CLAIMED')
    OR (OLD.kind IN ('HELD','OPERATOR_HOLD') AND NEW.kind='ABANDON_CLAIMED')))
   OR (NOT OLD.hold ? 'restorationReceipt' AND NEW.hold ? 'restorationReceipt' AND NOT OLD.kind=ANY(claimed))
   OR (NOT OLD.hold ? 'abandonmentClaim' AND NEW.hold ? 'abandonmentClaim' AND NOT (OLD.kind IN ('HELD','OPERATOR_HOLD') AND NEW.kind='ABANDON_CLAIMED'))
   THEN RAISE EXCEPTION 'v3 availability audit is out of phase' USING ERRCODE='check_violation'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  -- Reason codes are diagnostic only: a transaction-local setting, never authority.
  raw:=nullif(current_setting('insignia.publication_abandonment_detail',true),'');
  event:=CASE
   WHEN NEW.kind='ABANDON_CLAIMED' AND OLD.kind<>'ABANDON_CLAIMED' THEN 'CLAIMED'
   WHEN NEW.kind='ABANDON_RESTORED' AND OLD.kind<>'ABANDON_RESTORED' THEN 'RESTORED'
   WHEN NEW.kind='OPERATOR_HOLD' AND OLD.kind<>'OPERATOR_HOLD' AND (OLD.kind='ABANDON_CLAIMED' OR raw IS NOT NULL) THEN 'FLAGGED'
   WHEN OLD.kind='ABANDON_CLAIMED' AND NEW.kind='ABANDON_CLAIMED' AND NEW.hold->'restorationReceipt' IS DISTINCT FROM OLD.hold->'restorationReceipt' THEN 'RECEIPT'
  END;
  IF event IS NOT NULL THEN
   BEGIN detail:=coalesce(raw,'{}')::jsonb; EXCEPTION WHEN OTHERS THEN detail:=NULL; END;
   IF detail IS NULL OR jsonb_typeof(detail)<>'object' OR length(detail::text)>1024 THEN detail:='{"invalid":true}'::jsonb; END IF;
   INSERT INTO public.m5_publication_abandonment_audit(shop_id,config_id,operation_id,activation_version,event,from_kind,to_kind,hold,detail)
   VALUES(NEW.shop_id,NEW.config_id,NEW.operation_id,NEW.version,event,OLD.kind,NEW.kind,NEW.hold,detail);
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- 3c. Activation transitions (design §3.1). Every existing transition is unchanged.
CREATE OR REPLACE FUNCTION public.enforce_activation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'ABANDON_RESTORED' THEN
    RAISE EXCEPTION 'abandoned hold restoration is terminal' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.shop_id, NEW.config_id, NEW.operation_id) IS DISTINCT FROM (OLD.shop_id, OLD.config_id, OLD.operation_id)
    OR NEW.version <> OLD.version + 1
    OR (OLD.evidence_digest IS NOT NULL AND NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest)
    OR (OLD.hold IS NOT NULL AND (NEW.hold IS NULL OR NEW.hold->'before' IS DISTINCT FROM OLD.hold->'before'
      OR NEW.hold->>'operationId' IS DISTINCT FROM OLD.hold->>'operationId'
      OR NEW.hold->>'version' IS DISTINCT FROM OLD.hold->>'version'
      OR (OLD.hold->'held' <> 'null'::jsonb AND NEW.hold->'held' IS DISTINCT FROM OLD.hold->'held')))
    OR (OLD.resolution_digest IS NOT NULL AND NEW.resolution_digest IS DISTINCT FROM OLD.resolution_digest)
    OR (OLD.kind IN ('RESTORED','RESOLVED') AND NEW.kind <> OLD.kind)
    OR (OLD.kind='RESTORATION_CLAIMED' AND NEW.resolution_digest IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM m5_availability_resolutions r WHERE r.shop_id=OLD.shop_id AND r.config_id=OLD.config_id
        AND r.operation_id=OLD.operation_id AND r.resolution_digest=NEW.resolution_digest
        AND r.resolution->'originalHold' IS NOT DISTINCT FROM OLD.hold
        AND r.resolution->'activationEvidenceDigest' IS NOT DISTINCT FROM COALESCE(to_jsonb(OLD.evidence_digest),'null'::jsonb)
    ))
    OR (OLD.kind='OPERATOR_HOLD' AND NEW.kind <> OLD.kind AND NEW.kind <> 'ABANDON_CLAIMED' AND NOT (
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
    (OLD.kind = 'HELD' AND NEW.kind IN ('WAITING_RELEASE','RESTORATION_PENDING','ABANDON_CLAIMED')) OR
    (OLD.kind = 'RESTORATION_PENDING' AND NEW.kind = 'RESTORATION_CLAIMED') OR
    (OLD.kind = 'RESTORATION_CLAIMED' AND NEW.kind IN ('RESTORED','RESOLVED')) OR
    (OLD.kind='OPERATOR_HOLD' AND NEW.kind IN ('RESTORED','RESOLVED') AND NEW.resolution_digest IS NOT NULL) OR
    (OLD.kind = 'OPERATOR_HOLD' AND NEW.kind = 'ABANDON_CLAIMED') OR
    (OLD.kind = 'ABANDON_CLAIMED' AND NEW.kind = 'ABANDON_RESTORED') OR
    NEW.kind = 'OPERATOR_HOLD'
  ) THEN RAISE EXCEPTION 'invalid activation state transition' USING ERRCODE = 'check_violation'; END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

-- 3d. Entry into ABANDON_CLAIMED proves P1 and E3-E6 on the current rows. This is the only
-- locking cross-row read: progress and operation FOR SHARE, already covered by the caller's
-- six-row lock. Entry into ABANDON_RESTORED requires the settled RESTORED receipt (m5_v3_hold
-- also requires its qualified acknowledgement).
CREATE FUNCTION public.enforce_activation_abandonment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original jsonb:=OLD.hold; phase text; status text; sequence bigint; generation bigint;
 current_sequence bigint; current_generation bigint; inactive boolean;
BEGIN
 IF NEW.kind='ABANDON_CLAIMED' THEN
  IF NOT coalesce(OLD.kind IN ('HELD','OPERATOR_HOLD') AND OLD.evidence_digest IS NULL AND OLD.resolution_digest IS NULL
    AND original->>'version'='m5-availability-hold-v3' AND original->>'operationId'=NEW.operation_id
    AND jsonb_typeof(original->'held')='object' AND original#>>'{held,state}'='unavailable'
    AND NOT original ?| ARRAY['restorationClaim','restorationReceipt','abandonmentClaim']
    AND (original ? 'acquisitionAcknowledgement' OR original#>>'{before,state}'='unavailable')
    AND NEW.hold-'abandonmentClaim'-'restorationClaim'=original
    AND NEW.hold->'restorationClaim'=jsonb_build_object('version','m5-availability-restoration-claim-v3',
     'operationId',NEW.operation_id,'scope',original#>'{before,scope}','productId',original#>>'{before,productId}',
     'restoreReserved',true,'compensationReserved',true)
    AND NEW.hold#>>'{abandonmentClaim,authority}'=CASE OLD.kind WHEN 'HELD' THEN 'PROVED_NOT_DISPATCHED' ELSE 'SETTLED_BY_TRUSTED_OPERATOR' END,false)
  THEN RAISE EXCEPTION 'abandonment claim requires an owned v3 hold without restoration' USING ERRCODE='check_violation'; END IF;
  SELECT p.phase INTO phase FROM public.m4_publication_progress p
   WHERE p.shop_id=NEW.shop_id AND p.config_id=NEW.config_id AND p.operation_id=NEW.operation_id FOR SHARE;
  IF phase IS DISTINCT FROM 'prepared' THEN
   RAISE EXCEPTION 'abandonment claim requires committed phase prepared' USING ERRCODE='check_violation';
  END IF;
  SELECT o.status, o.operation_sequence, o.installation_generation INTO status, sequence, generation
   FROM public.publication_operations o
   WHERE o.shop_id=NEW.shop_id AND o.config_id=NEW.config_id AND o.operation_id=NEW.operation_id FOR SHARE;
  SELECT c.publication_sequence, s.current_generation, i.deactivated_at IS NOT NULL
   INTO current_sequence, current_generation, inactive
   FROM public.product_configs c JOIN public.shops s ON s.shop_id=c.shop_id
   JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
   WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id;
  IF NOT coalesce(status='requested' AND sequence=current_sequence AND generation=current_generation AND NOT inactive,false) THEN
   RAISE EXCEPTION 'abandonment claim requires the current requested operation of the active installation' USING ERRCODE='check_violation';
  END IF;
 ELSIF NEW.kind='ABANDON_RESTORED' THEN
  IF NOT coalesce(OLD.kind='ABANDON_CLAIMED' AND NEW.hold=OLD.hold
    AND NEW.hold#>>'{restorationReceipt,kind}'='RESTORED'
    AND public.m5_v3_same(NEW.hold#>'{restorationReceipt,current}',NEW.hold->'before',NEW.hold#>'{before,scope}'),false)
  THEN RAISE EXCEPTION 'abandoned hold restoration requires a settled RESTORED receipt' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_activation_abandonment() FROM PUBLIC;
CREATE TRIGGER m5_activation_abandonment_guard BEFORE UPDATE ON public.m5_activation_state FOR EACH ROW
  WHEN (OLD.kind IS DISTINCT FROM NEW.kind AND NEW.kind IN ('ABANDON_CLAIMED','ABANDON_RESTORED'))
  EXECUTE FUNCTION public.enforce_activation_abandonment();

-- 3e. OPERATOR_HOLD -> ABANDON_CLAIMED only inside the operator SECURITY DEFINER function, where
-- current_user is the schema owner. A SECURITY INVOKER trigger sees the real caller; the
-- SECURITY DEFINER audit trigger could not.
CREATE FUNCTION public.enforce_operator_abandonment_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user::text IS DISTINCT FROM (SELECT pg_get_userbyid(c.relowner)::text FROM pg_class c WHERE c.oid='public.m5_activation_state'::regclass) THEN
  RAISE EXCEPTION 'an operator abandonment claim requires the operator function' USING ERRCODE='insufficient_privilege';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_operator_abandonment_claim() FROM PUBLIC;
CREATE TRIGGER m5_activation_operator_claim_guard BEFORE UPDATE ON public.m5_activation_state FOR EACH ROW
  WHEN (OLD.kind='OPERATOR_HOLD' AND NEW.kind='ABANDON_CLAIMED')
  EXECUTE FUNCTION public.enforce_operator_abandonment_claim();

-- 3f. Freeze (design §3.2): while a claim exists, progress and operation rows are frozen; after
-- the restore only the finalize transition is allowed. A plain read of the activation kind is
-- enough: every writer of these rows holds the shop lock, and ABANDON_* is entered under it.
-- Without an activation row (same-mode publication) nothing is frozen.
CREATE FUNCTION public.enforce_publication_abandonment_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE activation text;
BEGIN
 SELECT a.kind INTO activation FROM public.m5_activation_state a
  WHERE a.shop_id=OLD.shop_id AND a.config_id=OLD.config_id AND a.operation_id=OLD.operation_id;
 IF activation='ABANDON_CLAIMED' THEN
  RAISE EXCEPTION 'publication is frozen while its abandoned hold is restored' USING ERRCODE='check_violation';
 END IF;
 IF TG_TABLE_NAME='m4_publication_progress' THEN
  IF NEW.phase='abandoned' AND activation IS DISTINCT FROM 'ABANDON_RESTORED' THEN
   RAISE EXCEPTION 'abandoned progress requires a restored abandoned hold' USING ERRCODE='check_violation';
  END IF;
  IF activation='ABANDON_RESTORED' AND NOT (OLD.phase='prepared' AND NEW.phase='abandoned') THEN
   RAISE EXCEPTION 'abandoned publication only finalizes' USING ERRCODE='check_violation';
  END IF;
 ELSE
  IF NEW.failure_class='publication-abandoned' AND OLD.failure_class IS DISTINCT FROM NEW.failure_class
   AND activation IS DISTINCT FROM 'ABANDON_RESTORED' THEN
   RAISE EXCEPTION 'abandoned failure requires a restored abandoned hold' USING ERRCODE='check_violation';
  END IF;
  IF activation='ABANDON_RESTORED' AND OLD.status='requested' AND NOT (NEW.status='failed'
    AND NEW.failure_class='publication-abandoned' AND NEW.failed_at IS NOT NULL
    AND OLD.availability_resolved_at IS NULL AND NEW.availability_resolved_at IS NOT NULL
    AND to_jsonb(NEW)-ARRAY['status','failed_at','failure_class','availability_resolved_at']
     =to_jsonb(OLD)-ARRAY['status','failed_at','failure_class','availability_resolved_at']) THEN
   RAISE EXCEPTION 'abandoned publication only finalizes' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_publication_abandonment_freeze() FROM PUBLIC;
CREATE TRIGGER m4_publication_progress_abandonment_guard BEFORE UPDATE ON public.m4_publication_progress
  FOR EACH ROW EXECUTE FUNCTION public.enforce_publication_abandonment_freeze();
CREATE TRIGGER publication_operations_abandonment_guard BEFORE UPDATE ON public.publication_operations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_publication_abandonment_freeze();

-- 3g. The finalize records the availability disposition from the restored receipt's readback.
CREATE OR REPLACE FUNCTION public.enforce_availability_resolution_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.availability_resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'availability disposition cannot precede publication' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.availability_resolved_at IS DISTINCT FROM OLD.availability_resolved_at AND (
    OLD.availability_resolved_at IS NOT NULL OR NEW.availability_resolved_at IS NULL OR NOT (EXISTS (
      SELECT 1 FROM m5_availability_resolutions r JOIN m5_activation_state s USING (shop_id,config_id,operation_id)
      WHERE r.shop_id=NEW.shop_id AND r.config_id=NEW.config_id AND r.operation_id=NEW.operation_id
        AND s.kind='RESOLVED' AND s.resolution_digest=r.resolution_digest
        AND (r.resolution->>'createdAt')::timestamptz=NEW.availability_resolved_at
    ) OR EXISTS (
      SELECT 1 FROM m5_activation_state s
      WHERE s.shop_id=NEW.shop_id AND s.config_id=NEW.config_id AND s.operation_id=NEW.operation_id
        AND s.kind='ABANDON_RESTORED' AND NEW.status='failed' AND NEW.failure_class='publication-abandoned'
        AND (s.hold#>>'{restorationReceipt,current,observedAt}')::timestamptz=NEW.availability_resolved_at
    ))
  ) THEN RAISE EXCEPTION 'availability disposition requires immutable resolved evidence' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END;
$$;

-- 4. Operator claim (part A's command calls it; no runtime role may). The role has no login; the
-- owner grants it to the SSH-run command identity separately.
DO $role$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='insignia_publication_operator') THEN
  CREATE ROLE insignia_publication_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $role$;
CREATE FUNCTION public.m5_operator_claim_abandoned_hold(p_shop_id text, p_config_id text, p_operation_id text,
 p_expected_version bigint, p_command_key text, p_inspect_digest text) RETURNS bigint
-- The existing activation triggers it fires resolve unqualified names through public.
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE v_generation bigint; v_kind text; v_version bigint; quiet timestamptz; claimed timestamptz; result bigint;
 instant text:='YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
BEGIN
 IF p_command_key IS NULL OR p_command_key !~ '^[A-Za-z0-9_-]{1,128}$' OR p_inspect_digest IS NULL OR p_inspect_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'operator claim requires a command key and an inspect digest' USING ERRCODE='check_violation';
 END IF;
 -- Canonical lock order: shops, installation, config, operation, progress, activation.
 SELECT s.current_generation INTO v_generation FROM public.shops s WHERE s.shop_id=p_shop_id FOR UPDATE;
 PERFORM FROM public.installation_generations i WHERE i.shop_id=p_shop_id AND i.generation=v_generation FOR UPDATE;
 PERFORM FROM public.product_configs c WHERE c.shop_id=p_shop_id AND c.config_id=p_config_id FOR UPDATE;
 PERFORM FROM public.publication_operations o WHERE o.shop_id=p_shop_id AND o.config_id=p_config_id AND o.operation_id=p_operation_id FOR UPDATE;
 PERFORM FROM public.m4_publication_progress p WHERE p.shop_id=p_shop_id AND p.config_id=p_config_id AND p.operation_id=p_operation_id FOR UPDATE;
 SELECT a.kind, a.version, greatest(o.requested_at, p.updated_at, a.updated_at) INTO v_kind, v_version, quiet
  FROM public.m5_activation_state a
  JOIN public.publication_operations o USING (shop_id, config_id, operation_id)
  JOIN public.m4_publication_progress p USING (shop_id, config_id, operation_id)
  WHERE a.shop_id=p_shop_id AND a.config_id=p_config_id AND a.operation_id=p_operation_id FOR UPDATE OF a;
 IF v_kind IS DISTINCT FROM 'OPERATOR_HOLD' OR v_version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'operator claim requires the inspected OPERATOR_HOLD version' USING ERRCODE='check_violation';
 END IF;
 claimed:=clock_timestamp();
 quiet:=least(quiet, claimed);
 UPDATE public.m5_activation_state a SET kind='ABANDON_CLAIMED', version=a.version+1, hold=a.hold||jsonb_build_object(
   'abandonmentClaim',jsonb_build_object('version','m5-publication-abandonment-claim-v1','operationId',p_operation_id,
    'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','authority','SETTLED_BY_TRUSTED_OPERATOR',
    'quietSince',to_char(quiet AT TIME ZONE 'UTC',instant),'claimedAt',to_char(claimed AT TIME ZONE 'UTC',instant),
    'commandKey',p_command_key,'inspectDigest',p_inspect_digest),
   'restorationClaim',jsonb_build_object('version','m5-availability-restoration-claim-v3','operationId',p_operation_id,
    'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','restoreReserved',true,'compensationReserved',true))
  WHERE a.shop_id=p_shop_id AND a.config_id=p_config_id AND a.operation_id=p_operation_id RETURNING a.version INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text) TO insignia_publication_operator;

-- migrate:down
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM public.m5_activation_state WHERE kind IN ('ABANDON_CLAIMED','ABANDON_RESTORED') OR hold ? 'abandonmentClaim')
 OR EXISTS(SELECT FROM public.m4_publication_progress WHERE phase='abandoned')
 OR EXISTS(SELECT FROM public.m5_publication_abandonment_audit)
 OR EXISTS(SELECT FROM public.m5_restoration_no_dispatch_consumptions WHERE original_receipt->'current'='null'::jsonb)
 THEN RAISE EXCEPTION 'publication abandonment evidence requires forward-compatible retention'; END IF;
END $guard$;
DROP FUNCTION public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text);
DO $role$ BEGIN
 -- The role is cluster-wide; keep it while another database still grants it anything.
 DROP ROLE IF EXISTS insignia_publication_operator;
EXCEPTION WHEN dependent_objects_still_exist THEN NULL;
END $role$;
DROP TRIGGER publication_operations_abandonment_guard ON public.publication_operations;
DROP TRIGGER m4_publication_progress_abandonment_guard ON public.m4_publication_progress;
DROP FUNCTION public.enforce_publication_abandonment_freeze();
DROP TRIGGER m5_activation_operator_claim_guard ON public.m5_activation_state;
DROP FUNCTION public.enforce_operator_abandonment_claim();
DROP TRIGGER m5_activation_abandonment_guard ON public.m5_activation_state;
DROP FUNCTION public.enforce_activation_abandonment();
DO $restore$
DECLARE definition text; name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['enforce_activation_v3_audit','enforce_activation_state','enforce_m4_publication_progress','enforce_availability_resolution_marker'] LOOP
  definition:=pg_get_functiondef(format('public.%s_before_abandonment()',name)::regprocedure);
  EXECUTE replace(definition,format('FUNCTION public.%s_before_abandonment()',name),format('FUNCTION public.%s()',name));
 END LOOP;
 definition:=pg_get_functiondef('public.m5_v3_hold_before_abandonment(jsonb)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.m5_v3_hold_before_abandonment(','FUNCTION public.m5_v3_hold(');
END $restore$;
DROP TABLE public.m5_publication_abandonment_audit;
DROP FUNCTION public.guard_publication_abandonment_audit();
DROP FUNCTION public.enforce_activation_v3_audit_before_abandonment();
DROP FUNCTION public.enforce_activation_state_before_abandonment();
DROP FUNCTION public.enforce_m4_publication_progress_before_abandonment();
DROP FUNCTION public.enforce_availability_resolution_marker_before_abandonment();
DROP FUNCTION public.m5_v3_hold_before_abandonment(jsonb);
DROP INDEX public.m5_activation_unresolved_hold;
CREATE INDEX m5_activation_unresolved_hold ON public.m5_activation_state(shop_id, config_id)
  WHERE hold IS NOT NULL AND kind NOT IN ('RESTORED','RESOLVED');
ALTER TABLE public.m5_activation_state DROP CONSTRAINT m5_abandonment_hold;
ALTER TABLE public.m5_activation_state DROP CONSTRAINT m5_activation_state_kind_check;
ALTER TABLE public.m5_activation_state ADD CONSTRAINT m5_activation_state_kind_check CHECK (kind IN
 ('WAITING_RELEASE','WAITING_HOLD','HOLD_INTENT','ACQUISITION_PENDING','HELD','RESTORATION_PENDING',
  'RESTORATION_CLAIMED','RESTORED','RESOLVED','OPERATOR_HOLD'));
ALTER TABLE public.m4_publication_progress DROP CONSTRAINT m4_publication_progress_phase_check;
ALTER TABLE public.m4_publication_progress ADD CONSTRAINT m4_publication_progress_phase_check CHECK (phase IN
 ('prepared','shop-config-written','pending-written','policy-written','ready-written',
  'activation-pending','conflict','operator-hold','active'));
