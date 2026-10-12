-- migrate:up
CREATE TABLE artwork_assets (
  asset_id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  installation_generation bigint NOT NULL,
  owner_hash text,
  declared_mime text NOT NULL CHECK (declared_mime IN ('image/svg+xml','image/png','image/jpeg')),
  declared_bytes integer NOT NULL CHECK (declared_bytes BETWEEN 1 AND 5242880),
  state text NOT NULL CHECK (state IN ('UPLOADING','QUEUED','INSPECTING','PROMOTING','USABLE','REJECTED','DELETING','DELETED')),
  quarantine_key text NOT NULL UNIQUE,
  original_key text NOT NULL UNIQUE,
  preview_key text NOT NULL UNIQUE,
  collected_at timestamptz NOT NULL,
  upload_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claim_id uuid,
  claim_until timestamptz,
  manifest jsonb,
  rejection text,
  quarantine_cleaned_at timestamptz,
  retry_at timestamptz,
  cleanup_attempt_at timestamptz,
  quarantine_cleanup_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation),
  CHECK ((claim_id IS NULL) = (claim_until IS NULL)),
  CHECK ((state = 'DELETED' AND owner_hash IS NULL AND manifest IS NULL) OR
         (state <> 'DELETED' AND owner_hash IS NOT NULL AND owner_hash ~ '^[a-f0-9]{64}$')),
  CHECK (state NOT IN ('PROMOTING','USABLE') OR manifest IS NOT NULL),
  CHECK (upload_until > collected_at AND upload_until <= collected_at + interval '5 minutes'),
  CHECK (expires_at > collected_at AND expires_at <= collected_at + interval '7 days'),
  CHECK (quarantine_key <> original_key AND original_key <> preview_key AND quarantine_key <> preview_key)
);
CREATE INDEX artwork_pending ON artwork_assets(collected_at,asset_id) WHERE state IN ('QUEUED','INSPECTING','PROMOTING');
CREATE INDEX artwork_retention ON artwork_assets(expires_at,asset_id) WHERE state <> 'DELETED';
CREATE INDEX artwork_tenant ON artwork_assets(shop_id,installation_generation,collected_at);
CREATE FUNCTION guard_artwork_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.asset_id,NEW.shop_id,NEW.installation_generation,NEW.declared_mime,NEW.declared_bytes,
         NEW.quarantine_key,NEW.original_key,NEW.preview_key,NEW.collected_at,NEW.upload_until,NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.asset_id,OLD.shop_id,OLD.installation_generation,OLD.declared_mime,OLD.declared_bytes,
         OLD.quarantine_key,OLD.original_key,OLD.preview_key,OLD.collected_at,OLD.upload_until,OLD.expires_at) THEN
    RAISE EXCEPTION 'artwork identity and original retention deadline are immutable' USING ERRCODE='check_violation';
  END IF;
  IF OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest AND NEW.state <> 'DELETED' THEN
    RAISE EXCEPTION 'artwork manifest is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.owner_hash IS DISTINCT FROM OLD.owner_hash AND NOT (NEW.state='DELETED' AND NEW.owner_hash IS NULL) THEN
    RAISE EXCEPTION 'artwork owner is immutable' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER artwork_identity_guard BEFORE UPDATE ON artwork_assets FOR EACH ROW EXECUTE FUNCTION guard_artwork_identity();

-- migrate:down
DROP TABLE artwork_assets;
DROP FUNCTION guard_artwork_identity();
