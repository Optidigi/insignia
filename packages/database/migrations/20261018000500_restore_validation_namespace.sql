-- migrate:up
-- COPY invokes availability CHECK predicates under pg_restore's empty search_path.
-- Pin only these existing helpers; preserve their bodies and historical payload semantics.
-- Conditional presence also permits this exact correction on sealed older schemas during restore.
DO $$
DECLARE signature text; target regprocedure;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.m5_v3_json(jsonb)',
  'public.m5_v3_digest(jsonb)',
  'public.m5_v3_ids(jsonb,integer)',
  'public.m5_v3_keys(jsonb,text[],text[])',
  'public.m5_v3_facts(jsonb)',
  'public.m5_v3_snapshot(jsonb)',
  'public.m5_v3_same(jsonb,jsonb,jsonb)',
  'public.m5_v3_held(jsonb,jsonb)',
  'public.m5_v3_ack(jsonb,jsonb,text)',
  'public.m5_v3_ack_qualified(jsonb)',
  'public.m5_v3_mismatch(jsonb,jsonb)',
  'public.m5_v3_hold(jsonb)'
 ] LOOP
  target := pg_catalog.to_regprocedure(signature);
  IF target IS NOT NULL THEN
   EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path=pg_catalog,public,pg_temp', target);
  END IF;
 END LOOP;
END $$;

-- migrate:down
-- Keep the namespace correction: reverting it would invalidate recovery of retained records.
