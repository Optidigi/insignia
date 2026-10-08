 SELECT json_build_object(
      'uninstallRuntimeUsable',has_schema_privilege('insignia_runtime','public','USAGE')
        AND NOT EXISTS(SELECT 1 FROM (VALUES
          ('shops','SELECT'),('shops','INSERT'),('shops','UPDATE'),
          ('installation_generations','SELECT'),('installation_generations','INSERT'),('installation_generations','UPDATE'),
          ('shop_credentials','SELECT'),('shop_credentials','UPDATE'),
          ('product_configs','SELECT'),('product_configs','UPDATE'),('publication_operations','SELECT'),
          ('inbox_messages','SELECT'),('inbox_messages','INSERT'),('inbox_messages','UPDATE'),('inbox_messages','DELETE'),
          ('shopify_webhook_deliveries','SELECT'),('shopify_webhook_deliveries','INSERT')) AS required(relation,privilege)
          WHERE NOT has_table_privilege('insignia_runtime','public.'||required.relation,required.privilege))
        AND NOT EXISTS(SELECT 1 FROM (VALUES
          ('pg_catalog.pg_advisory_xact_lock(bigint)'),('pg_catalog.hashtextextended(text,bigint)'),
          ('pg_catalog.gen_random_uuid()'),('pg_catalog.now()'),('pg_catalog.clock_timestamp()'),
          ('pg_catalog.jsonb_typeof(jsonb)'),('pg_catalog.convert_from(bytea,name)'),
          ('pg_catalog.length(text)'),('pg_catalog.lower(text)'),('pg_catalog.octet_length(text)'),
          ('pg_catalog.octet_length(bytea)'),('pg_catalog.count()')) AS required(signature)
          WHERE NOT has_function_privilege('insignia_runtime',required.signature,'EXECUTE')),
      'queueSchemaPresent', EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pgboss'),
      'queueRuntimeUsable',COALESCE((SELECT has_schema_privilege('insignia_runtime',oid,'USAGE') FROM pg_namespace WHERE nspname='pgboss'),false)
        AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind IN ('r','p'))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='pgboss' AND c.relkind IN ('r','p') AND EXISTS(SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege(name) WHERE NOT CASE WHEN n.nspname='pgboss' AND c.relkind IN ('r','p') THEN has_table_privilege('insignia_runtime',c.oid,privilege.name) ELSE true END))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind='S' AND NOT CASE WHEN n.nspname='pgboss' AND c.relkind='S' THEN has_sequence_privilege('insignia_runtime',c.oid,'USAGE') ELSE true END)
        AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pgboss' AND NOT has_function_privilege('insignia_runtime',p.oid,'EXECUTE')));
