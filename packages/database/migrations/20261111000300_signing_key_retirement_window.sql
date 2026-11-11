-- migrate:up
-- Owner decision, 11 November 2026: signing keys no longer expire routinely; a new key's last
-- valid day is the integer maximum. A key's window may now be shortened (never extended) when it is
-- or becomes active, retiring or revoked (a pending key only by revocation), so a retired key stops verifying a few shop days after
-- retirement and the existing destruction window can close. Identity stays immutable.
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
-- migrate:down
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
    NEW.first_valid_day, NEW.last_valid_day, NEW.created_at)
    IS DISTINCT FROM (OLD.shop_id, OLD.installation_generation,
    OLD.authorization_generation, OLD.key_id, OLD.public_key, OLD.public_key_fingerprint,
    OLD.first_valid_day, OLD.last_valid_day, OLD.created_at) THEN
    RAISE EXCEPTION 'signing key identity and window are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
