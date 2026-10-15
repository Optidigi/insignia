-- Owner-applied after migrations33–34 and the qualified existing web/inspection grants.
-- No role creation, revocation, data mutation or activation. Unexpected authority aborts atomically.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$ DECLARE identity text; relation regclass; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_runtime' AND rolcanlogin
    AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_artwork_inspect' AND NOT
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'qualified_existing_preview_roles_required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    JOIN pg_roles parent ON parent.oid=m.roleid WHERE
      (r.rolname='insignia_runtime' AND (parent.rolname<>'insignia_queue_enqueue' OR m.admin_option)) OR
      r.rolname IN ('insignia_artwork_inspect','insignia_queue_enqueue')) OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_enqueue' AND NOT
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unqualified_preview_role_membership';
  END IF;
  FOREACH relation IN ARRAY ARRAY['public.merchant_preview_assets'::regclass,'public.config_revision_preview_assets'::regclass] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relkind='r'
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'merchant_preview_table_owner_required';
    END IF;
  END LOOP;
  FOREACH identity IN ARRAY ARRAY['insignia_runtime','insignia_artwork_inspect'] LOOP
    IF has_schema_privilege(identity,'public','CREATE') OR
      EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=identity)) OR
      EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=identity)) OR
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
          AND has_function_privilege(identity,p.oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'unqualified_preview_owner_or_definer';
    END IF;
    IF NOT has_table_privilege(identity,'public.shops','SELECT') OR
      NOT has_table_privilege(identity,'public.installation_generations','SELECT') OR
      NOT has_column_privilege(identity,'public.shops','updated_at','UPDATE') OR
      NOT has_column_privilege(identity,'public.installation_generations','deactivated_at','UPDATE') THEN
      RAISE EXCEPTION 'qualified_preview_tenant_locks_required';
    END IF;
  END LOOP;
END $$;
GRANT SELECT ON public.merchant_preview_assets,public.config_revision_preview_assets TO insignia_runtime,insignia_artwork_inspect;
GRANT INSERT(asset_id,shop_id,installation_generation,product_id,image_revision_id,original_key,preview_key,
  manifest,collected_at,abandon_at,state) ON public.merchant_preview_assets TO insignia_runtime;
GRANT UPDATE(state,claim_id,updated_at) ON public.merchant_preview_assets TO insignia_runtime;
GRANT INSERT(shop_id,config_id,revision_id,installation_generation,product_id,image_revision_id,asset_id)
  ON public.config_revision_preview_assets TO insignia_runtime;
GRANT UPDATE(state,manifest,updated_at) ON public.merchant_preview_assets TO insignia_artwork_inspect;
-- Check effective privileges (including inherited/PUBLIC column grants), never launder them by revocation.
DO $$ DECLARE identity text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE c.oid IN ('public.merchant_preview_assets'::regclass,'public.config_revision_preview_assets'::regclass)
      AND acl.grantee=0) OR
    EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid IN ('public.merchant_preview_assets'::regclass,'public.config_revision_preview_assets'::regclass)
        AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee=0) THEN
    RAISE EXCEPTION 'unqualified_preview_public_access';
  END IF;
  FOREACH identity IN ARRAY ARRAY['insignia_runtime','insignia_artwork_inspect'] LOOP
    IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE c.oid IN ('public.merchant_preview_assets'::regclass,'public.config_revision_preview_assets'::regclass) AND (
        NOT has_column_privilege(identity,c.oid,a.attnum,'SELECT') OR
        has_table_privilege(identity,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
        has_column_privilege(identity,c.oid,a.attnum,'REFERENCES') OR
        has_column_privilege(identity,c.oid,a.attnum,'INSERT') IS DISTINCT FROM
          (identity='insignia_runtime' AND (c.relname='config_revision_preview_assets' OR a.attname IN
            ('asset_id','shop_id','installation_generation','product_id','image_revision_id','original_key','preview_key','manifest','collected_at','abandon_at','state'))) OR
        has_column_privilege(identity,c.oid,a.attnum,'UPDATE') IS DISTINCT FROM
          (c.relname='merchant_preview_assets' AND (a.attname IN ('state','updated_at') OR
            (identity='insignia_runtime' AND a.attname='claim_id') OR
            (identity='insignia_artwork_inspect' AND a.attname='manifest')))
      )) THEN RAISE EXCEPTION 'unqualified_preview_column_access'; END IF;
  END LOOP;
END $$;
COMMIT;
