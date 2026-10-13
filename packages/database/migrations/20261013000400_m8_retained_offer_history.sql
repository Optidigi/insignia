-- migrate:up
-- Copy only existing source evidence. Original collection/deadline remain exact;
-- absent pre-M8 history is not manufactured from an accepted quote or current config.
INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload,erased_at)
SELECT q.shop_id,q.installation_generation,q.quote_id,b.created_at,p.retain_private_until,
 CASE WHEN p.retain_private_until>clock_timestamp() AND i.deactivated_at IS NULL AND s.current_generation=q.installation_generation THEN p.desired_request ELSE NULL END,
 CASE WHEN p.retain_private_until>clock_timestamp() AND i.deactivated_at IS NULL AND s.current_generation=q.installation_generation THEN NULL ELSE clock_timestamp() END
FROM buyer_quote_ownership o
JOIN accepted_quotes q ON q.shop_id=o.shop_id AND q.installation_generation=o.installation_generation AND q.quote_id=o.quote_id AND q.request_digest=o.request_digest
JOIN quote_proposals p ON p.shop_id=o.shop_id AND p.installation_generation=o.installation_generation AND p.proposal_id=o.proposal_id
JOIN buyer_sessions b ON b.session_id=p.session_id AND b.shop_id=p.shop_id AND b.installation_generation=p.installation_generation
JOIN shops s ON s.shop_id=q.shop_id
JOIN installation_generations i ON i.shop_id=q.shop_id AND i.generation=q.installation_generation
WHERE p.retain_private_until>b.created_at AND p.retain_private_until<=b.expires_at
ON CONFLICT DO NOTHING;
-- migrate:down
-- Forgetting copied source/deadline/tombstone evidence would recreate a historical-read hole.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM purchase_offer_payloads) THEN RAISE EXCEPTION 'retained offer history prevents rollback'; END IF;
END $$;
