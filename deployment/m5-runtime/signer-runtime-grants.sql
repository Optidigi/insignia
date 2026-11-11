-- Schema-owner delta for the separate signer (11 November 2026). Run after migration 58, with the
-- `insignia_signer` LOGIN role already created from private custody.
-- * insignia_signer: the only role that reads private envelopes. It creates pending keys and
--   re-wraps envelopes; it cannot delete keys, change their state, window or identity, and reads
--   nothing else except the installation column the signing-key identity trigger checks.
-- * insignia_runtime (web): every signing-key column except private_envelope; no INSERT (pending
--   keys come from the signer). It keeps the lifecycle UPDATE columns, including nulling
--   private_envelope/wrapping_key_id when a key retires.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insignia_signer') THEN
    RAISE EXCEPTION 'insignia_signer role must exist';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO insignia_signer', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO insignia_signer;
GRANT SELECT, INSERT ON public.signing_keys TO insignia_signer;
GRANT UPDATE(private_envelope, wrapping_key_id) ON public.signing_keys TO insignia_signer;
GRANT SELECT(shop_id, generation, authorization_generation) ON public.installation_generations TO insignia_signer;
GRANT EXECUTE ON FUNCTION public.signing_key_scope(text, bigint, boolean) TO insignia_signer;

REVOKE SELECT, INSERT ON public.signing_keys FROM insignia_runtime;
GRANT SELECT(shop_id, installation_generation, authorization_generation, key_id, public_key, public_key_fingerprint,
  wrapping_key_id, state, first_valid_day, last_valid_day, created_at, activated_at, retired_at, revoked_at,
  revocation_reason, revocation_command_key, destroyed_at) ON public.signing_keys TO insignia_runtime;
GRANT EXECUTE ON FUNCTION public.signing_key_scope(text, bigint, boolean) TO insignia_runtime;

DO $$ BEGIN
  IF has_column_privilege('insignia_runtime', 'public.signing_keys', 'private_envelope', 'SELECT')
    OR has_table_privilege('insignia_runtime', 'public.signing_keys', 'INSERT')
    OR has_table_privilege('insignia_runtime', 'public.signing_keys', 'DELETE')
    OR has_column_privilege('insignia_runtime', 'public.signing_keys', 'public_key', 'UPDATE')
    OR NOT has_column_privilege('insignia_runtime', 'public.signing_keys', 'state', 'SELECT')
    OR NOT has_column_privilege('insignia_signer', 'public.signing_keys', 'private_envelope', 'SELECT')
    OR has_table_privilege('insignia_signer', 'public.signing_keys', 'DELETE')
    OR has_column_privilege('insignia_signer', 'public.signing_keys', 'state', 'UPDATE')
    OR has_column_privilege('insignia_signer', 'public.signing_keys', 'last_valid_day', 'UPDATE')
    OR has_table_privilege('insignia_signer', 'public.shops', 'SELECT')
    OR has_column_privilege('insignia_worker', 'public.signing_keys', 'private_envelope', 'SELECT') THEN
    RAISE EXCEPTION 'signer grants not least privilege';
  END IF;
END $$;
COMMIT;
