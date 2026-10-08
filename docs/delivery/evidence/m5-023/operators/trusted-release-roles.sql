-- Applied by the schema owner only after backup and migration16.
-- Existing role names stop the transaction; no credential/ownership assumption.
CREATE ROLE insignia_release_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE insignia_release_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER TABLE public.trusted_release_records OWNER TO insignia_release_owner;
ALTER FUNCTION public.forbid_trusted_release_rewrite() OWNER TO insignia_release_owner;
REVOKE ALL ON public.trusted_release_records FROM PUBLIC, insignia_runtime;
GRANT SELECT ON public.trusted_release_records TO insignia_runtime;
-- Bind CONNECT to the current designated database; do not rely on PUBLIC.
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO insignia_release_operator', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO insignia_release_operator;
GRANT EXECUTE ON FUNCTION pg_catalog.clock_timestamp(), pg_catalog.jsonb_typeof(jsonb) TO insignia_release_operator;
GRANT INSERT ON public.trusted_release_records TO insignia_release_operator;
GRANT USAGE ON SEQUENCE public.trusted_release_records_record_seq_seq TO insignia_release_operator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, insignia_runtime, insignia_release_operator;
DO $$
BEGIN
  IF NOT has_table_privilege('insignia_runtime','public.trusted_release_records','SELECT')
    OR has_table_privilege('insignia_runtime','public.trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_schema_privilege('insignia_runtime','public','CREATE')
    OR pg_has_role('insignia_runtime','insignia_release_owner','MEMBER')
    OR pg_has_role('insignia_runtime','insignia_release_operator','MEMBER')
    OR pg_has_role('insignia_runtime','pg_database_owner','MEMBER')
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_runtime' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
  THEN RAISE EXCEPTION 'Runtime trusted-release privileges invalid'; END IF;
  IF NOT has_database_privilege('insignia_release_operator',current_database(),'CONNECT')
    OR NOT has_function_privilege('insignia_release_operator','pg_catalog.clock_timestamp()','EXECUTE')
    OR NOT has_function_privilege('insignia_release_operator','pg_catalog.jsonb_typeof(jsonb)','EXECUTE')
    OR NOT has_table_privilege('insignia_release_operator','public.trusted_release_records','INSERT')
    OR has_table_privilege('insignia_release_operator','public.trusted_release_records','UPDATE,DELETE,TRUNCATE')
    OR has_schema_privilege('insignia_release_operator','public','CREATE')
    OR pg_has_role('insignia_release_operator','insignia_release_owner','MEMBER')
  THEN RAISE EXCEPTION 'Operator trusted-release privileges invalid'; END IF;
END $$;
