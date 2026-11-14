-- migrate:up
-- #488. In the "unsupported" category an erased receipt stops counting as an
-- open obligation only when it is settled by evidence of its own effect:
-- - processed (any topic);
-- - orders/create: its order (the captured `id`) is in purchase_orders for the
--   receipt's shop generation;
-- - orders/paid: that purchase also has its purchase_paid_facts row;
-- - orders/updated: that purchase has a purchase_observations row observed at
--   or after the receipt arrived (stays open when nothing observable changed:
--   noise, never a silent closure).
-- A discovery watermark alone is no evidence: Shopify returns only orders
-- created in the 60 days before the query, so a stalled discovery can pass a
-- receipt whose order it can no longer read.
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
      OR NOT (inbox.state='processed' OR EXISTS (
        SELECT 1 FROM public.purchase_orders purchase
        WHERE purchase.shop_id=inbox.shop_id
          AND purchase.installation_generation=inbox.installation_generation
          AND purchase.order_id='gid://shopify/Order/'||(facts.captured_fields->>'id')
          AND (delivery.topic='orders/create'
            OR (delivery.topic='orders/paid' AND EXISTS (SELECT 1 FROM public.purchase_paid_facts paid
              WHERE paid.purchase_id=purchase.purchase_id))
            OR (delivery.topic='orders/updated' AND EXISTS (SELECT 1 FROM public.purchase_observations observation
              WHERE observation.purchase_id=purchase.purchase_id AND observation.observed_at>=inbox.received_at)))))
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
