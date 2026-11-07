-- Existing installation delta: schema owner only, no role creation or bootstrap reset.
-- Explicit psql identifiers web_role/worker_role name the existing web login and queue capability.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN (
   'public.purchase_order_labels'::regclass,
   'public.customer_order_erasure_fences'::regclass,
   'public.shop_privacy_fences'::regclass)
   AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
 THEN RAISE EXCEPTION 'order label schema owner required'; END IF;
END $$;
-- Eligibility checks need only these identifiers. No source receipt, timestamp,
-- customer payload, fence mutation or schema authority is granted.
GRANT SELECT(shop_id,order_id) ON public.customer_order_erasure_fences TO :"web_role", :"worker_role";
GRANT SELECT(shop_id,installation_generation) ON public.shop_privacy_fences TO :"web_role", :"worker_role";
COMMIT;
