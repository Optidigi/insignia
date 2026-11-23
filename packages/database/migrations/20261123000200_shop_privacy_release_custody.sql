-- migrate:up
-- Release custody may own the evidence table separately from the schema owner.
-- The verified finalizer owns the erasure scope; release custody remains append-only.
CREATE OR REPLACE FUNCTION public.forbid_trusted_release_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_RELID='public.trusted_release_records'::regclass
   AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class
                                   WHERE oid='public.shop_privacy_finalization'::regclass)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'trusted release evidence is append-only' USING ERRCODE='check_violation';
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION public.forbid_trusted_release_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF public.shop_privacy_delete_scope(OLD.shop_id,OLD.installation_generation::text) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'trusted release evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$;
