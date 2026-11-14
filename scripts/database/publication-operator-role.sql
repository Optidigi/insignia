-- Owner-run, idempotent (#466 part B, for part A's operator command). Creates the NOLOGIN role that
-- alone may execute m5_operator_claim_abandoned_hold (migration 65) and grants that EXECUTE when the
-- function exists, so it may run before or after the migration. It grants the role to nobody: the
-- owner grants it to the SSH-run command identity only when part A ships. No runtime role is a member.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_publication_operator') THEN
    CREATE ROLE insignia_publication_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_publication_operator'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'unqualified_publication_operator_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles g ON g.oid=m.member
      WHERE r.rolname='insignia_publication_operator' AND g.rolname IN ('insignia_runtime','insignia_worker','insignia_signer',
        'insignia_queue_consume','insignia_queue_enqueue','insignia_artwork_worker','insignia_artwork_inspect')) THEN
    RAISE EXCEPTION 'runtime_role_holds_publication_operator';
  END IF;
  IF to_regprocedure('public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)
      TO insignia_publication_operator;
  END IF;
END $$;
COMMIT;
