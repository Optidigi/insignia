-- Schema-owner delta (11 November 2026). Apply only after web runs the signer-client image (it no
-- longer reads private_envelope or inserts keys) and the signer is healthy.
-- insignia_runtime keeps every signing-key column except private_envelope, and the lifecycle
-- UPDATE columns (including nulling private_envelope/wrapping_key_id when a key retires). It loses
-- INSERT: pending keys come from the signer.
BEGIN;
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
    OR NOT has_column_privilege('insignia_runtime', 'public.signing_keys', 'private_envelope', 'UPDATE')
    OR has_column_privilege('insignia_worker', 'public.signing_keys', 'private_envelope', 'SELECT') THEN
    RAISE EXCEPTION 'web signing-key grants not least privilege';
  END IF;
END $$;
COMMIT;
