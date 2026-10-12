-- migrate:up
-- A restricted worker receives EXECUTE only. It cannot select private designs or choose a future erasure clock.
CREATE FUNCTION public.cleanup_buyer_payloads(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE at_time timestamptz := clock_timestamp(); erased integer;
BEGIN
  IF p_limit < 1 OR p_limit > 1000 OR p_limit IS NULL THEN RAISE EXCEPTION 'invalid buyer cleanup budget'; END IF;
  DELETE FROM public.design_drafts WHERE design_id IN (
    SELECT design_id FROM public.design_drafts WHERE expires_at <= at_time ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
  DELETE FROM public.quote_proposals WHERE proposal_id IN (
    SELECT proposal_id FROM public.quote_proposals WHERE retain_private_until <= at_time ORDER BY retain_private_until LIMIT p_limit FOR UPDATE SKIP LOCKED);
  DELETE FROM public.buyer_sessions WHERE session_id IN (
    SELECT b.session_id FROM public.buyer_sessions b WHERE b.expires_at <= at_time OR NOT EXISTS (
      SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL)
    ORDER BY b.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS erased = ROW_COUNT;
  RETURN erased;
END; $$;
REVOKE ALL ON FUNCTION public.cleanup_buyer_payloads(integer) FROM PUBLIC;
-- migrate:down
DROP FUNCTION public.cleanup_buyer_payloads(integer);
