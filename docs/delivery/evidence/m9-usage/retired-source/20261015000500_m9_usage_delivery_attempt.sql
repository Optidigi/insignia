-- migrate:up
-- Durable pre-dispatch fence only; no network, credential, retry or billing authority.
CREATE TABLE m9_usage_delivery_attempts (
 attempt_id uuid PRIMARY KEY,
 purchase_id uuid NOT NULL REFERENCES m9_usage_delivery_intents(purchase_id),
 ordinal integer NOT NULL CHECK(ordinal>0),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 outcome jsonb,
 settled_at timestamptz CHECK(settled_at IS NULL OR isfinite(settled_at)),
 UNIQUE(purchase_id,ordinal),
 CHECK((outcome IS NULL)=(settled_at IS NULL))
);
CREATE FUNCTION guard_m9_usage_delivery_attempts() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE latest public.m9_usage_delivery_attempts%ROWTYPE; candidate jsonb; keys text[];
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'usage delivery attempt history is immutable' USING ERRCODE='check_violation'; END IF;
 PERFORM 1 FROM public.m9_usage_delivery_intents WHERE purchase_id=NEW.purchase_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'usage delivery intent required' USING ERRCODE='foreign_key_violation'; END IF;
 SELECT * INTO latest FROM public.m9_usage_delivery_attempts WHERE purchase_id=NEW.purchase_id ORDER BY ordinal DESC LIMIT 1;
 IF TG_OP='INSERT' THEN
  IF NEW.outcome IS NOT NULL OR NEW.settled_at IS NOT NULL OR
   (latest.attempt_id IS NOT NULL AND (latest.outcome IS DISTINCT FROM '{"kind":"NOT_DISPATCHED"}'::jsonb OR latest.body_sha256 IS DISTINCT FROM NEW.body_sha256)) THEN
   RAISE EXCEPTION 'usage delivery attempt remains held or body changed' USING ERRCODE='check_violation'; END IF;
  NEW.attempt_id:=gen_random_uuid(); NEW.ordinal:=coalesce(latest.ordinal,0)+1; NEW.created_at:=clock_timestamp();
 ELSE
  IF ROW(NEW.attempt_id,NEW.purchase_id,NEW.ordinal,NEW.body_sha256,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.attempt_id,OLD.purchase_id,OLD.ordinal,OLD.body_sha256,OLD.created_at) OR
   latest.attempt_id IS DISTINCT FROM OLD.attempt_id OR OLD.outcome IS NOT NULL OR NEW.outcome IS NULL THEN
   RAISE EXCEPTION 'usage delivery attempt settlement is immutable' USING ERRCODE='check_violation'; END IF;
  candidate:=NEW.outcome;
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid usage outcome' USING ERRCODE='check_violation'; END IF;
  SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(candidate) AS fields(key);
  IF ((keys=ARRAY['kind']::text[] AND candidate->>'kind' IN ('NOT_DISPATCHED','UNKNOWN')) OR
    (keys=ARRAY['httpStatus','kind']::text[] AND jsonb_typeof(candidate->'httpStatus')='number' AND
     ((candidate->>'kind'='RECEIPT' AND candidate->>'httpStatus'='202') OR
      (candidate->>'kind'='HTTP' AND candidate->>'httpStatus' ~ '^[1-5][0-9]{2}$')))) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'invalid usage outcome' USING ERRCODE='check_violation'; END IF;
  NEW.settled_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER m9_usage_delivery_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON m9_usage_delivery_attempts
 FOR EACH ROW EXECUTE FUNCTION guard_m9_usage_delivery_attempts();
CREATE TRIGGER m9_usage_delivery_attempts_truncate_guard BEFORE TRUNCATE ON m9_usage_delivery_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION guard_m9_usage_delivery_attempts();
REVOKE ALL ON m9_usage_delivery_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_m9_usage_delivery_attempts() FROM PUBLIC;
-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM m9_usage_delivery_attempts) THEN RAISE EXCEPTION 'persisted usage delivery attempts prevent rollback'; END IF;
END $$;
DROP TABLE m9_usage_delivery_attempts;
DROP FUNCTION guard_m9_usage_delivery_attempts();
