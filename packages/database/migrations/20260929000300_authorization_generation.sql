-- migrate:up
-- A fresh database-owned UUID is assigned to each existing installation row and
-- to each subsequent reinstall. The v2 generation field is its 16 raw bytes.
ALTER TABLE installation_generations
  ADD COLUMN authorization_generation uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN authorization_epoch bigint NOT NULL DEFAULT 0
    CHECK (authorization_epoch BETWEEN 0 AND 4294967295),
  ADD CONSTRAINT installation_authorization_generation_unique UNIQUE (authorization_generation);

CREATE FUNCTION enforce_authorization_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.authorization_generation IS DISTINCT FROM OLD.authorization_generation THEN
    RAISE EXCEPTION 'installation authorization generation is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.authorization_epoch < OLD.authorization_epoch THEN
    RAISE EXCEPTION 'installation authorization epoch cannot decrease'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER installation_authorization_identity_guard
  BEFORE UPDATE ON installation_generations
  FOR EACH ROW EXECUTE FUNCTION enforce_authorization_identity();

-- migrate:down
DROP TRIGGER installation_authorization_identity_guard ON installation_generations;
DROP FUNCTION enforce_authorization_identity();
ALTER TABLE installation_generations
  DROP CONSTRAINT installation_authorization_generation_unique,
  DROP COLUMN authorization_epoch,
  DROP COLUMN authorization_generation;
