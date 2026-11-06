-- migrate:up
-- Private merchant garment uploads reuse inspected merchant-preview custody.
ALTER TABLE merchant_preview_assets DROP CONSTRAINT merchant_preview_assets_image_revision_id_check;
ALTER TABLE merchant_preview_assets ADD CONSTRAINT merchant_preview_assets_image_revision_id_check CHECK (
 image_revision_id ~ '^(product|variant|image)_[1-9][0-9]{0,19}$' OR image_revision_id ~ '^upload_[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
);

CREATE VIEW merchant_preview_draft_references WITH (security_barrier=true) AS
 SELECT a.asset_id FROM merchant_preview_assets a
 WHERE a.image_revision_id='upload_' || a.asset_id::text
 AND EXISTS (SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL)
 AND EXISTS (SELECT 1 FROM product_configs c WHERE c.shop_id=a.shop_id AND c.external_product_id=a.product_id
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.draft_value->'selectedSetup'->'product'->'images')='array' THEN c.draft_value->'selectedSetup'->'product'->'images' ELSE '[]'::jsonb END) image WHERE image->>'id'=a.image_revision_id));
REVOKE ALL ON merchant_preview_draft_references FROM PUBLIC;

CREATE FUNCTION guard_selected_merchant_upload_refs() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE image jsonb; source merchant_preview_assets%ROWTYPE; current_installation bigint; inactive_at timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND NEW.draft_value IS NOT DISTINCT FROM OLD.draft_value THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.draft_value->'selectedSetup'->'product'->'images') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.draft_value->'selectedSetup'->'product'->'images') candidate WHERE candidate->>'id' LIKE 'upload_%') THEN RETURN NEW; END IF;
 SELECT current_generation INTO current_installation FROM shops WHERE shop_id=NEW.shop_id FOR UPDATE;
 SELECT deactivated_at INTO inactive_at FROM installation_generations WHERE shop_id=NEW.shop_id AND installation_generations.generation=current_installation FOR UPDATE;
 IF NOT FOUND OR inactive_at IS NOT NULL THEN RAISE EXCEPTION 'active merchant upload authority required' USING ERRCODE='check_violation'; END IF;
 FOR image IN SELECT * FROM jsonb_array_elements(NEW.draft_value->'selectedSetup'->'product'->'images') LOOP
  IF image->>'id' NOT LIKE 'upload_%' THEN CONTINUE; END IF;
  SELECT * INTO source FROM merchant_preview_assets a WHERE a.shop_id=NEW.shop_id AND a.installation_generation=current_installation AND a.product_id=NEW.external_product_id
   AND a.image_revision_id=image->>'id' AND a.image_revision_id='upload_' || a.asset_id::text AND a.state='USABLE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned usable merchant upload required' USING ERRCODE='check_violation'; END IF;
  IF source.abandon_at<=clock_timestamp() AND (
    (TG_OP='INSERT' AND NEW.created_at>source.abandon_at) OR
    (TG_OP='UPDATE' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD.draft_value->'selectedSetup'->'product'->'images')='array' THEN OLD.draft_value->'selectedSetup'->'product'->'images' ELSE '[]'::jsonb END) prior_image WHERE prior_image->>'id'=source.image_revision_id)))
  THEN RAISE EXCEPTION 'abandoned merchant upload expired' USING ERRCODE='check_violation'; END IF;
  IF COALESCE(image->>'url','') !~ ('^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/admin/products/' || NEW.external_product_id || '/media/' || source.image_revision_id || '$')
  THEN RAISE EXCEPTION 'canonical private merchant upload URI required' USING ERRCODE='check_violation'; END IF;
  IF image->>'width' IS DISTINCT FROM source.manifest->>'width' OR image->>'height' IS DISTINCT FROM source.manifest->>'height'
  THEN RAISE EXCEPTION 'merchant upload dimensions changed' USING ERRCODE='check_violation'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_selected_merchant_upload_refs() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER selected_merchant_upload_refs AFTER INSERT OR UPDATE ON product_configs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_selected_merchant_upload_refs();

CREATE OR REPLACE FUNCTION guard_merchant_preview_asset() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
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
  -- Timestamp-only attempt rotation leaves deletion custody and immutable metadata intact.
  IF OLD.state='DELETING' AND NEW.state='DELETING' THEN RETURN NEW; END IF;
  IF NOT ((OLD.state='PREPARING' AND NEW.state IN ('WRITING','DELETING')) OR
    (OLD.state='WRITING' AND NEW.state IN ('USABLE','RETIRED') AND NEW.claim_id IS NULL) OR
    (OLD.state IN ('USABLE','RETIRED') AND NEW.state='DELETING') OR
    (OLD.state='DELETING' AND NEW.state='DELETED')) THEN
    RAISE EXCEPTION 'invalid merchant preview state transition' USING ERRCODE='check_violation';
  END IF;
  IF NEW.state='DELETING' AND OLD.state='USABLE' AND (
    EXISTS (SELECT 1 FROM config_revision_preview_assets r WHERE r.asset_id=OLD.asset_id) OR
    EXISTS (SELECT 1 FROM merchant_preview_draft_references d WHERE d.asset_id=OLD.asset_id)) AND EXISTS
    (SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=OLD.shop_id AND s.current_generation=OLD.installation_generation AND i.deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'referenced live merchant preview cannot be deleted' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;


-- migrate:down
DROP TRIGGER selected_merchant_upload_refs ON product_configs;
DROP FUNCTION guard_selected_merchant_upload_refs();
DROP VIEW merchant_preview_draft_references;
ALTER TABLE merchant_preview_assets DROP CONSTRAINT merchant_preview_assets_image_revision_id_check;
ALTER TABLE merchant_preview_assets ADD CONSTRAINT merchant_preview_assets_image_revision_id_check CHECK (image_revision_id ~ '^(product|variant|image)_[1-9][0-9]{0,19}$');
CREATE OR REPLACE FUNCTION guard_merchant_preview_asset() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- Timestamp-only attempt rotation leaves deletion custody and immutable metadata intact.
  IF OLD.state='DELETING' AND NEW.state='DELETING' THEN RETURN NEW; END IF;
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

