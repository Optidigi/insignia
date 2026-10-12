-- Owner-applied configuration after the M6 artwork migration and existing queue-role setup.
-- No login provisioning, credentials, deployment or broad application-table authority.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    RAISE EXCEPTION 'existing_queue_consume_role_required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'unqualified_artwork_runtime_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='insignia_queue_consume') THEN
    RAISE EXCEPTION 'unqualified_artwork_runtime_membership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='artwork_assets'
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'artwork_table_owner_required';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO insignia_queue_consume;
-- Tenant/generation checks and FOR UPDATE tenant locks; identities cannot be rewritten.
GRANT SELECT ON public.shops, public.installation_generations TO insignia_queue_consume;
GRANT UPDATE(updated_at) ON public.shops TO insignia_queue_consume;
GRANT UPDATE(deactivated_at) ON public.installation_generations TO insignia_queue_consume;
REVOKE ALL ON public.artwork_assets FROM PUBLIC, insignia_queue_consume;
-- Table-level REVOKE does not remove prior column-level grants. Close those
-- explicitly before granting the reviewed mutable columns.
REVOKE INSERT(asset_id, shop_id, installation_generation, owner_hash, declared_mime, declared_bytes,
  state, quarantine_key, original_key, preview_key, collected_at, upload_until, expires_at,
  claim_id, claim_until, manifest, rejection, quarantine_cleaned_at, retry_at,
  cleanup_attempt_at, quarantine_cleanup_attempt_at, updated_at)
  ON public.artwork_assets FROM PUBLIC, insignia_queue_consume;
REVOKE UPDATE(asset_id, shop_id, installation_generation, owner_hash, declared_mime, declared_bytes,
  state, quarantine_key, original_key, preview_key, collected_at, upload_until, expires_at,
  claim_id, claim_until, manifest, rejection, quarantine_cleaned_at, retry_at,
  cleanup_attempt_at, quarantine_cleanup_attempt_at, updated_at)
  ON public.artwork_assets FROM PUBLIC, insignia_queue_consume;
REVOKE REFERENCES(asset_id, shop_id, installation_generation, owner_hash, declared_mime, declared_bytes,
  state, quarantine_key, original_key, preview_key, collected_at, upload_until, expires_at,
  claim_id, claim_until, manifest, rejection, quarantine_cleaned_at, retry_at,
  cleanup_attempt_at, quarantine_cleanup_attempt_at, updated_at)
  ON public.artwork_assets FROM PUBLIC, insignia_queue_consume;
GRANT SELECT ON public.artwork_assets TO insignia_queue_consume;
GRANT UPDATE(state, claim_id, claim_until, manifest, rejection, owner_hash,
  quarantine_cleaned_at, retry_at, cleanup_attempt_at, quarantine_cleanup_attempt_at, updated_at)
  ON public.artwork_assets TO insignia_queue_consume;
-- This is a table/column privilege boundary, not per-row or expiry-only SQL isolation.
-- Scoped repositories and the immutable-identity trigger enforce the application contract.
-- No INSERT, DELETE, tenant/key/size/collection/expiry UPDATE or sequence grants.
COMMIT;
