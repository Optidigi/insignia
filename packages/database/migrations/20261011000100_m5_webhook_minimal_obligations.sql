-- migrate:up
-- Collection expiration is authority only for this exact receipt's raw bytes.
-- These body-bound facts are NOT topic, generation, uninstall or privacy-purpose authority.
CREATE TABLE webhook_obligation_facts (
  inbox_id uuid PRIMARY KEY REFERENCES inbox_messages(id),
  raw_body_sha256 text NOT NULL CHECK(raw_body_sha256 ~ '^[a-f0-9]{64}$'),
  collected_at timestamptz NOT NULL CHECK(isfinite(collected_at)),
  fulfill_by timestamptz NOT NULL CHECK(isfinite(fulfill_by)),
  forget_after timestamptz NOT NULL CHECK(isfinite(forget_after)),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  purpose text NOT NULL DEFAULT 'UNQUALIFIED' CHECK(purpose='UNQUALIFIED'),
  captured_fields jsonb NOT NULL CHECK(jsonb_typeof(captured_fields)='object'),
  facts_erased_at timestamptz,
  CHECK(fulfill_by=collected_at+interval '30 days'),
  CHECK(forget_after>collected_at AND forget_after<=collected_at+interval '180 days'),
  CHECK(facts_erased_at IS NULL OR (isfinite(facts_erased_at) AND captured_fields='{}'::jsonb))
);
REVOKE ALL ON webhook_obligation_facts FROM PUBLIC;

-- Minimal obligation provenance is immutable. Collection caps can only shorten;
-- the sole permitted content rewrite is irreversible erasure to an empty object.
CREATE FUNCTION guard_webhook_obligation_facts() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'webhook obligation evidence cannot be removed' USING ERRCODE='check_violation';
  END IF;
  IF NEW.inbox_id IS DISTINCT FROM OLD.inbox_id OR NEW.raw_body_sha256 IS DISTINCT FROM OLD.raw_body_sha256
    OR NEW.collected_at IS DISTINCT FROM OLD.collected_at OR NEW.fulfill_by IS DISTINCT FROM OLD.fulfill_by
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.forget_after>OLD.forget_after
    OR (NEW.captured_fields IS DISTINCT FROM OLD.captured_fields AND
      (NEW.captured_fields<>'{}'::jsonb OR NEW.facts_erased_at IS NULL))
    OR (OLD.facts_erased_at IS NOT NULL AND NEW.facts_erased_at IS DISTINCT FROM OLD.facts_erased_at)
  THEN RAISE EXCEPTION 'webhook obligation provenance cannot be rewritten' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_obligation_facts_rewrite BEFORE UPDATE OR DELETE ON webhook_obligation_facts
FOR EACH ROW EXECUTE FUNCTION guard_webhook_obligation_facts();
CREATE TRIGGER webhook_obligation_facts_truncate BEFORE TRUNCATE ON webhook_obligation_facts
FOR EACH STATEMENT EXECUTE FUNCTION guard_webhook_obligation_facts();


CREATE FUNCTION expire_shopify_webhook_bytes(candidate_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  receipt public.inbox_messages%ROWTYPE;
  body jsonb; fields jsonb:='{}'::jsonb; customer jsonb; values_array jsonb;
  field text; parsed boolean:=true; now_at timestamptz;
BEGIN
  SELECT * INTO receipt FROM public.inbox_messages WHERE id=candidate_id FOR UPDATE;
  now_at:=clock_timestamp();
  IF NOT FOUND OR receipt.source<>'shopify' OR receipt.retention_class<>'shopify-webhook'
    OR receipt.erasure_state='erased' OR NOT coalesce(isfinite(receipt.purge_after) AND receipt.purge_after<=now_at,false)
  THEN RETURN false; END IF;
  IF encode(sha256(receipt.payload),'hex')<>receipt.payload_sha256 THEN
    parsed:=false; fields:='{"payloadIntegrityMismatch":true}'::jsonb;
  END IF;
  BEGIN
    body:=convert_from(receipt.payload,'UTF8')::jsonb;
    IF jsonb_typeof(body)<>'object' THEN parsed:=false; END IF;
  EXCEPTION WHEN invalid_text_representation OR character_not_in_repertoire THEN parsed:=false;
  END;
  IF parsed THEN
    -- Parse IDs in PostgreSQL JSONB, then store exact decimal strings for safe readers.
    FOREACH field IN ARRAY ARRAY['id','shop_id'] LOOP
      IF jsonb_typeof(body->field) IN ('number','string') AND body->>field ~ '^[1-9][0-9]*$'
      THEN fields:=fields||jsonb_build_object(field,body->>field); END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['shop_domain','myshopify_domain'] LOOP
      IF jsonb_typeof(body->field)='string' AND body->>field ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
      THEN fields:=fields||jsonb_build_object(field,body->>field); END IF;
    END LOOP;
    IF jsonb_typeof(body->'customer')='object' THEN
      customer:=body->'customer';
      IF jsonb_typeof(customer->'id') IN ('number','string') AND customer->>'id' ~ '^[1-9][0-9]*$'
      THEN fields:=fields||jsonb_build_object('customer',jsonb_build_object('id',customer->>'id'));
      ELSIF jsonb_typeof(customer->'email')='string' AND length(customer->>'email') BETWEEN 1 AND 320
      THEN fields:=fields||jsonb_build_object('customer',jsonb_build_object('email',customer->'email'));
      ELSE fields:=fields||'{"unsupportedCustomerIdentity":true}'::jsonb; END IF;
    END IF;
    FOREACH field IN ARRAY ARRAY['orders_requested','orders_to_redact'] LOOP
      IF body ? field THEN
        IF jsonb_typeof(body->field)='array' THEN
          SELECT coalesce(jsonb_agg(to_jsonb(item#>>'{}') ORDER BY ordinal),'[]'::jsonb) INTO values_array
          FROM jsonb_array_elements(body->field) WITH ORDINALITY AS a(item,ordinal)
          WHERE jsonb_typeof(item) IN ('number','string') AND item#>>'{}' ~ '^[1-9][0-9]*$';
          fields:=fields||jsonb_build_object(field,values_array);
          IF jsonb_array_length(values_array)<>jsonb_array_length(body->field)
          THEN fields:=fields||'{"unsupportedOrderIdentity":true}'::jsonb; END IF;
        ELSE fields:=fields||'{"unsupportedOrderIdentity":true}'::jsonb; END IF;
      END IF;
    END LOOP;
    -- Preserve only bounded pseudonymous financial claims needed to triage
    -- mixed obligations. These are unqualified received claims, never accepted
    -- purchase/economic truth. Decimal strings are copied without rounding.
    IF body ? 'currency' THEN
      IF jsonb_typeof(body->'currency')='string' AND body->>'currency' ~ '^[A-Z]{3}$'
      THEN fields:=fields||jsonb_build_object('currency',body->'currency');
      ELSE fields:=fields||'{"unsupportedFinancialClaim":true}'::jsonb; END IF;
    END IF;
    IF body ? 'total_price' THEN
      IF jsonb_typeof(body->'total_price')='string' AND length(body->>'total_price')<=40
        AND body->>'total_price' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN fields:=fields||jsonb_build_object('total_price',body->'total_price');
      ELSE fields:=fields||'{"unsupportedFinancialClaim":true}'::jsonb; END IF;
    END IF;
    IF body ? 'transaction_ids' THEN
      IF jsonb_typeof(body->'transaction_ids')='array' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(item#>>'{}') ORDER BY ordinal),'[]'::jsonb) INTO values_array
        FROM jsonb_array_elements(body->'transaction_ids') WITH ORDINALITY AS a(item,ordinal)
        WHERE jsonb_typeof(item) IN ('number','string') AND item#>>'{}' ~ '^[1-9][0-9]*$';
        fields:=fields||jsonb_build_object('transaction_ids',values_array);
        IF jsonb_array_length(values_array)<>jsonb_array_length(body->'transaction_ids')
        THEN fields:=fields||'{"unsupportedFinancialClaim":true}'::jsonb; END IF;
      ELSE fields:=fields||'{"unsupportedFinancialClaim":true}'::jsonb; END IF;
    END IF;
    IF jsonb_typeof(body->'data_request'->'id') IN ('number','string') AND body->'data_request'->>'id' ~ '^[1-9][0-9]*$'
    THEN fields:=fields||jsonb_build_object('data_request',jsonb_build_object('id',body->'data_request'->>'id')); END IF;
  ELSE fields:=fields||'{"unsupportedBody":true}'::jsonb; END IF;
  INSERT INTO public.webhook_obligation_facts(inbox_id,raw_body_sha256,collected_at,fulfill_by,forget_after,captured_fields)
  VALUES(receipt.id,receipt.payload_sha256,receipt.collected_at,receipt.collected_at+interval '30 days',receipt.collected_at+interval '180 days',fields);
  UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',lease_owner=NULL,lease_until=NULL WHERE id=receipt.id;
  UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=true WHERE inbox_id=receipt.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION expire_shopify_webhook_bytes(uuid) FROM PUBLIC;

CREATE FUNCTION expire_shopify_webhook_facts(maximum_rows integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE affected integer;
BEGIN
  IF maximum_rows IS NULL OR maximum_rows<1 OR maximum_rows>100 THEN RAISE EXCEPTION 'invalid fact erasure limit'; END IF;
  WITH candidates AS (
    SELECT inbox_id FROM public.webhook_obligation_facts
    WHERE facts_erased_at IS NULL AND forget_after<=clock_timestamp()
    ORDER BY forget_after,inbox_id LIMIT maximum_rows FOR UPDATE SKIP LOCKED
  ) UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=clock_timestamp()
    WHERE inbox_id IN (SELECT inbox_id FROM candidates);
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION expire_shopify_webhook_facts(integer) FROM PUBLIC;
-- Bounded diagnostics survive raw/fact erasure. Routing metadata remains
-- classification evidence only, never request-purpose or generation authority.
CREATE FUNCTION pending_shopify_webhook_obligations(maximum_rows integer)
RETURNS TABLE(id uuid, state text, topic text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF maximum_rows IS NULL OR maximum_rows<1 OR maximum_rows>100 THEN RAISE EXCEPTION 'invalid obligation limit'; END IF;
  RETURN QUERY SELECT inbox.id,inbox.state::text,delivery.topic::text
    FROM public.webhook_obligation_facts facts
    JOIN public.inbox_messages inbox ON inbox.id=facts.inbox_id
    LEFT JOIN public.shopify_webhook_deliveries delivery ON delivery.inbox_id=inbox.id
    ORDER BY facts.fulfill_by,facts.inbox_id LIMIT maximum_rows;
END $$;
REVOKE ALL ON FUNCTION pending_shopify_webhook_obligations(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    GRANT EXECUTE ON FUNCTION expire_shopify_webhook_bytes(uuid),expire_shopify_webhook_facts(integer),pending_shopify_webhook_obligations(integer) TO insignia_queue_consume;
  END IF;
END $$;

-- migrate:down
-- Never delete pending privacy facts, even after payload expiration.
LOCK TABLE webhook_obligation_facts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM webhook_obligation_facts) THEN
  RAISE EXCEPTION 'webhook obligation evidence prevents rollback' USING ERRCODE='check_violation';
 END IF;
END $$;
DROP FUNCTION pending_shopify_webhook_obligations(integer);
DROP FUNCTION expire_shopify_webhook_bytes(uuid);
DROP FUNCTION expire_shopify_webhook_facts(integer);
DROP TABLE webhook_obligation_facts;
DROP FUNCTION guard_webhook_obligation_facts();
