-- Qualification-only owner operation after exact migration37. No login, provider, deployment or billing authority.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume') THEN
    RAISE EXCEPTION 'existing_usage_runtime_role_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume' AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unqualified_usage_runtime_role'; END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname='insignia_queue_consume') THEN RAISE EXCEPTION 'unqualified_usage_runtime_membership'; END IF;
  IF (SELECT array_agg(version::text ORDER BY version::text) FROM public.schema_migrations) IS DISTINCT FROM
    ARRAY['20260929000100','20260929000200','20260929000300','20260929000400','20260930000100','20260930000200','20260930000300','20260930000400','20260930000500','20260930000600','20260930000700','20260930000800','20260930000900','20261006000100','20261007000100','20261008000100','20261009000100','20261009000200','20261011000100','20261011000200','20261012000100','20261012000200','20261012000300','20261012000400','20261012000500','20261013000100','20261013000200','20261013000300','20261013000400','20261013000500','20261013000600','20261014000100','20261015000100','20261015000200','20261015000300','20261015000400','20261015000500']::text[] THEN RAISE EXCEPTION 'exact_usage_schema37_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.m9_order_usage'::regclass,
    'public.m9_usage_delivery_intents'::regclass,'public.m9_usage_delivery_attempts'::regclass) AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'usage_table_owner_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='insignia_queue_consume') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='insignia_queue_consume') OR
    has_schema_privilege('insignia_queue_consume','public','CREATE') THEN
    RAISE EXCEPTION 'unqualified_usage_runtime_ownership'; END IF;
  -- PUBLIC access is independently forbidden, even where the worker's own grant permits the operation.
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
      WHERE c.oid IN ('public.m9_order_usage'::regclass,'public.m9_usage_delivery_intents'::regclass,'public.m9_usage_delivery_attempts'::regclass)
        AND acl.grantee=0) OR
    EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid IN ('public.m9_order_usage'::regclass,'public.m9_usage_delivery_intents'::regclass,'public.m9_usage_delivery_attempts'::regclass)
        AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee=0) THEN
    RAISE EXCEPTION 'unqualified_usage_public_access'; END IF;
  IF has_table_privilege('insignia_queue_consume','public.m9_usage_delivery_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.m9_usage_delivery_attempts'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND (has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'SELECT') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'INSERT') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'UPDATE') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'REFERENCES'))) OR
    has_table_privilege('insignia_queue_consume','public.m9_order_usage','DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
    has_table_privilege('insignia_queue_consume','public.m9_usage_delivery_intents','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.m9_order_usage'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('first_paid_at','qualification','decision','history_policy_hash')
      AND (has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'UPDATE') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'REFERENCES'))) OR
    EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.m9_usage_delivery_intents'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND (has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'INSERT') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'UPDATE') OR
        has_column_privilege('insignia_queue_consume',a.attrelid,a.attnum,'REFERENCES'))) THEN
    RAISE EXCEPTION 'unqualified_usage_runtime_mutation'; END IF;
END $$;
GRANT SELECT,INSERT ON public.m9_order_usage TO insignia_queue_consume;
GRANT UPDATE(first_paid_at,qualification,decision,history_policy_hash) ON public.m9_order_usage TO insignia_queue_consume;
GRANT SELECT ON public.m9_usage_delivery_intents TO insignia_queue_consume;
COMMIT;
