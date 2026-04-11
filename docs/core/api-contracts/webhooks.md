# Webhooks contract (canonical)

This file defines the webhook contracts Insignia relies on.

## Requirements

- Backend MUST verify Shopify webhook signatures.
- Webhook handlers MUST be idempotent.
- Webhook handlers SHOULD be asynchronous (ack fast, enqueue work) and resilient to delays.

Shopify best practices:

- Best practices: https://shopify.dev/docs/apps/build/webhooks/best-practices
- Ignore duplicates (use `X-Shopify-Event-Id`): https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates
- Raw body required for HMAC verification: https://shopify.dev/docs/apps/build/webhooks/subscribe/https

## Implementation checklist (quick)

Keep this handler "boring and reliable":

- Verify `X-Shopify-Hmac-Sha256` using the **raw** request body bytes (not parsed JSON).
- Use constant-time compare for the computed HMAC.
- Deduplicate using `X-Shopify-Event-Id` persisted in DB with unique constraint `(shop_id, event_id)`.
- Store `X-Shopify-Topic`, `X-Shopify-Shop-Domain`, and `X-Shopify-Event-Id` for audit/debugging.
- Respond within ~5 seconds; do heavy work asynchronously.
- Implement a reconciliation job (periodically fetch recent orders and repair state).

## Idempotency strategy (recommended)

Use Shopify's event identifier for deduplication:

- Read `X-Shopify-Event-Id`.
- Store it in `webhook_event` table with a unique constraint `(shop_id, event_id)`.
- If a duplicate arrives (unique constraint violation), skip processing.

Note: If you have multiple subscriptions for the same topic, Shopify can deliver multiple webhooks for the same event (one per subscription). Deduplication should happen on event id, not subscription id.

## Order webhooks (MVP)

Insignia uses order webhooks to:

- Finalize draft/customization state transitions.
- Safely recycle variant pool slots only when payment is confirmed.

Canonical variant-pool rules:

- [`../variant-pool/implementation.md`](../variant-pool/implementation.md)

### Required line item properties (MVP)

**Minimum required (for order binding):**

- `_insignia_customization_id` – REQUIRED. Internal customization record identifier; used to bind Shopify line to internal order state.

**Optional (implementation-dependent):**

- `_insignia_method` – Required only if cart aggregation is enabled or multi-method support is active.
- `_insignia_config_hash` – Required only if implementing cart line aggregation by config hash (see `../variant-pool/implementation.md`).
- `_insignia_pricing_version` – Required only if implementing cart line aggregation by pricing version (see `../variant-pool/implementation.md`).

**MVP note:** For MVP without cart aggregation, only `_insignia_customization_id` is necessary. Hash/version aggregation rules can be added later without breaking changes.

### orders/create

Purpose: detect Insignia lines on order creation and bind the Shopify order line to internal customization records.

Handler behavior:

- Verify webhook HMAC.
- Deduplicate using `X-Shopify-Event-Id`.
- For each line item:
  - Read `properties._insignia_customization_id`.
  - If present:
    - Bind `(shop_id, order_id, line_item_id)` to that customization/config record.
    - Capture current placement geometry snapshot for each order view (see `../geometry-snapshot-specification.md`).
- Transition:
  - `customization_config.state = ORDERED` (if it exists).
  - Leave `variant_slot.state` as-is (slot is still blocked by IN_CART/ORDERED TTL).

Notes:

- `orders/create` can arrive before or after `cart-confirm`; handlers must be order-independent and idempotent.

### orders/paid

Purpose: payment confirmed; safe moment to finalize and recycle variant pool slots.

Handler behavior:

- Verify webhook HMAC.
- Deduplicate using `X-Shopify-Event-Id`.
- Find each Insignia line by `_insignia_customization_id` and resolve its `customization_config_id`.
- Transition:
  - `customization_config.state = PURCHASED`.
  - Recycle the slot variant (reset price + clear metafields) and mark `variant_slot.state = FREE`.

Notes:

- If payment happens without an earlier `orders/create` being processed (rare but possible during outages), the handler must still work by resolving the order lines in the paid payload.

### Optional (recommended) webhooks

These improve lifecycle correctness but are not strictly required for MVP:

- `orders/cancelled`: mark config as `EXPIRED` (or `CANCELLED`) and optionally recycle slot earlier if you are certain checkout will not proceed.
- `orders/delete`: cleanup bindings.

### Product update webhooks

Product/variant update webhooks are not required for MVP. Configuration changes are managed via the admin API.

## Reconciliation (recommended)

Do not rely solely on webhooks; implement a periodic reconciliation job to fetch recent orders and repair state if a webhook was missed.

This follows Shopify's recommendation to implement reconciliation jobs for webhook reliability.
