-- migrate:up
CREATE TABLE merchant_preview_assets (
  asset_id uuid PRIMARY KEY,
  shop_id text NOT NULL CHECK (shop_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  installation_generation bigint NOT NULL,
  product_id text NOT NULL CHECK (product_id ~ '^[1-9][0-9]{0,19}$'),
  image_revision_id text NOT NULL CHECK (image_revision_id ~ '^(product|variant)_[1-9][0-9]{0,19}$'),
  original_key text NOT NULL UNIQUE,
  preview_key text NOT NULL UNIQUE,
  manifest jsonb,
  collected_at timestamptz NOT NULL,
  abandon_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('PREPARING','WRITING','USABLE','RETIRED','DELETING','DELETED')),
  claim_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(shop_id,installation_generation) REFERENCES installation_generations(shop_id,generation),
  UNIQUE(shop_id,installation_generation,product_id,image_revision_id,asset_id),
  CHECK (original_key = 'originals/merchant-previews/' || shop_id || '/' || installation_generation::text || '/' || asset_id::text),
  CHECK (preview_key = 'previews/merchant-previews/' || shop_id || '/' || installation_generation::text || '/' || asset_id::text || '.png'),
  CHECK (image_revision_id NOT LIKE 'product_%' OR image_revision_id = 'product_' || product_id),
  CHECK (isfinite(collected_at) AND isfinite(abandon_at) AND isfinite(updated_at)),
  CHECK (abandon_at = collected_at + interval '168 hours'),
  CHECK ((state='WRITING') = (claim_id IS NOT NULL)),
  CHECK ((state='DELETED') = (manifest IS NULL)),
  CHECK (manifest IS NULL OR CASE WHEN jsonb_typeof(manifest)='object'
    AND manifest ?& ARRAY['version','mimeType','sha256','previewSha256','byteLength','previewByteLength','width','height']
    AND jsonb_typeof(manifest->'version')='string' AND jsonb_typeof(manifest->'mimeType')='string'
    AND jsonb_typeof(manifest->'sha256')='string' AND jsonb_typeof(manifest->'previewSha256')='string'
    AND jsonb_typeof(manifest->'byteLength')='number' AND manifest->>'byteLength' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(manifest->'previewByteLength')='number' AND manifest->>'previewByteLength' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(manifest->'width')='number' AND manifest->>'width' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(manifest->'height')='number' AND manifest->>'height' ~ '^[1-9][0-9]*$'
    THEN COALESCE((manifest->>'version'='m6-inspection-v1'
      AND manifest->>'mimeType' IN ('image/png','image/jpeg','image/svg+xml')
      AND manifest->>'sha256' ~ '^[a-f0-9]{64}$'
      AND manifest->>'previewSha256' ~ '^[a-f0-9]{64}$'
      AND (manifest->>'byteLength')::numeric BETWEEN 1 AND 5242880
      AND (manifest->>'previewByteLength')::numeric BETWEEN 8 AND 2097152
      AND (manifest->>'width')::numeric BETWEEN 1 AND 12000
      AND (manifest->>'height')::numeric BETWEEN 1 AND 12000
      AND (manifest->>'width')::numeric * (manifest->>'height')::numeric <= 40000000),false)
    ELSE false END)
);
CREATE INDEX merchant_preview_cleanup ON merchant_preview_assets(abandon_at,asset_id) WHERE state NOT IN ('WRITING','DELETED');
CREATE FUNCTION guard_merchant_preview_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_generation bigint; inactive_at timestamptz; live boolean;
BEGIN
  -- Repositories acquire these identities before the asset row. The trigger also
  -- checks direct SQL; any conflicting lock order aborts rather than bypassing a fence.
  IF TG_OP='INSERT' OR NEW.state IN ('WRITING','USABLE','RETIRED') THEN
    SELECT s.current_generation INTO current_generation FROM shops s WHERE s.shop_id=NEW.shop_id FOR UPDATE;
    SELECT i.deactivated_at INTO inactive_at FROM installation_generations i
      WHERE i.shop_id=NEW.shop_id AND i.generation=NEW.installation_generation FOR UPDATE;
    live := COALESCE(FOUND AND current_generation=NEW.installation_generation AND inactive_at IS NULL,false);
    IF ((TG_OP='INSERT' OR NEW.state IN ('WRITING','USABLE')) AND NOT live) OR
       (NEW.state='RETIRED' AND live) THEN
      RAISE EXCEPTION 'merchant preview installation state mismatch' USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state <> 'PREPARING' OR NEW.claim_id IS NOT NULL THEN
      RAISE EXCEPTION 'merchant preview must begin preparing' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.asset_id,NEW.shop_id,NEW.installation_generation,NEW.product_id,NEW.image_revision_id,
    NEW.original_key,NEW.preview_key,NEW.collected_at,NEW.abandon_at)
    IS DISTINCT FROM ROW(OLD.asset_id,OLD.shop_id,OLD.installation_generation,OLD.product_id,OLD.image_revision_id,
    OLD.original_key,OLD.preview_key,OLD.collected_at,OLD.abandon_at) THEN
    RAISE EXCEPTION 'merchant preview identity is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.manifest IS DISTINCT FROM OLD.manifest AND NOT (OLD.state='DELETING' AND NEW.state='DELETED' AND NEW.manifest IS NULL) THEN
    RAISE EXCEPTION 'merchant preview manifest is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NOT ((OLD.state='PREPARING' AND NEW.state IN ('WRITING','DELETING')) OR
    (OLD.state='WRITING' AND NEW.state IN ('USABLE','RETIRED') AND NEW.claim_id IS NULL) OR
    (OLD.state IN ('USABLE','RETIRED') AND NEW.state='DELETING') OR
    (OLD.state='DELETING' AND NEW.state='DELETED')) THEN
    RAISE EXCEPTION 'invalid merchant preview state transition' USING ERRCODE='check_violation';
  END IF;
  IF NEW.state='DELETING' AND OLD.state='USABLE' AND EXISTS
    (SELECT 1 FROM config_revision_preview_assets r WHERE r.asset_id=OLD.asset_id) AND EXISTS
    (SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=OLD.shop_id AND s.current_generation=OLD.installation_generation AND i.deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'referenced live merchant preview cannot be deleted' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER merchant_preview_asset_guard BEFORE INSERT OR UPDATE ON merchant_preview_assets FOR EACH ROW EXECUTE FUNCTION guard_merchant_preview_asset();
CREATE TRIGGER merchant_preview_tombstone_guard BEFORE DELETE ON merchant_preview_assets
  FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();
CREATE TABLE config_revision_preview_assets (
  shop_id text NOT NULL,
  config_id text NOT NULL,
  revision_id text NOT NULL,
  installation_generation bigint NOT NULL,
  product_id text NOT NULL,
  image_revision_id text NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY(shop_id,revision_id,image_revision_id),
  FOREIGN KEY(shop_id,config_id,revision_id) REFERENCES config_revisions(shop_id,config_id,revision_id),
  FOREIGN KEY(shop_id,installation_generation,product_id,image_revision_id,asset_id)
    REFERENCES merchant_preview_assets(shop_id,installation_generation,product_id,image_revision_id,asset_id)
);
CREATE INDEX merchant_preview_references ON config_revision_preview_assets(asset_id);
CREATE FUNCTION guard_merchant_preview_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE image_width integer; image_height integer;
BEGIN
  PERFORM 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
    WHERE s.shop_id=NEW.shop_id AND s.current_generation=NEW.installation_generation AND i.deactivated_at IS NULL FOR UPDATE OF s,i;
  IF NOT FOUND THEN RAISE EXCEPTION 'inactive merchant preview installation' USING ERRCODE='check_violation'; END IF;
  SELECT (a.manifest->>'width')::integer,(a.manifest->>'height')::integer INTO image_width,image_height
    FROM merchant_preview_assets a WHERE a.asset_id=NEW.asset_id AND a.shop_id=NEW.shop_id
    AND a.installation_generation=NEW.installation_generation AND a.product_id=NEW.product_id
    AND a.image_revision_id=NEW.image_revision_id AND a.state='USABLE' FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'unusable merchant preview asset' USING ERRCODE='check_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM product_configs c JOIN config_revision_presentation p ON p.shop_id=c.shop_id AND p.config_id=c.config_id
    WHERE c.shop_id=NEW.shop_id AND c.config_id=NEW.config_id AND c.external_product_id=NEW.product_id
    AND p.revision_id=NEW.revision_id AND p.source_installation_generation=NEW.installation_generation) THEN
    RAISE EXCEPTION 'merchant preview revision scope mismatch' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config_revision_geometry g CROSS JOIN LATERAL jsonb_array_elements(g.geometry_value->'views') v
    WHERE g.shop_id=NEW.shop_id AND g.revision_id=NEW.revision_id AND
      (v->'image'->>'revisionId'=NEW.image_revision_id OR EXISTS
        (SELECT 1 FROM jsonb_array_elements(v->'variantImages') vi WHERE vi->'image'->>'revisionId'=NEW.image_revision_id))) THEN
    RAISE EXCEPTION 'merchant preview image absent from revision geometry' USING ERRCODE='check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM config_revision_geometry g
    CROSS JOIN LATERAL jsonb_array_elements(g.geometry_value->'views') v
    CROSS JOIN LATERAL (SELECT v->'image' AS image UNION ALL
      SELECT vi->'image' FROM jsonb_array_elements(v->'variantImages') vi) selected
    WHERE g.shop_id=NEW.shop_id AND g.revision_id=NEW.revision_id
      AND selected.image->>'revisionId'=NEW.image_revision_id
      AND ((selected.image->>'width')::numeric IS DISTINCT FROM image_width::numeric
        OR (selected.image->>'height')::numeric IS DISTINCT FROM image_height::numeric)) THEN
    RAISE EXCEPTION 'merchant preview dimensions differ from revision geometry' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER merchant_preview_binding_guard BEFORE INSERT ON config_revision_preview_assets FOR EACH ROW EXECUTE FUNCTION guard_merchant_preview_binding();
CREATE TRIGGER merchant_preview_binding_immutable BEFORE UPDATE OR DELETE ON config_revision_preview_assets FOR EACH ROW EXECUTE FUNCTION reject_revision_mutation();
-- migrate:down
DROP TABLE config_revision_preview_assets;
DROP FUNCTION guard_merchant_preview_binding();
DROP TABLE merchant_preview_assets;
DROP FUNCTION guard_merchant_preview_asset();
