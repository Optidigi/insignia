-- migrate:up
-- Earlier rows lack an independently persisted test-order fact. Keep them unknown;
-- only new verified provider reads supply an immutable boolean. Unknown is not non-test authority.
ALTER TABLE purchase_orders ADD COLUMN is_test boolean;
-- The existing purchase_orders_immutable trigger covers this new economic/audit field.
-- migrate:down
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM purchase_orders WHERE is_test IS NOT NULL) THEN
  RAISE EXCEPTION 'persisted purchase test authority prevents rollback';
 END IF;
END $$;
ALTER TABLE purchase_orders DROP COLUMN is_test;
