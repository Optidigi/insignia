-- migrate:up
-- Preserve original validators and audit semantics; add only proved no-write recovery.
DO $copy$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.m5_v3_hold(jsonb)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.m5_v3_hold(','FUNCTION public.m5_v3_hold_before_no_dispatch(');
 definition:=pg_get_functiondef('public.enforce_activation_v3_audit()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_activation_v3_audit()','FUNCTION public.enforce_activation_v3_audit_before_no_dispatch()');
END $copy$;

CREATE OR REPLACE FUNCTION public.m5_v3_hold(candidate jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
DECLARE claim jsonb:=candidate->'restorationClaim';
BEGIN
 IF NOT coalesce(claim ? 'settledNoDispatchReceiptDigest',false) THEN RETURN public.m5_v3_hold_before_no_dispatch(candidate); END IF;
 IF NOT coalesce(public.m5_v3_keys(claim,ARRAY['version','operationId','scope','productId','restoreReserved','compensationReserved','settledNoDispatchReceiptDigest'])
   AND jsonb_typeof(claim->'settledNoDispatchReceiptDigest')='string'
   AND claim->>'settledNoDispatchReceiptDigest' ~ '^[a-f0-9]{64}$',false) THEN RETURN false; END IF;
 RETURN public.m5_v3_hold_before_no_dispatch(jsonb_set(candidate,'{restorationClaim}',claim-'settledNoDispatchReceiptDigest'));
END $$;

CREATE TABLE public.m5_restoration_no_dispatch_consumptions (
 shop_id text NOT NULL,
 config_id text NOT NULL,
 operation_id text NOT NULL,
 receipt_digest text NOT NULL CHECK(receipt_digest ~ '^[a-f0-9]{64}$'),
 original_claim jsonb NOT NULL,
 original_receipt jsonb NOT NULL,
 consumed_claim jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_id,config_id,operation_id,receipt_digest),
 FOREIGN KEY(shop_id,config_id,operation_id) REFERENCES public.publication_operations(shop_id,config_id,operation_id) ON DELETE CASCADE,
 CHECK(receipt_digest=public.m5_v3_digest(original_receipt)),
 CHECK(consumed_claim-'settledNoDispatchReceiptDigest'=original_claim-'settledNoDispatchReceiptDigest'),
 CHECK(consumed_claim->>'settledNoDispatchReceiptDigest'=receipt_digest),
 CHECK(original_receipt->>'kind'='NOT_DISPATCHED' AND original_receipt->'acknowledgement'='null'::jsonb AND NOT original_receipt ? 'compensation')
);
ALTER TABLE public.m5_restoration_no_dispatch_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m5_restoration_no_dispatch_consumptions FROM PUBLIC;
CREATE FUNCTION public.guard_restoration_no_dispatch_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'restoration retry evidence is immutable' USING ERRCODE='check_violation'; END $$;
CREATE TRIGGER m5_restoration_no_dispatch_immutable BEFORE UPDATE ON public.m5_restoration_no_dispatch_consumptions
FOR EACH ROW EXECUTE FUNCTION public.guard_restoration_no_dispatch_audit();

CREATE OR REPLACE FUNCTION public.enforce_activation_v3_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE product_id text; shopify_shop_id text; generation text; field text;
 receipt jsonb; digest text; consumption boolean:=false; replacement boolean:=false;
BEGIN
 IF TG_RELID<>'public.m5_activation_state'::regclass THEN RAISE EXCEPTION 'unexpected restoration audit relation' USING ERRCODE='check_violation'; END IF;
 IF NEW.hold->>'version'='m5-availability-hold-v3' THEN
  SELECT 'gid://shopify/Product/'||c.external_product_id,'gid://shopify/Shop/'||s.shopify_shop_id,p.installation_generation::text
   INTO product_id,shopify_shop_id,generation FROM public.product_configs c JOIN public.shops s USING(shop_id)
   JOIN public.publication_operations p USING(shop_id,config_id)
   WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id AND p.operation_id=NEW.operation_id;
  IF NEW.hold#>>'{before,productId}' IS DISTINCT FROM product_id OR NEW.hold#>>'{before,scope,shopifyShopId}' IS DISTINCT FROM shopify_shop_id OR NEW.hold#>>'{before,scope,installationGeneration}' IS DISTINCT FROM generation THEN RAISE EXCEPTION 'v3 availability product binding' USING ERRCODE='check_violation'; END IF;
  IF TG_OP='INSERT' AND NEW.hold#>'{restorationClaim}' ? 'settledNoDispatchReceiptDigest' THEN RAISE EXCEPTION 'retry proof requires existing settled state' USING ERRCODE='check_violation'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.hold->>'version'='m5-availability-hold-v3' THEN
  receipt:=OLD.hold->'restorationReceipt'; digest:=public.m5_v3_digest(receipt);
  consumption:=coalesce(OLD.kind='RESTORATION_CLAIMED' AND NEW.kind='RESTORATION_CLAIMED'
   AND OLD.hold->>'operationId'=OLD.operation_id AND public.m5_v3_hold(OLD.hold)
   AND receipt->>'version'='m5-availability-restoration-receipt-v3' AND receipt->>'kind'='NOT_DISPATCHED'
   AND receipt->'acknowledgement'='null'::jsonb AND NOT receipt ? 'compensation'
   AND public.m5_v3_same(receipt->'current',OLD.hold->'held',OLD.hold#>'{before,scope}')
   AND receipt#>>'{current,state}'='unavailable'
   AND NEW.hold-'restorationClaim'=OLD.hold-'restorationClaim'
   AND (NEW.hold->'restorationClaim')-'settledNoDispatchReceiptDigest'=(OLD.hold->'restorationClaim')-'settledNoDispatchReceiptDigest'
   AND NEW.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}'=digest
   AND OLD.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}' IS DISTINCT FROM digest,false);
  IF consumption THEN
   INSERT INTO public.m5_restoration_no_dispatch_consumptions(shop_id,config_id,operation_id,receipt_digest,original_claim,original_receipt,consumed_claim)
   VALUES(OLD.shop_id,OLD.config_id,OLD.operation_id,digest,OLD.hold->'restorationClaim',receipt,NEW.hold->'restorationClaim');
  END IF;
  replacement:=coalesce(OLD.kind='RESTORATION_CLAIMED'
   AND OLD.hold#>>'{restorationClaim,settledNoDispatchReceiptDigest}'=digest
   AND NEW.hold-'restorationReceipt'=OLD.hold-'restorationReceipt'
   AND EXISTS(SELECT FROM public.m5_restoration_no_dispatch_consumptions a WHERE a.shop_id=OLD.shop_id AND a.config_id=OLD.config_id AND a.operation_id=OLD.operation_id AND a.receipt_digest=digest AND a.original_receipt=receipt AND a.consumed_claim=OLD.hold->'restorationClaim'),false);
  FOREACH field IN ARRAY ARRAY['acquisitionAcknowledgement','restorationClaim','restorationReceipt'] LOOP
   IF OLD.hold ? field AND NEW.hold->field IS DISTINCT FROM OLD.hold->field
    AND NOT (field='restorationClaim' AND consumption) AND NOT(field='restorationReceipt' AND replacement)
    THEN RAISE EXCEPTION 'v3 availability audit is immutable' USING ERRCODE='check_violation'; END IF;
  END LOOP;
  IF (NOT OLD.hold ? 'acquisitionAcknowledgement' AND NEW.hold ? 'acquisitionAcknowledgement' AND NOT (OLD.kind='ACQUISITION_PENDING' AND NEW.kind IN ('HELD','OPERATOR_HOLD')))
   OR (NOT OLD.hold ? 'restorationClaim' AND NEW.hold ? 'restorationClaim' AND NOT (OLD.kind='RESTORATION_PENDING' AND NEW.kind='RESTORATION_CLAIMED'))
   OR (NOT OLD.hold ? 'restorationReceipt' AND NEW.hold ? 'restorationReceipt' AND OLD.kind<>'RESTORATION_CLAIMED')
   THEN RAISE EXCEPTION 'v3 availability audit is out of phase' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- migrate:down
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM public.m5_restoration_no_dispatch_consumptions)
 OR EXISTS(SELECT FROM public.m5_activation_state WHERE hold#>'{restorationClaim}' ? 'settledNoDispatchReceiptDigest')
 THEN RAISE EXCEPTION 'used restoration recovery requires forward-compatible retention'; END IF;
END $guard$;
DO $restore$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.enforce_activation_v3_audit_before_no_dispatch()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.enforce_activation_v3_audit_before_no_dispatch()','FUNCTION public.enforce_activation_v3_audit()');
 definition:=pg_get_functiondef('public.m5_v3_hold_before_no_dispatch(jsonb)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.m5_v3_hold_before_no_dispatch(','FUNCTION public.m5_v3_hold(');
END $restore$;
DROP TABLE public.m5_restoration_no_dispatch_consumptions;
DROP FUNCTION public.guard_restoration_no_dispatch_audit();
DROP FUNCTION public.enforce_activation_v3_audit_before_no_dispatch();
DROP FUNCTION public.m5_v3_hold_before_no_dispatch(jsonb);
