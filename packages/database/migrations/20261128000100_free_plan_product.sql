-- migrate:up
ALTER TABLE merchant_preferences
  ADD COLUMN free_product_id text,
  ADD COLUMN free_product_generation bigint,
  ADD CONSTRAINT merchant_preferences_free_product_choice CHECK (
    (free_product_id IS NULL AND free_product_generation IS NULL)
    OR (
      free_product_id IS NOT NULL AND free_product_id ~ '^[1-9][0-9]{0,19}$'
      AND free_product_generation IS NOT NULL AND free_product_generation > 0
    )
  );

-- migrate:down
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM merchant_preferences WHERE free_product_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Retain Free plan selections during rollback';
  END IF;
END
$$;
ALTER TABLE merchant_preferences
  DROP CONSTRAINT merchant_preferences_free_product_choice,
  DROP COLUMN free_product_generation,
  DROP COLUMN free_product_id;
