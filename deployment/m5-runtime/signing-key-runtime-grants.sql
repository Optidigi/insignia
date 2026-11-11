-- Schema-owner delta (11 November 2026). The original M5 bootstrap granted the web role
-- SELECT/INSERT/UPDATE/DELETE on every table. For signing keys the web role keeps SELECT and
-- INSERT, loses DELETE and whole-row UPDATE, and may update only the lifecycle columns it writes
-- (state transitions, retirement window, destruction and envelope re-wrap). Identity columns
-- (public key, fingerprint, ids, first day) can no longer change even if the web role is abused.
-- The worker and inspector roles still have no access to private_envelope.
BEGIN;
REVOKE DELETE, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.signing_keys FROM insignia_runtime;
GRANT SELECT, INSERT ON public.signing_keys TO insignia_runtime;
GRANT UPDATE(state, activated_at, retired_at, revoked_at, revocation_reason, revocation_command_key, destroyed_at,
  private_envelope, wrapping_key_id, last_valid_day) ON public.signing_keys TO insignia_runtime;
DO $$ BEGIN
  IF has_table_privilege('insignia_runtime','public.signing_keys','DELETE')
    OR has_column_privilege('insignia_runtime','public.signing_keys','public_key','UPDATE')
    OR has_column_privilege('insignia_runtime','public.signing_keys','first_valid_day','UPDATE')
    OR NOT has_column_privilege('insignia_runtime','public.signing_keys','private_envelope','SELECT')
    OR has_column_privilege('insignia_worker','public.signing_keys','private_envelope','SELECT') THEN
    RAISE EXCEPTION 'signing key grants not least privilege';
  END IF;
END $$;
COMMIT;
