-- migrate:up
-- Purpose-scoped historical projections. Neither signing envelopes nor buyer credentials escape.
CREATE FUNCTION public.read_purchase_offer_history(p_shop text,p_generation bigint,p_quote uuid,p_set uuid)
RETURNS TABLE(quote_value jsonb,set_id uuid,key_id integer,public_key_fingerprint text,
 first_valid_day integer,last_valid_day integer,valid_through_day integer,envelope_carrier text,
 member_carriers jsonb,public_key bytea,original_generation text,activated_at timestamptz,
 deactivated_at timestamptz,revoked_at timestamptz,issued_at timestamptz,issued_day integer,
 shop_timezone text,payload jsonb,collected_at timestamptz,expires_at timestamptz,erased_at timestamptz,
 desired_request jsonb,created_at timestamptz,retain_private_until timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT q.quote_value,a.set_id,a.key_id,a.public_key_fingerprint,a.first_valid_day,a.last_valid_day,
 a.valid_through_day,a.envelope_carrier,a.member_carriers,k.public_key,q.installation_generation::text,
 i.activated_at,i.deactivated_at,k.revoked_at,r.issued_at,r.issued_day,r.shop_timezone,
 CASE WHEN p.expires_at>clock_timestamp() AND i.deactivated_at IS NULL AND q.installation_generation=p_generation THEN p.payload END,
 p.collected_at,p.expires_at,p.erased_at,
 CASE WHEN p.collected_at IS NULL AND legacy.retain_private_until>clock_timestamp() AND i.deactivated_at IS NULL AND q.installation_generation=p_generation THEN legacy.desired_request END,
 COALESCE(buyer.created_at,legacy.created_at),legacy.retain_private_until
 FROM public.accepted_quotes q
 JOIN public.quote_authorization_sets a ON a.quote_id=q.quote_id AND a.shop_id=q.shop_id AND a.installation_generation=q.installation_generation
 JOIN public.installation_generations i ON i.shop_id=q.shop_id AND i.generation=q.installation_generation
 JOIN public.signing_keys k ON k.shop_id=a.shop_id AND k.installation_generation=a.installation_generation AND k.authorization_generation=a.authorization_generation AND k.key_id=a.key_id
 LEFT JOIN public.quote_authorization_renewals r ON r.set_id=a.set_id
 LEFT JOIN public.purchase_offer_payloads p ON p.shop_id=q.shop_id AND p.installation_generation=q.installation_generation AND p.quote_id=q.quote_id
 LEFT JOIN public.buyer_quote_ownership o ON o.shop_id=q.shop_id AND o.installation_generation=q.installation_generation AND o.quote_id=q.quote_id
 LEFT JOIN public.quote_proposals legacy ON legacy.shop_id=o.shop_id AND legacy.installation_generation=o.installation_generation AND legacy.proposal_id=o.proposal_id
 LEFT JOIN public.buyer_sessions buyer ON buyer.session_id=legacy.session_id AND buyer.shop_id=legacy.shop_id AND buyer.installation_generation=legacy.installation_generation
 WHERE q.shop_id=p_shop AND q.quote_id=p_quote AND a.set_id=p_set
 AND EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations current_i ON current_i.shop_id=s.shop_id AND current_i.generation=s.current_generation
 WHERE s.shop_id=p_shop AND s.current_generation=p_generation AND current_i.deactivated_at IS NULL)
$$;
CREATE FUNCTION public.read_purchase_revision_history(p_shop text,p_generation bigint,p_quote uuid,p_set uuid,p_revision text,p_hash text)
RETURNS TABLE(published_value jsonb,geometry_value jsonb,presentation_value jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.published_value,g.geometry_value,p.presentation_value
 FROM public.config_revisions r JOIN public.config_revision_geometry g USING(shop_id,config_id,revision_id)
 JOIN public.config_revision_presentation p USING(shop_id,config_id,revision_id)
 WHERE r.shop_id=p_shop AND r.revision_id=p_revision AND r.content_hash=p_hash
 AND EXISTS(SELECT 1 FROM public.read_purchase_offer_history(p_shop,p_generation,p_quote,p_set) offer,
 jsonb_array_elements(offer.quote_value->'effectiveRevisions') revision
 WHERE (offer.payload IS NOT NULL OR offer.desired_request IS NOT NULL)
 AND revision->>'revisionId'=p_revision AND revision->>'contentHash'=p_hash)
$$;
REVOKE ALL ON FUNCTION public.read_purchase_offer_history(text,bigint,uuid,uuid), public.read_purchase_revision_history(text,bigint,uuid,uuid,text,text) FROM PUBLIC;
-- migrate:down
DROP FUNCTION public.read_purchase_revision_history(text,bigint,uuid,uuid,text,text),public.read_purchase_offer_history(text,bigint,uuid,uuid);
