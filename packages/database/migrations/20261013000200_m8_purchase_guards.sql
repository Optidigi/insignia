-- migrate:up
-- Existing uploads have no provenance flag; never infer that a historical guest object was merchant-collected.
ALTER TABLE artwork_assets ADD COLUMN owner_kind text NOT NULL DEFAULT 'legacy_unknown'
 CHECK(owner_kind IN ('merchant','guest','legacy_unknown'));
CREATE FUNCTION guard_artwork_owner_kind() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.owner_kind IS DISTINCT FROM OLD.owner_kind THEN RAISE EXCEPTION 'artwork collection audience is immutable' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER artwork_owner_kind_guard BEFORE UPDATE ON artwork_assets FOR EACH ROW EXECUTE FUNCTION guard_artwork_owner_kind();
CREATE TRIGGER purchase_payload_no_delete BEFORE DELETE ON purchase_design_payloads FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE TRIGGER purchase_offer_no_delete BEFORE DELETE ON purchase_offer_payloads FOR EACH ROW EXECUTE FUNCTION reject_quote_mutation();
CREATE FUNCTION enforce_purchase_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM quote_authorization_sets a WHERE a.set_id=NEW.set_id AND a.quote_id=NEW.quote_id AND a.shop_id=NEW.shop_id AND a.installation_generation=NEW.installation_generation) THEN
  RAISE EXCEPTION 'purchase authorization tenant binding failed' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER purchase_binding_guard BEFORE INSERT ON purchase_bindings FOR EACH ROW EXECUTE FUNCTION enforce_purchase_binding();
CREATE FUNCTION enforce_purchase_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM purchase_bindings b WHERE b.purchase_id=NEW.purchase_id AND b.set_id=NEW.set_id AND b.shop_id=NEW.shop_id AND b.installation_generation=NEW.installation_generation) THEN
  RAISE EXCEPTION 'purchase line tenant binding failed' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER purchase_line_guard BEFORE INSERT ON purchase_lines FOR EACH ROW EXECUTE FUNCTION enforce_purchase_line();
CREATE OR REPLACE FUNCTION public.cleanup_purchase_payloads(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE at_time timestamptz:=clock_timestamp(); count_design integer; count_offer integer; count_event integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid purchase cleanup budget'; END IF;
 UPDATE public.purchase_design_payloads SET payload=NULL,erased_at=at_time WHERE (purchase_id,set_id) IN (
  SELECT p.purchase_id,p.set_id FROM public.purchase_design_payloads p WHERE p.erased_at IS NULL AND (p.expires_at<=at_time OR NOT EXISTS(
   SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
   WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL)) ORDER BY p.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_design=ROW_COUNT;
 UPDATE public.purchase_offer_payloads SET payload=NULL,erased_at=at_time WHERE (shop_id,installation_generation,quote_id) IN (
  SELECT p.shop_id,p.installation_generation,p.quote_id FROM public.purchase_offer_payloads p WHERE p.erased_at IS NULL AND (p.expires_at<=at_time OR NOT EXISTS(
   SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
   WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL)) ORDER BY p.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_offer=ROW_COUNT;
 UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=at_time WHERE event_id IN (
  SELECT p.event_id FROM public.purchase_artwork_events p WHERE p.erased_at IS NULL AND p.kind='ATTACH' AND (p.expires_at<=at_time OR NOT EXISTS(
   SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
   WHERE s.shop_id=p.shop_id AND s.current_generation=p.installation_generation AND i.deactivated_at IS NULL)) ORDER BY p.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS count_event=ROW_COUNT;
 RETURN count_design+count_offer+count_event;
END; $$;
REVOKE ALL ON FUNCTION public.cleanup_purchase_payloads(integer) FROM PUBLIC;
-- migrate:down
DROP TRIGGER purchase_line_guard ON purchase_lines;
DROP TRIGGER purchase_binding_guard ON purchase_bindings;
DROP FUNCTION enforce_purchase_line(),enforce_purchase_binding();
DROP TRIGGER purchase_payload_no_delete ON purchase_design_payloads;
DROP TRIGGER purchase_offer_no_delete ON purchase_offer_payloads;
DROP TRIGGER artwork_owner_kind_guard ON artwork_assets;
DROP FUNCTION guard_artwork_owner_kind();
ALTER TABLE artwork_assets DROP COLUMN owner_kind;
-- Down does not restore a less safe cleanup policy; 026 down removes the function and tables together.
