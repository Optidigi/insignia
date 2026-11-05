-- migrate:up
-- Mutable catalog defaults; published revisions never reference these values.
ALTER TABLE method_catalog ADD COLUMN configuration jsonb;
ALTER TABLE method_catalog ADD COLUMN deleted_at timestamptz;
ALTER TABLE method_catalog ADD COLUMN amount_currency text CHECK (amount_currency IN ('USD','EUR'));
ALTER TABLE method_catalog ADD CONSTRAINT method_catalog_deleted_payload CHECK (deleted_at IS NULL OR (configuration IS NULL AND amount_currency IS NULL AND name='Deleted method'));
ALTER TABLE method_catalog ADD CONSTRAINT method_catalog_price_currency CHECK (configuration IS NULL OR configuration->>'pricing'<>'fixed' OR amount_currency IS NOT NULL);
ALTER TABLE method_catalog ADD CONSTRAINT method_catalog_configuration_object CHECK (
 configuration IS NULL OR (jsonb_typeof(configuration)='object' AND configuration->>'id'=method_id::text AND configuration->>'name'=name)
);
ALTER TABLE merchant_preview_assets DROP CONSTRAINT merchant_preview_assets_image_revision_id_check;
ALTER TABLE merchant_preview_assets ADD CONSTRAINT merchant_preview_assets_image_revision_id_check CHECK (image_revision_id ~ '^(product|variant|image)_[1-9][0-9]{0,19}$');

-- UUID tombstones cannot be revived or removed by ordinary app SQL. Qualified shop erasure
-- is the existing schema-owned nested privacy trigger and deletes the minimal identities.
CREATE FUNCTION guard_method_catalog_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF pg_trigger_depth()<2 OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.method_catalog'::regclass)
  THEN RAISE EXCEPTION 'qualified method identity erasure required' USING ERRCODE='check_violation'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.shop_id,NEW.method_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.shop_id,OLD.method_id,OLD.created_at) OR OLD.deleted_at IS NOT NULL
 THEN RAISE EXCEPTION 'method identity or tombstone is immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_method_catalog_identity() FROM PUBLIC;
CREATE TRIGGER method_catalog_identity BEFORE UPDATE OR DELETE ON method_catalog FOR EACH ROW EXECUTE FUNCTION guard_method_catalog_identity();

-- Existing privacy erasure deletes the whole catalog row, including configuration.

-- migrate:down
DROP TRIGGER method_catalog_identity ON method_catalog;
DROP FUNCTION guard_method_catalog_identity();
ALTER TABLE merchant_preview_assets DROP CONSTRAINT merchant_preview_assets_image_revision_id_check;
ALTER TABLE merchant_preview_assets ADD CONSTRAINT merchant_preview_assets_image_revision_id_check CHECK (image_revision_id ~ '^(product|variant)_[1-9][0-9]{0,19}$');
ALTER TABLE method_catalog DROP CONSTRAINT method_catalog_configuration_object;
ALTER TABLE method_catalog DROP CONSTRAINT method_catalog_deleted_payload;
ALTER TABLE method_catalog DROP COLUMN deleted_at;
ALTER TABLE method_catalog DROP CONSTRAINT method_catalog_price_currency;
ALTER TABLE method_catalog DROP COLUMN amount_currency;
ALTER TABLE method_catalog DROP COLUMN configuration;
