-- migrate:up
-- The separate signer process reads and locks the active signing scope through this definer
-- function, so it needs no privileges on shops or installation generations beyond the column the
-- signing-key identity trigger reads. The web runtime uses the same function.
CREATE FUNCTION signing_key_scope(target_shop_id text, target_generation bigint, lock_rows boolean)
RETURNS TABLE(shop_id text, installation_generation text, authorization_generation text, authorization_epoch text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF lock_rows THEN
    RETURN QUERY SELECT s.shop_id, s.current_generation::text, i.authorization_generation::text, i.authorization_epoch::text
      FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=target_shop_id AND s.current_generation=target_generation AND i.deactivated_at IS NULL
        AND s.shopify_shop_id IS NOT NULL FOR UPDATE OF s, i;
  ELSE
    RETURN QUERY SELECT s.shop_id, s.current_generation::text, i.authorization_generation::text, i.authorization_epoch::text
      FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=target_shop_id AND s.current_generation=target_generation AND i.deactivated_at IS NULL
        AND s.shopify_shop_id IS NOT NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION signing_key_scope(text, bigint, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insignia_runtime') THEN
    GRANT EXECUTE ON FUNCTION signing_key_scope(text, bigint, boolean) TO insignia_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insignia_signer') THEN
    GRANT EXECUTE ON FUNCTION signing_key_scope(text, bigint, boolean) TO insignia_signer;
  END IF;
END $$;

-- migrate:down
DROP FUNCTION signing_key_scope(text, bigint, boolean);
