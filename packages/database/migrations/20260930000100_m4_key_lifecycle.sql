-- migrate:up
-- Historical immutable quote rows are deliberately not rewritten. An installation with
-- nonnumeric candidate key IDs needs explicit operator reconciliation before this migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM quote_authorization_sets WHERE CASE
    WHEN key_id ~ '^[1-9][0-9]{0,4}$' THEN key_id::integer > 65535
    ELSE true END) THEN
    RAISE EXCEPTION 'nonnumeric or out-of-range authorization key ID needs reconciliation';
  END IF;
END $$;
ALTER TABLE quote_authorization_sets DROP CONSTRAINT quote_authorization_sets_key_id_check;
ALTER TABLE quote_authorization_sets
  ALTER COLUMN key_id TYPE integer USING key_id::integer,
  ADD CONSTRAINT quote_authorization_key_id_u16 CHECK (key_id BETWEEN 1 AND 65535);

CREATE TABLE signing_keys (
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  authorization_generation uuid NOT NULL,
  key_id integer NOT NULL CHECK (key_id BETWEEN 1 AND 65535),
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
  public_key_fingerprint text NOT NULL CHECK (public_key_fingerprint ~ '^[a-f0-9]{64}$'),
  private_envelope jsonb,
  wrapping_key_id text,
  state text NOT NULL CHECK (state IN ('pending', 'active', 'retiring', 'revoked', 'destroyed')),
  first_valid_day integer NOT NULL,
  last_valid_day integer NOT NULL CHECK (last_valid_day >= first_valid_day),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  revocation_command_key text,
  destroyed_at timestamptz,
  PRIMARY KEY (shop_id, installation_generation, key_id),
  UNIQUE (shop_id, installation_generation, public_key_fingerprint),
  FOREIGN KEY (shop_id, installation_generation)
    REFERENCES installation_generations(shop_id, generation),
  CHECK ((state = 'destroyed' AND private_envelope IS NULL AND wrapping_key_id IS NULL)
    OR (state <> 'destroyed' AND private_envelope IS NOT NULL
      AND wrapping_key_id IS NOT NULL AND wrapping_key_id <> '')),
  CHECK (state <> 'revoked' OR
    (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revocation_reason <> ''
      AND revocation_command_key IS NOT NULL AND revocation_command_key <> ''))
);
CREATE UNIQUE INDEX signing_keys_one_active_issuer
  ON signing_keys(shop_id, installation_generation) WHERE state = 'active';

CREATE FUNCTION enforce_signing_key_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_uuid uuid;
BEGIN
  SELECT authorization_generation INTO generation_uuid FROM installation_generations
    WHERE shop_id = NEW.shop_id AND generation = NEW.installation_generation;
  IF generation_uuid IS DISTINCT FROM NEW.authorization_generation THEN
    RAISE EXCEPTION 'signing key authorization generation mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.shop_id, NEW.installation_generation,
    NEW.authorization_generation, NEW.key_id, NEW.public_key, NEW.public_key_fingerprint,
    NEW.first_valid_day, NEW.last_valid_day, NEW.created_at)
    IS DISTINCT FROM (OLD.shop_id, OLD.installation_generation,
    OLD.authorization_generation, OLD.key_id, OLD.public_key, OLD.public_key_fingerprint,
    OLD.first_valid_day, OLD.last_valid_day, OLD.created_at) THEN
    RAISE EXCEPTION 'signing key identity and window are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER signing_key_identity_guard BEFORE INSERT OR UPDATE ON signing_keys
  FOR EACH ROW EXECUTE FUNCTION enforce_signing_key_identity();

CREATE TABLE authorization_epoch_commands (
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  command_key text NOT NULL CHECK (length(command_key) BETWEEN 1 AND 128),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  previous_epoch bigint NOT NULL CHECK (previous_epoch BETWEEN 0 AND 4294967294),
  resulting_epoch bigint NOT NULL CHECK (resulting_epoch = previous_epoch + 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (shop_id, installation_generation, command_key),
  FOREIGN KEY (shop_id, installation_generation)
    REFERENCES installation_generations(shop_id, generation)
);

-- migrate:down
DROP TABLE authorization_epoch_commands;
DROP TRIGGER signing_key_identity_guard ON signing_keys;
DROP FUNCTION enforce_signing_key_identity();
DROP TABLE signing_keys;
ALTER TABLE quote_authorization_sets DROP CONSTRAINT quote_authorization_key_id_u16;
ALTER TABLE quote_authorization_sets ALTER COLUMN key_id TYPE text USING key_id::text;
ALTER TABLE quote_authorization_sets ADD CONSTRAINT quote_authorization_sets_key_id_check CHECK (key_id <> '');
