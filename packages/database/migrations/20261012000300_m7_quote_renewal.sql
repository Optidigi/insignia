-- migrate:up
CREATE TABLE quote_authorization_renewals (
  set_id uuid PRIMARY KEY,
  quote_id uuid NOT NULL,
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  owner_binding text NOT NULL CHECK (owner_binding ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  material_hash text NOT NULL CHECK (material_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL CHECK (isfinite(issued_at)),
  issued_date date NOT NULL,
  issued_day integer NOT NULL CHECK (issued_day >= 0 AND issued_date = DATE '1970-01-01' + issued_day),
  shop_timezone text NOT NULL CHECK (shop_timezone <> ''),
  valid_through_day integer NOT NULL CHECK (valid_through_day = issued_day + 2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(shop_id, installation_generation, idempotency_key),
  FOREIGN KEY(shop_id, installation_generation, quote_id)
    REFERENCES accepted_quotes(shop_id, installation_generation, quote_id),
  FOREIGN KEY(set_id) REFERENCES quote_authorization_sets(set_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER quote_authorization_renewals_immutable BEFORE UPDATE OR DELETE ON quote_authorization_renewals
  FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();

CREATE FUNCTION enforce_quote_renewal_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote accepted_quotes%ROWTYPE;
BEGIN
  SELECT q.* INTO quote FROM accepted_quotes q
    JOIN buyer_quote_ownership b ON b.shop_id=q.shop_id AND b.installation_generation=q.installation_generation
      AND b.quote_id=q.quote_id AND b.owner_binding=NEW.owner_binding
    JOIN shops s ON s.shop_id=q.shop_id AND s.current_generation=q.installation_generation
    JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
    WHERE q.shop_id=NEW.shop_id AND q.installation_generation=NEW.installation_generation AND q.quote_id=NEW.quote_id
      AND i.deactivated_at IS NULL AND i.authorization_generation=q.authorization_generation
      AND i.authorization_epoch=q.authorization_epoch FOR UPDATE OF s,i;
  IF NOT FOUND OR quote.shop_timezone <> NEW.shop_timezone OR
     timezone(NEW.shop_timezone,NEW.issued_at)::date <> NEW.issued_date THEN
    RAISE EXCEPTION 'renewal owner, installation or local date fence failed' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_authorization_renewals_insert_guard BEFORE INSERT ON quote_authorization_renewals
  FOR EACH ROW EXECUTE FUNCTION enforce_quote_renewal_insert();

CREATE OR REPLACE FUNCTION enforce_quote_authorization_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote accepted_quotes%ROWTYPE;
DECLARE current_authorization uuid;
DECLARE current_epoch bigint;
DECLARE renewal quote_authorization_renewals%ROWTYPE;
DECLARE issuance_day integer;
DECLARE expiry_day integer;
DECLARE member jsonb;
DECLARE member_ordinal bigint;
BEGIN
  SELECT i.authorization_generation, i.authorization_epoch
    INTO current_authorization, current_epoch
    FROM shops s JOIN installation_generations i
      ON i.shop_id = s.shop_id AND i.generation = s.current_generation
    WHERE s.shop_id = NEW.shop_id AND s.current_generation = NEW.installation_generation
      AND i.deactivated_at IS NULL FOR UPDATE OF s, i;
  IF NOT FOUND OR current_authorization IS DISTINCT FROM NEW.authorization_generation OR
     current_epoch IS DISTINCT FROM NEW.authorization_epoch THEN
    RAISE EXCEPTION 'authorization set installation fence failed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO quote FROM accepted_quotes WHERE quote_id = NEW.quote_id AND shop_id = NEW.shop_id
    AND installation_generation = NEW.installation_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorization quote missing' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO renewal FROM quote_authorization_renewals WHERE set_id = NEW.set_id;
  IF FOUND THEN
    IF renewal.quote_id <> NEW.quote_id OR renewal.shop_id <> NEW.shop_id OR
       renewal.installation_generation <> NEW.installation_generation THEN
      RAISE EXCEPTION 'renewal quote identity mismatch' USING ERRCODE = 'check_violation';
    END IF;
    issuance_day := renewal.issued_day;
    expiry_day := renewal.valid_through_day;
  ELSE
    issuance_day := quote.accepted_day;
    expiry_day := quote.valid_through_day;
  END IF;
  IF quote.authorization_generation <> NEW.authorization_generation OR
     quote.authorization_epoch <> NEW.authorization_epoch OR
     NEW.first_valid_day > issuance_day OR NEW.last_valid_day < expiry_day OR
     NEW.valid_through_day <> expiry_day OR
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

-- migrate:down
CREATE OR REPLACE FUNCTION enforce_quote_authorization_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote accepted_quotes%ROWTYPE;
DECLARE current_authorization uuid;
DECLARE current_epoch bigint;
DECLARE member jsonb;
DECLARE member_ordinal bigint;
BEGIN
  SELECT i.authorization_generation, i.authorization_epoch
    INTO current_authorization, current_epoch
    FROM shops s JOIN installation_generations i
      ON i.shop_id = s.shop_id AND i.generation = s.current_generation
    WHERE s.shop_id = NEW.shop_id AND s.current_generation = NEW.installation_generation
      AND i.deactivated_at IS NULL FOR UPDATE OF s, i;
  IF NOT FOUND OR current_authorization IS DISTINCT FROM NEW.authorization_generation OR
     current_epoch IS DISTINCT FROM NEW.authorization_epoch THEN
    RAISE EXCEPTION 'authorization set installation fence failed' USING ERRCODE = 'check_violation';
  END IF;
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
DROP TABLE quote_authorization_renewals;
DROP FUNCTION enforce_quote_renewal_insert();
