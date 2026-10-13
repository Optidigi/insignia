-- Owner-applied configuration after the M6 artwork migration and existing queue-role setup.
-- Creates a separate NOLOGIN inspection capability, not a login or deployment grant.
-- The purchase/queue capability never inherits original-artwork access.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    RAISE EXCEPTION 'existing_queue_consume_role_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_artwork_inspect') THEN
    CREATE ROLE insignia_artwork_inspect NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('insignia_queue_consume','insignia_artwork_inspect')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'unqualified_artwork_runtime_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('insignia_queue_consume','insignia_artwork_inspect')) THEN
    RAISE EXCEPTION 'unqualified_artwork_runtime_membership';
  END IF;
  IF has_column_privilege('insignia_artwork_inspect','public.signing_keys','private_envelope','SELECT')
    OR has_table_privilege('insignia_artwork_inspect','public.shop_credentials','SELECT') THEN
    RAISE EXCEPTION 'unqualified_artwork_private_access';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('artwork_assets','shops','installation_generations')
      AND (has_any_column_privilege('insignia_artwork_inspect',c.oid,'SELECT, INSERT, UPDATE, REFERENCES')
        OR has_table_privilege('insignia_artwork_inspect',c.oid,'DELETE, TRUNCATE, TRIGGER'))) THEN
    RAISE EXCEPTION 'unqualified_artwork_private_access';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
      AND has_function_privilege('insignia_artwork_inspect',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'unqualified_artwork_private_access';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='insignia_artwork_inspect')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='insignia_artwork_inspect')
    OR has_schema_privilege('insignia_artwork_inspect','public','CREATE') THEN
    RAISE EXCEPTION 'unqualified_artwork_runtime_ownership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='artwork_assets'
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'artwork_table_owner_required';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO insignia_artwork_inspect;
-- Close prior inspection-group tenant table/column privileges before rebuilding locks.
DO $$ DECLARE relation text; columns text; privilege text; BEGIN
  FOREACH relation IN ARRAY ARRAY['shops','installation_generations'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM insignia_artwork_inspect',relation);
    SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO columns
      FROM pg_attribute WHERE attrelid=format('public.%I',relation)::regclass AND attnum>0 AND NOT attisdropped;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      EXECUTE format('REVOKE %s (%s) ON public.%I FROM insignia_artwork_inspect',privilege,columns,relation);
    END LOOP;
  END LOOP;
END $$;
-- Tenant/generation checks and FOR UPDATE tenant locks; identities cannot be rewritten.
GRANT SELECT ON public.shops, public.installation_generations TO insignia_artwork_inspect;
GRANT UPDATE(updated_at) ON public.shops TO insignia_artwork_inspect;
GRANT UPDATE(deactivated_at) ON public.installation_generations TO insignia_artwork_inspect;
REVOKE ALL ON public.artwork_assets FROM PUBLIC, insignia_queue_consume, insignia_artwork_inspect;
-- Table REVOKE cannot close obsolete column grants. Close every current column,
-- including later owner-kind additions, before rebuilding the purpose boundary.
DO $$ DECLARE columns text; privilege text; BEGIN
  SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO columns
    FROM pg_attribute WHERE attrelid='public.artwork_assets'::regclass AND attnum>0 AND NOT attisdropped;
  FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    EXECUTE format('REVOKE %s (%s) ON public.artwork_assets FROM PUBLIC, insignia_queue_consume, insignia_artwork_inspect',privilege,columns);
  END LOOP;
END $$;
-- Purchase reconciliation needs identity/readiness only, not storage keys.
GRANT SELECT(asset_id,shop_id,state,expires_at) ON public.artwork_assets TO insignia_queue_consume;
GRANT SELECT ON public.artwork_assets TO insignia_artwork_inspect;
GRANT UPDATE(state, claim_id, claim_until, manifest, rejection, owner_hash,
  quarantine_cleaned_at, retry_at, cleanup_attempt_at, quarantine_cleanup_attempt_at, updated_at)
  ON public.artwork_assets TO insignia_artwork_inspect;
-- This is a table/column privilege boundary, not per-row or expiry-only SQL isolation.
-- Scoped repositories and the immutable-identity trigger enforce the application contract.
-- No INSERT, DELETE, tenant/key/size/collection/expiry UPDATE or sequence grants.
-- Effective PUBLIC privileges must not survive the group's explicit rebuild.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relname IN ('artwork_assets','shops','installation_generations') AND (
      NOT has_column_privilege('insignia_artwork_inspect',c.oid,a.attnum,'SELECT')
      OR has_column_privilege('insignia_artwork_inspect',c.oid,a.attnum,'INSERT, REFERENCES')
      OR has_table_privilege('insignia_artwork_inspect',c.oid,'DELETE, TRUNCATE, TRIGGER')
      OR has_column_privilege('insignia_artwork_inspect',c.oid,a.attnum,'UPDATE') IS DISTINCT FROM (
        (c.relname='shops' AND a.attname='updated_at') OR
        (c.relname='installation_generations' AND a.attname='deactivated_at') OR
        (c.relname='artwork_assets' AND a.attname=ANY(ARRAY['state','claim_id','claim_until','manifest','rejection','owner_hash',
          'quarantine_cleaned_at','retry_at','cleanup_attempt_at','quarantine_cleanup_attempt_at','updated_at']))
      ))) THEN RAISE EXCEPTION 'unqualified_artwork_mutation_access'; END IF;
END $$;
COMMIT;
