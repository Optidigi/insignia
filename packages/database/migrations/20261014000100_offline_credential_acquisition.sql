-- migrate:up
-- Credential-specific issuance lane. Dispatched attempts never become retryable
-- through elapsed time; only an undispatched reservation has a lease.
CREATE TABLE shop_credential_acquisitions (
  attempt_id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  authorization_generation uuid NOT NULL,
  authorization_epoch bigint NOT NULL CHECK (authorization_epoch BETWEEN 0 AND 4294967295),
  external_installation_id text NOT NULL CHECK (length(external_installation_id) BETWEEN 1 AND 256),
  state text NOT NULL CHECK (state IN ('reserved','dispatched','installed','rejected','abandoned')),
  reserved_until timestamptz NOT NULL,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (shop_id, installation_generation) REFERENCES installation_generations(shop_id,generation),
  CHECK ((state = 'reserved' AND dispatched_at IS NULL AND completed_at IS NULL)
    OR (state = 'dispatched' AND dispatched_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('installed','rejected') AND dispatched_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (state = 'abandoned' AND dispatched_at IS NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX shop_credential_acquisition_pending
  ON shop_credential_acquisitions(shop_id,installation_generation)
  WHERE state IN ('reserved','dispatched');
-- Existing scoped roles only: never provision credentials or widen another table.
REVOKE ALL ON shop_credential_acquisitions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON shop_credential_acquisitions TO insignia_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    GRANT SELECT ON shop_credential_acquisitions TO insignia_queue_consume;
  END IF;
END $$;
-- migrate:down
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM shop_credential_acquisitions) THEN
    RAISE EXCEPTION 'credential acquisition evidence prevents rollback';
  END IF;
END $$;
DROP TABLE shop_credential_acquisitions;
