-- Template for separately authorized DBA action; no role/password is created here.
-- Supply psql -v monitor_role=<dedicated existing SELECT-only role>.
-- Never grant runtime/owner membership, INSERT/UPDATE/DELETE, or payload columns.
GRANT USAGE ON SCHEMA public TO :"monitor_role";
GRANT SELECT (state,available_at,lease_until,purge_after,erasure_state) ON public.outbox_events TO :"monitor_role";
GRANT SELECT (state,received_at,lease_until,purge_after,erasure_state) ON public.inbox_messages TO :"monitor_role";
GRANT SELECT (state,expires_at,retry_at,collected_at,claim_until,quarantine_cleaned_at,upload_until,shop_id,installation_generation) ON public.artwork_assets TO :"monitor_role";
GRANT SELECT (state,updated_at,abandon_at,asset_id,shop_id,installation_generation) ON public.merchant_preview_assets TO :"monitor_role";
GRANT SELECT (shop_id,current_generation) ON public.shops TO :"monitor_role";
GRANT SELECT (shop_id,generation,deactivated_at) ON public.installation_generations TO :"monitor_role";
GRANT SELECT (asset_id) ON public.config_revision_preview_assets TO :"monitor_role";
GRANT SELECT (expires_at,erased_at,shop_id,installation_generation) ON public.purchase_offer_payloads,public.purchase_design_payloads TO :"monitor_role";
GRANT SELECT (kind,expires_at,erased_at,shop_id,installation_generation) ON public.purchase_artwork_events TO :"monitor_role";
GRANT SELECT (expires_at,shop_id,installation_generation) ON public.buyer_sessions TO :"monitor_role";
GRANT SELECT (expires_at) ON public.design_drafts TO :"monitor_role";
GRANT SELECT (facts_erased_at,forget_after) ON public.webhook_obligation_facts TO :"monitor_role";
GRANT SELECT (retain_private_until) ON public.quote_proposals TO :"monitor_role";
