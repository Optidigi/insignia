-- migrate:up
-- Financial qualification only: no meter, delivery, allowance counter or runtime grants.
CREATE TABLE m9_order_usage (
 purchase_id uuid PRIMARY KEY,
 shop_id text NOT NULL, installation_generation bigint NOT NULL CHECK(installation_generation>0),
 order_id text NOT NULL,
 first_paid_at timestamptz CHECK(first_paid_at IS NULL OR isfinite(first_paid_at)),
 qualification text NOT NULL CHECK(qualification IN ('EXCLUDED','PENDING_PAYMENT','UNRESOLVED','WAIVED_TRIAL','UNBILLABLE_INACTIVE','ELIGIBLE')),
 decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object' AND octet_length(decision::text)<=8192),
 history_policy_hash text NOT NULL CHECK(history_policy_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(shop_id,order_id),
 FOREIGN KEY(shop_id,installation_generation,purchase_id) REFERENCES purchase_orders(shop_id,installation_generation,purchase_id)
);
CREATE FUNCTION guard_m9_order_usage() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source_order public.purchase_orders%ROWTYPE; source_paid timestamptz; bound boolean; expected jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'usage facts cannot be deleted' USING ERRCODE='check_violation'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.purchase_id,NEW.shop_id,NEW.installation_generation,NEW.order_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.purchase_id,OLD.shop_id,OLD.installation_generation,OLD.order_id,OLD.created_at) THEN
   RAISE EXCEPTION 'usage identity is immutable' USING ERRCODE='check_violation'; END IF;
  IF OLD.qualification IN ('EXCLUDED','WAIVED_TRIAL','UNBILLABLE_INACTIVE','ELIGIBLE') THEN
   RAISE EXCEPTION 'terminal usage qualification is immutable' USING ERRCODE='check_violation'; END IF;
  IF OLD.first_paid_at IS NOT NULL AND NEW.first_paid_at IS DISTINCT FROM OLD.first_paid_at THEN
   RAISE EXCEPTION 'first-paid usage occurrence is immutable' USING ERRCODE='check_violation'; END IF;
 END IF;
 SELECT * INTO source_order FROM public.purchase_orders WHERE purchase_id=NEW.purchase_id;
 IF NOT FOUND OR ROW(source_order.shop_id,source_order.installation_generation,source_order.order_id)
    IS DISTINCT FROM ROW(NEW.shop_id,NEW.installation_generation,NEW.order_id) THEN
  RAISE EXCEPTION 'usage purchase identity mismatch' USING ERRCODE='check_violation'; END IF;
 SELECT occurred_at INTO source_paid FROM public.purchase_paid_facts
  WHERE purchase_id=NEW.purchase_id AND shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation;
 IF NEW.first_paid_at IS DISTINCT FROM source_paid THEN
  RAISE EXCEPTION 'usage occurrence requires the actual first-paid fact' USING ERRCODE='check_violation'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.purchase_bindings WHERE purchase_id=NEW.purchase_id
  AND shop_id=NEW.shop_id AND installation_generation=NEW.installation_generation) INTO bound;
 IF NEW.qualification IN ('ELIGIBLE','WAIVED_TRIAL','UNBILLABLE_INACTIVE') AND
   (source_order.is_test IS DISTINCT FROM false OR NOT bound OR source_paid IS NULL) THEN
  RAISE EXCEPTION 'usage requires non-test bound first-paid purchase facts' USING ERRCODE='check_violation'; END IF;
 IF NEW.qualification='EXCLUDED' THEN
  IF source_order.is_test IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'only an immutable test fact proves purchase exclusion' USING ERRCODE='check_violation'; END IF;
  expected:=jsonb_build_object('kind','EXCLUDED','units',0,'reason','TEST_ORDER');
 ELSIF NEW.qualification='PENDING_PAYMENT' THEN
  IF source_paid IS NOT NULL OR source_order.is_test IS DISTINCT FROM false OR NOT bound THEN
   RAISE EXCEPTION 'pending payment requires a bound unpaid non-test purchase' USING ERRCODE='check_violation'; END IF;
  expected:=jsonb_build_object('kind','PENDING_PAYMENT','units',0);
 ELSIF NEW.qualification='UNRESOLVED' THEN
  IF NEW.decision->>'reason' IS NULL OR NEW.decision->>'reason' NOT IN
   ('TEST_STATUS_UNKNOWN','CUSTOMIZATION_UNVERIFIED','INVALID_PURCHASE_FACTS','HISTORY_UNAVAILABLE','HISTORY_UNVERIFIED',
    'HISTORY_SCOPE_MISMATCH','INVALID_HISTORY','HISTORY_OVERLAP','HISTORY_GAP','POLICY_MISMATCH','PERIOD_MISMATCH') THEN
   RAISE EXCEPTION 'unknown usage hold reason' USING ERRCODE='check_violation'; END IF;
  expected:=jsonb_build_object('kind','UNRESOLVED','units',0,'reason',NEW.decision->>'reason');
 ELSE
  -- Domain occurrences are normalized UTC milliseconds. Compare their instant to the source; do not restamp it.
  IF jsonb_typeof(NEW.decision->'occurredAt') IS DISTINCT FROM 'string' OR
    (NEW.decision->>'occurredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' OR
    (NEW.decision->>'occurredAt')::timestamptz IS DISTINCT FROM source_paid THEN
   RAISE EXCEPTION 'usage decision occurrence mismatch' USING ERRCODE='check_violation'; END IF;
  expected:=jsonb_build_object('kind',NEW.qualification,'units',CASE WHEN NEW.qualification='ELIGIBLE' THEN 1 ELSE 0 END,
   'shopId',NEW.shop_id,'installationGeneration',NEW.installation_generation::text,'orderId',NEW.order_id,
   'occurredAt',NEW.decision->>'occurredAt');
  IF NEW.qualification='ELIGIBLE' THEN
   IF jsonb_typeof(NEW.decision->'policy') IS DISTINCT FROM 'object' OR
    jsonb_typeof(NEW.decision->'policy'->'id') IS DISTINCT FROM 'string' OR
    jsonb_typeof(NEW.decision->'policy'->'version') IS DISTINCT FROM 'string' OR
    jsonb_typeof(NEW.decision->'cycleId') IS DISTINCT FROM 'string' OR
    length(NEW.decision->'policy'->>'id') NOT BETWEEN 1 AND 256 OR
    length(NEW.decision->'policy'->>'version') NOT BETWEEN 1 AND 256 OR
    length(NEW.decision->>'cycleId') NOT BETWEEN 1 AND 256 OR
    (NEW.decision->'policy'->>'id') ~ '[[:space:][:cntrl:]]' OR
    (NEW.decision->'policy'->>'version') ~ '[[:space:][:cntrl:]]' OR
    (NEW.decision->>'cycleId') ~ '[[:space:][:cntrl:]]' OR
    NEW.decision->'policy' <> jsonb_build_object('id',NEW.decision->'policy'->>'id','version',NEW.decision->'policy'->>'version') THEN
    RAISE EXCEPTION 'usage decision policy identity invalid' USING ERRCODE='check_violation'; END IF;
   expected:=expected||jsonb_build_object('policy',NEW.decision->'policy','cycleId',NEW.decision->>'cycleId');
  END IF;
 END IF;
 IF NEW.decision IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'usage decision contains mismatched or nonfinancial fields' USING ERRCODE='check_violation'; END IF;
 IF TG_OP='INSERT' THEN NEW.created_at:=clock_timestamp(); END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END; $$;
CREATE TRIGGER m9_order_usage_guard BEFORE INSERT OR UPDATE OR DELETE ON m9_order_usage
 FOR EACH ROW EXECUTE FUNCTION guard_m9_order_usage();
REVOKE ALL ON m9_order_usage FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_m9_order_usage() FROM PUBLIC;
-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM m9_order_usage) THEN RAISE EXCEPTION 'persisted usage facts prevent rollback'; END IF;
END $$;
DROP TABLE m9_order_usage;
DROP FUNCTION guard_m9_order_usage();
