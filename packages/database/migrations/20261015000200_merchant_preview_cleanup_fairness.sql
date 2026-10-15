-- migrate:up
-- Permit bounded cleanup-attempt rotation without reclaiming a deletion or retrying storage.
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

-- migrate:down
-- Forward-only custody preservation; do not undo attempt/fairness evidence.
