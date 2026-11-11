-- migrate:up
-- Owner decision, 11 November 2026: a signing key keeps its private half only while it can sign
-- (pending or active). Retiring, revoked and destroyed keys keep their public key and window, so the
-- Function config still verifies outstanding carts until the window closes, but their envelope is
-- scrubbed. The scrub is one-way. Existing retiring/revoked envelopes are scrubbed here.
LOCK TABLE signing_keys IN SHARE ROW EXCLUSIVE MODE;
-- The previous constraint requires an envelope on every non-destroyed key, so it goes first.
DO $$ DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint
    WHERE conrelid = 'public.signing_keys'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%private_envelope IS NULL%';
  EXECUTE format('ALTER TABLE public.signing_keys DROP CONSTRAINT %I', constraint_name);
END $$;
UPDATE signing_keys SET private_envelope = NULL, wrapping_key_id = NULL
  WHERE state IN ('retiring', 'revoked') AND private_envelope IS NOT NULL;
ALTER TABLE signing_keys ADD CONSTRAINT signing_keys_private_half_by_state CHECK (
  (state IN ('pending', 'active') AND private_envelope IS NOT NULL
    AND wrapping_key_id IS NOT NULL AND wrapping_key_id <> '')
  OR (state IN ('retiring', 'revoked', 'destroyed') AND private_envelope IS NULL AND wrapping_key_id IS NULL));

CREATE OR REPLACE FUNCTION enforce_signing_key_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_uuid uuid;
BEGIN
  SELECT authorization_generation INTO generation_uuid FROM installation_generations
    WHERE shop_id = NEW.shop_id AND generation = NEW.installation_generation;
  IF generation_uuid IS DISTINCT FROM NEW.authorization_generation THEN
    RAISE EXCEPTION 'signing key authorization generation mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.shop_id, NEW.installation_generation,
    NEW.authorization_generation, NEW.key_id, NEW.public_key, NEW.public_key_fingerprint,
    NEW.first_valid_day, NEW.created_at)
    IS DISTINCT FROM (OLD.shop_id, OLD.installation_generation,
    OLD.authorization_generation, OLD.key_id, OLD.public_key, OLD.public_key_fingerprint,
    OLD.first_valid_day, OLD.created_at) THEN
    RAISE EXCEPTION 'signing key identity and window are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_valid_day IS DISTINCT FROM OLD.last_valid_day AND NOT (
    NEW.last_valid_day < OLD.last_valid_day AND NEW.last_valid_day >= NEW.first_valid_day
    AND OLD.state IN ('pending', 'active', 'retiring', 'revoked') AND NEW.state IN ('active', 'retiring', 'revoked')) THEN
    RAISE EXCEPTION 'signing key window may only shorten on an active, retiring or revoked key' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.private_envelope IS NULL AND NEW.private_envelope IS NOT NULL THEN
    RAISE EXCEPTION 'a scrubbed signing key private half cannot be restored' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state IN ('retiring', 'revoked', 'destroyed') AND NEW.state IN ('pending', 'active') THEN
    RAISE EXCEPTION 'a retired signing key cannot sign again' USING ERRCODE = 'check_violation';
  END IF;
  -- Revocation and destruction are final: a revoked key may only be destroyed; a destroyed key stays so.
  IF TG_OP = 'UPDATE' AND ((OLD.state = 'revoked' AND NEW.state NOT IN ('revoked', 'destroyed'))
    OR (OLD.state = 'destroyed' AND NEW.state <> 'destroyed')) THEN
    RAISE EXCEPTION 'a revoked or destroyed signing key cannot be restored' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Daily worker maintenance: a retired key whose window closed (conservative UTC rule shared with
-- the repository's destroy) becomes destroyed. Only state and destroyed_at change; no key material
-- is ever readable through this function.
CREATE FUNCTION destroy_expired_signing_keys(maximum_rows integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE affected integer;
BEGIN
  IF maximum_rows IS NULL OR maximum_rows < 1 OR maximum_rows > 100 THEN RAISE EXCEPTION 'invalid signing key destruction limit'; END IF;
  WITH candidates AS (
    SELECT shop_id, installation_generation, key_id FROM public.signing_keys
    WHERE state IN ('retiring', 'revoked')
      AND last_valid_day < (floor(extract(epoch from clock_timestamp()) / 86400)::int - 1)
    ORDER BY shop_id, installation_generation, key_id LIMIT maximum_rows FOR UPDATE SKIP LOCKED
  ) UPDATE public.signing_keys k SET state = 'destroyed', destroyed_at = clock_timestamp()
    FROM candidates c WHERE k.shop_id = c.shop_id AND k.installation_generation = c.installation_generation
      AND k.key_id = c.key_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION destroy_expired_signing_keys(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insignia_queue_consume') THEN
    GRANT EXECUTE ON FUNCTION destroy_expired_signing_keys(integer) TO insignia_queue_consume;
  END IF;
END $$;

-- migrate:down
-- Scrubbed private halves cannot be restored; the previous constraint only fits if none exist.
DROP FUNCTION destroy_expired_signing_keys(integer);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM signing_keys WHERE state IN ('retiring', 'revoked') AND private_envelope IS NULL) THEN
    RAISE EXCEPTION 'scrubbed signing key private halves prevent rollback' USING ERRCODE = 'check_violation';
  END IF;
END $$;
ALTER TABLE signing_keys DROP CONSTRAINT signing_keys_private_half_by_state;
ALTER TABLE signing_keys ADD CONSTRAINT signing_keys_check1 CHECK (
  (state = 'destroyed' AND private_envelope IS NULL AND wrapping_key_id IS NULL)
  OR (state <> 'destroyed' AND private_envelope IS NOT NULL AND wrapping_key_id IS NOT NULL AND wrapping_key_id <> ''));
CREATE OR REPLACE FUNCTION enforce_signing_key_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_uuid uuid;
BEGIN
  SELECT authorization_generation INTO generation_uuid FROM installation_generations
    WHERE shop_id = NEW.shop_id AND generation = NEW.installation_generation;
  IF generation_uuid IS DISTINCT FROM NEW.authorization_generation THEN
    RAISE EXCEPTION 'signing key authorization generation mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.shop_id, NEW.installation_generation,
    NEW.authorization_generation, NEW.key_id, NEW.public_key, NEW.public_key_fingerprint,
    NEW.first_valid_day, NEW.created_at)
    IS DISTINCT FROM (OLD.shop_id, OLD.installation_generation,
    OLD.authorization_generation, OLD.key_id, OLD.public_key, OLD.public_key_fingerprint,
    OLD.first_valid_day, OLD.created_at) THEN
    RAISE EXCEPTION 'signing key identity and window are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_valid_day IS DISTINCT FROM OLD.last_valid_day AND NOT (
    NEW.last_valid_day < OLD.last_valid_day AND NEW.last_valid_day >= NEW.first_valid_day
    AND OLD.state IN ('pending', 'active', 'retiring', 'revoked') AND NEW.state IN ('active', 'retiring', 'revoked')) THEN
    RAISE EXCEPTION 'signing key window may only shorten on an active, retiring or revoked key' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
