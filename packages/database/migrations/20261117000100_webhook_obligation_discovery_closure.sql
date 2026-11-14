-- migrate:up
-- #488. In the "unsupported" category an erased receipt stops counting as an
-- open obligation only when it is settled:
-- - processed (any topic); or
-- - orders/create, orders/paid or orders/updated, when that order is recorded
--   in purchase_orders for the receipt's shop generation (order ID from the
--   captured `id` fact), was created no more than 60 days before the receipt
--   arrived (so order discovery, which sees only that window without
--   read_all_orders, could return it), and that generation's discovery
--   watermark (advanced only by a completed window) has passed the arrival.
-- refunds/create closes only when processed: its captured facts hold no order
-- ID. Once the 180-day fact erasure empties captured_fields the order ID is
-- gone and an unprocessed receipt counts again: an alert that returns is
-- acceptable, a silent closure is not. Nothing is written: the receipt keeps
-- its state, attempts and failure class, and its facts are untouched.
-- Uninstall, privacy and unknown categories keep their complete counts.
-- CREATE OR REPLACE keeps the owner, SECURITY DEFINER and EXECUTE grants.
CREATE OR REPLACE FUNCTION pending_shopify_webhook_obligations(maximum_rows integer)
RETURNS TABLE(id uuid, state text, topic text, category_count bigint, unresolved_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF maximum_rows IS NULL OR maximum_rows<1 OR maximum_rows>100 THEN RAISE EXCEPTION 'invalid obligation limit'; END IF;
  RETURN QUERY WITH classified AS (
    SELECT inbox.id,inbox.state::text AS receipt_state,delivery.topic::text AS receipt_topic,
      facts.fulfill_by,
      CASE WHEN delivery.topic='app/uninstalled' THEN 'uninstall'
        WHEN delivery.topic IN ('customers/data_request','customers/redact','shop/redact') THEN 'privacy'
        WHEN delivery.topic IS NULL THEN 'unknown' ELSE 'unsupported' END AS category
    FROM public.webhook_obligation_facts facts
    JOIN public.inbox_messages inbox ON inbox.id=facts.inbox_id
    LEFT JOIN public.shopify_webhook_deliveries delivery ON delivery.inbox_id=inbox.id
    WHERE delivery.topic IS NULL
      OR delivery.topic IN ('app/uninstalled','customers/data_request','customers/redact','shop/redact')
      OR NOT (inbox.state='processed' OR (
        delivery.topic IN ('orders/create','orders/paid','orders/updated')
        AND EXISTS (SELECT 1 FROM public.purchase_orders purchase
          WHERE purchase.shop_id=inbox.shop_id
            AND purchase.installation_generation=inbox.installation_generation
            AND purchase.order_id='gid://shopify/Order/'||(facts.captured_fields->>'id')
            AND purchase.order_created_at>=inbox.received_at-interval '60 days')
        AND EXISTS (SELECT 1 FROM public.purchase_reconciliation_cursors discovery
          WHERE discovery.shop_id=inbox.shop_id
            AND discovery.installation_generation=inbox.installation_generation
            AND discovery.watermark>=inbox.received_at)))
  ), ranked AS (
    SELECT classified.*,
      count(*) OVER (PARTITION BY category) AS total,
      count(*) FILTER (WHERE receipt_state<>'processed') OVER (PARTITION BY category) AS unresolved,
      row_number() OVER (PARTITION BY category ORDER BY fulfill_by,classified.id) AS position
    FROM classified
  ) SELECT ranked.id,receipt_state,receipt_topic,total,unresolved FROM ranked
    WHERE position<=maximum_rows ORDER BY category,fulfill_by,ranked.id;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION pending_shopify_webhook_obligations(maximum_rows integer)
RETURNS TABLE(id uuid, state text, topic text, category_count bigint, unresolved_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF maximum_rows IS NULL OR maximum_rows<1 OR maximum_rows>100 THEN RAISE EXCEPTION 'invalid obligation limit'; END IF;
  -- Counts cover every immutable fact, including erased/processed history.
  -- Sample IDs are bounded independently per diagnostic category; old receipts
  -- in one category cannot hide another. Headers still confer no authority.
  RETURN QUERY WITH classified AS (
    SELECT inbox.id,inbox.state::text AS receipt_state,delivery.topic::text AS receipt_topic,
      facts.fulfill_by,
      CASE WHEN delivery.topic='app/uninstalled' THEN 'uninstall'
        WHEN delivery.topic IN ('customers/data_request','customers/redact','shop/redact') THEN 'privacy'
        WHEN delivery.topic IS NULL THEN 'unknown' ELSE 'unsupported' END AS category
    FROM public.webhook_obligation_facts facts
    JOIN public.inbox_messages inbox ON inbox.id=facts.inbox_id
    LEFT JOIN public.shopify_webhook_deliveries delivery ON delivery.inbox_id=inbox.id
  ), ranked AS (
    SELECT classified.*,
      count(*) OVER (PARTITION BY category) AS total,
      count(*) FILTER (WHERE receipt_state<>'processed') OVER (PARTITION BY category) AS unresolved,
      row_number() OVER (PARTITION BY category ORDER BY fulfill_by,classified.id) AS position
    FROM classified
  ) SELECT ranked.id,receipt_state,receipt_topic,total,unresolved FROM ranked
    WHERE position<=maximum_rows ORDER BY category,fulfill_by,ranked.id;
END $$;
