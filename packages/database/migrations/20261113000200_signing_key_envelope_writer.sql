-- migrate:up
-- Only a role that can read private envelopes (the separate signer and the schema owner) may write
-- one. Web keeps UPDATE(private_envelope, wrapping_key_id) solely to scrub a key's private half in
-- the statement that retires, revokes or destroys it; without this guard a compromised web could
-- overwrite the active key's envelope and stop every signature (denial of service, no forgery).
-- The writer is identified by privilege, so renamed or synthetic roles follow the deployed grants.
CREATE FUNCTION enforce_signing_key_envelope_writer() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT has_column_privilege(current_user, 'public.signing_keys'::regclass, 'private_envelope', 'SELECT')
    AND NOT (NEW.private_envelope IS NULL AND NEW.wrapping_key_id IS NULL
      AND NEW.state NOT IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'only the signer writes a signing key envelope; others may only scrub it on retirement'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_signing_key_envelope_writer() FROM PUBLIC;
CREATE TRIGGER signing_keys_envelope_writer BEFORE UPDATE ON signing_keys FOR EACH ROW
  WHEN ((NEW.private_envelope, NEW.wrapping_key_id) IS DISTINCT FROM (OLD.private_envelope, OLD.wrapping_key_id))
  EXECUTE FUNCTION enforce_signing_key_envelope_writer();

-- migrate:down
DROP TRIGGER signing_keys_envelope_writer ON signing_keys;
DROP FUNCTION enforce_signing_key_envelope_writer();
