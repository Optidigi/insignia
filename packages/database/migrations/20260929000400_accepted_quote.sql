-- migrate:up
-- Requires 20260929000300 authorization_generation uuid and authorization_epoch
-- bigint (checked to u32) on installation_generations. The integrator owns 000300.
CREATE TABLE accepted_quotes (
  quote_id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  authorization_generation uuid NOT NULL,
  authorization_epoch bigint NOT NULL CHECK (authorization_epoch BETWEEN 0 AND 4294967295),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  schema_version text NOT NULL CHECK (schema_version = 'm4-accepted-quote-v1'),
  accepted_at timestamptz NOT NULL,
  accepted_date date NOT NULL,
  accepted_day integer NOT NULL CHECK (accepted_date = DATE '1970-01-01' + accepted_day),
  valid_through_day integer NOT NULL CHECK (valid_through_day = accepted_day + 2),
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  market_id numeric(20, 0) NOT NULL CHECK (market_id > 0 AND market_id <= 18446744073709551615),
  shop_currency text NOT NULL CHECK (shop_currency ~ '^[A-Z]{3}$'),
  shop_timezone text NOT NULL CHECK (shop_timezone <> ''),
  presentment_currency text NOT NULL CHECK (presentment_currency ~ '^[A-Z]{3}$'),
  presentment_exponent smallint NOT NULL CHECK (presentment_exponent IN (0, 2, 3)),
  policy_version text NOT NULL CHECK (policy_version <> ''),
  recognized_policy_id text NOT NULL CHECK (recognized_policy_id <> ''),
  trial boolean NOT NULL,
  qualifying_usage_disposition text NOT NULL CHECK (qualifying_usage_disposition IN ('WAIVE_TRIAL', 'REQUIRES_EVENT_TIME')),
  customized_quantity integer NOT NULL CHECK (customized_quantity BETWEEN 1 AND 10000),
  total_minor numeric(20, 0) NOT NULL CHECK (total_minor BETWEEN 0 AND 18446744073709551615),
  quote_value jsonb NOT NULL CHECK (jsonb_typeof(quote_value) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (shop_id, installation_generation, idempotency_key),
  UNIQUE (shop_id, installation_generation, quote_id),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id, generation)
);

CREATE TABLE quote_authorization_sets (
  set_id uuid PRIMARY KEY,
  quote_id uuid NOT NULL,
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  authorization_generation uuid NOT NULL,
  authorization_epoch bigint NOT NULL CHECK (authorization_epoch BETWEEN 0 AND 4294967295),
  key_id text NOT NULL CHECK (key_id <> ''),
  public_key_fingerprint text NOT NULL CHECK (public_key_fingerprint <> ''),
  first_valid_day integer NOT NULL,
  last_valid_day integer NOT NULL,
  valid_through_day integer NOT NULL,
  envelope_carrier text NOT NULL CHECK (envelope_carrier <> ''),
  member_carriers jsonb NOT NULL CHECK (jsonb_typeof(member_carriers) = 'array' AND jsonb_array_length(member_carriers) BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (shop_id, installation_generation, quote_id)
    REFERENCES accepted_quotes(shop_id, installation_generation, quote_id)
);

CREATE FUNCTION reject_quote_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'accepted quote and authorization rows are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER accepted_quotes_immutable BEFORE UPDATE OR DELETE ON accepted_quotes
  FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER quote_authorization_sets_immutable BEFORE UPDATE OR DELETE ON quote_authorization_sets
  FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();

CREATE FUNCTION enforce_accepted_quote_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_generation bigint;
DECLARE current_authorization uuid;
DECLARE current_epoch bigint;
DECLARE revision jsonb;
BEGIN
  SELECT s.current_generation, i.authorization_generation, i.authorization_epoch
    INTO active_generation, current_authorization, current_epoch
    FROM shops s JOIN installation_generations i
      ON i.shop_id = s.shop_id AND i.generation = s.current_generation
    WHERE s.shop_id = NEW.shop_id AND i.deactivated_at IS NULL FOR UPDATE OF s;
  IF NOT FOUND OR active_generation IS DISTINCT FROM NEW.installation_generation OR
     current_authorization IS DISTINCT FROM NEW.authorization_generation OR
     current_epoch IS DISTINCT FROM NEW.authorization_epoch THEN
    RAISE EXCEPTION 'accepted quote installation fence failed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quote_value->>'shopId' IS DISTINCT FROM NEW.shop_id OR
     NEW.quote_value->>'installationGeneration' IS DISTINCT FROM NEW.installation_generation::text OR
     NEW.quote_value->>'authorizationGeneration' IS DISTINCT FROM NEW.authorization_generation::text OR
     NEW.quote_value->>'authorizationEpoch' IS DISTINCT FROM NEW.authorization_epoch::text OR
     NEW.quote_value->>'quoteId' IS DISTINCT FROM NEW.quote_id::text OR
     (NEW.quote_value->>'acceptedAt')::timestamptz IS DISTINCT FROM NEW.accepted_at OR
     NEW.quote_value->>'acceptedDate' IS DISTINCT FROM NEW.accepted_date::text OR
     NEW.quote_value->>'acceptedDay' IS DISTINCT FROM NEW.accepted_day::text OR
     NEW.quote_value->>'validThroughDay' IS DISTINCT FROM NEW.valid_through_day::text OR
     NEW.quote_value->>'country' IS DISTINCT FROM NEW.country OR
     NEW.quote_value->>'marketId' IS DISTINCT FROM NEW.market_id::text OR
     NEW.quote_value->>'shopCurrency' IS DISTINCT FROM NEW.shop_currency OR
     NEW.quote_value->>'shopTimezone' IS DISTINCT FROM NEW.shop_timezone OR
     NEW.quote_value->>'presentmentCurrency' IS DISTINCT FROM NEW.presentment_currency OR
     NEW.quote_value->>'presentmentExponent' IS DISTINCT FROM NEW.presentment_exponent::text OR
     NEW.quote_value->>'policyVersion' IS DISTINCT FROM NEW.policy_version OR
     NEW.quote_value->>'recognizedPolicyId' IS DISTINCT FROM NEW.recognized_policy_id OR
     NEW.quote_value->>'trial' IS DISTINCT FROM NEW.trial::text OR
     NEW.quote_value->>'qualifyingUsageDisposition' IS DISTINCT FROM NEW.qualifying_usage_disposition OR
     NEW.quote_value->'economics'->>'totalMinor' IS DISTINCT FROM NEW.total_minor::text OR
     NEW.quote_value->'economics'->>'customizedQuantity' IS DISTINCT FROM NEW.customized_quantity::text OR
     NEW.quote_value->>'schemaVersion' IS DISTINCT FROM NEW.schema_version THEN
    RAISE EXCEPTION 'accepted quote economic columns mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF timezone(NEW.shop_timezone, NEW.accepted_at)::date <> NEW.accepted_date THEN
    RAISE EXCEPTION 'accepted quote shop-local date mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(NEW.quote_value->'effectiveRevisions') <> 'array' OR
     jsonb_array_length(NEW.quote_value->'effectiveRevisions') = 0 THEN
    RAISE EXCEPTION 'accepted quote needs effective revisions' USING ERRCODE = 'check_violation';
  END IF;
  FOR revision IN SELECT value FROM jsonb_array_elements(NEW.quote_value->'effectiveRevisions') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM product_configs c
      JOIN config_revisions r ON r.shop_id = c.shop_id AND r.config_id = c.config_id AND r.revision_id = c.effective_revision_id
      JOIN publication_operations p ON p.shop_id = c.shop_id AND p.config_id = c.config_id AND p.operation_id = c.effective_operation_id
      WHERE c.shop_id = NEW.shop_id AND c.config_id = revision->>'configId'
        AND c.external_product_id = revision->>'productId'
        AND r.revision_id = revision->>'revisionId' AND r.content_hash = revision->>'contentHash'
        AND p.operation_id = revision->>'operationId' AND p.revision_id = r.revision_id
        AND p.installation_generation = NEW.installation_generation
        AND p.status = 'activated' AND p.operation_sequence = c.publication_sequence
        AND p.observed_projection = p.expected_projection
        AND p.observed_projection_digest = p.expected_projection_digest
    ) THEN
      RAISE EXCEPTION 'accepted quote revision is not effective' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accepted_quotes_insert_guard BEFORE INSERT ON accepted_quotes
  FOR EACH ROW EXECUTE FUNCTION enforce_accepted_quote_insert();

CREATE FUNCTION enforce_quote_authorization_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote accepted_quotes%ROWTYPE;
DECLARE member jsonb;
DECLARE member_ordinal bigint;
BEGIN
  SELECT * INTO quote FROM accepted_quotes WHERE quote_id = NEW.quote_id AND shop_id = NEW.shop_id
    AND installation_generation = NEW.installation_generation;
  IF NOT FOUND OR quote.authorization_generation <> NEW.authorization_generation OR
     quote.authorization_epoch <> NEW.authorization_epoch OR
     NEW.first_valid_day > quote.accepted_day OR NEW.last_valid_day < quote.valid_through_day OR
     NEW.valid_through_day <> quote.valid_through_day OR
     jsonb_array_length(NEW.member_carriers) <> jsonb_array_length(quote.quote_value->'economics'->'lines') THEN
    RAISE EXCEPTION 'authorization set does not cover fixed accepted quote' USING ERRCODE = 'check_violation';
  END IF;
  FOR member, member_ordinal IN
    SELECT value, ordinality FROM jsonb_array_elements(NEW.member_carriers) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(member) <> 'object' OR member->>'lineIndex' IS DISTINCT FROM (member_ordinal - 1)::text OR
       coalesce(member->>'carrier', '') = '' THEN
      RAISE EXCEPTION 'authorization set member ordering is invalid' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_authorization_sets_insert_guard BEFORE INSERT ON quote_authorization_sets
  FOR EACH ROW EXECUTE FUNCTION enforce_quote_authorization_insert();

-- migrate:down
DROP TABLE quote_authorization_sets;
DROP TABLE accepted_quotes;
DROP FUNCTION enforce_quote_authorization_insert();
DROP FUNCTION enforce_accepted_quote_insert();
DROP FUNCTION reject_quote_mutation();
