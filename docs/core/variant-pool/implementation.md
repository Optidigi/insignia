# Variant pool pricing (implementation)

This document contains the canonical implementation details for the variant pool approach.

> Source: split from the legacy `storefront-pricing-variant-pool.md` (not in this repo).

---

## MVP note: Cart aggregation (optional)

For MVP, cart line aggregation by config hash is **optional**. Storefront can always create a new slot variant per add-to-cart, avoiding the complexity of aggregation rules. If you choose not to aggregate:

- Omit `insignia_config_hash` and `insignia_pricing_version` from line item properties.
- Simplify slot reservation to: one slot per add-to-cart (no hash-based reuse).
- Each cart line is independent; no aggregation logic required.

You can add aggregation later by implementing the hash/version rules below without breaking existing orders.

---

## Original document (preserved)

The following content is preserved verbatim from the original doc to ensure no loss of details.

---

# Storefront Pricing (Non‑Plus): Variant Pool per Method

**Version**: 1.0  
**Date**: January 29, 2026  
**Audience**: Backend developers (implementation guide)  
**Goal**: Enable dynamic per-unit customization pricing on non‑Plus stores using a safe, scalable variant pool approach.

---

## 1. Problem and approach

Shopify non‑Plus stores cannot reliably override an existing product's price in the cart/checkout, so we represent customization cost using a purchasable "fee" line item whose price is set server-side.

This design uses:

- One **Unlisted** container product per customization method (e.g., Embroidery, DTG).
- A pool of "slot" variants per method that are updated to the calculated unit price for a given configuration.
- Storefront add-to-cart logic that **aggregates quantity** only when method + exact configuration match.

---

## 2. Invariants (do not break these)

### 2.1 Quantity aggregation rule

Aggregate into a single cart line **only** when:

- `insignia_method` matches, and
- `insignia_config_hash` matches, and
- `insignia_pricing_version` matches.

Never aggregate across different methods (Embroidery vs DTG).

### 2.2 Variant reuse safety rule

Slot variants are re-used over time, so we must avoid re-using a slot while an older cart might still contain it.

We solve that by modeling config lifecycle states and using conservative recycle TTLs.

---

## 3. Entities and state machine (canonical)

### Entities

- `CustomizationConfig` and `VariantSlot` are defined in `docs/core/data-schemas.md`.

### CustomizationConfig states

| State | Entered when | Exits when |
| --- | --- | --- |
| `RESERVED` | `/apps/insignia/prepare` succeeds | `cart-confirm` succeeds or reservation expires |
| `IN_CART` | `/apps/insignia/cart-confirm` succeeds | `orders/create` or TTL expiry |
| `ORDERED` | `orders/create` processed | `orders/paid` processed |
| `PURCHASED` | `orders/paid` processed | Slot recycled; config archived |
| `EXPIRED` | Reservation or cart TTL expires | Config cleaned up |

### VariantSlot states

| State | Entered when | Exits when |
| --- | --- | --- |
| `FREE` | Slot is available | `prepare` reserves slot |
| `RESERVED` | `/apps/insignia/prepare` succeeds | `cart-confirm` or reservation expiry |
| `IN_CART` | `/apps/insignia/cart-confirm` succeeds | `orders/paid` or cart TTL expiry |

TTL notes:
- `reservedUntil` is set during `prepare` (15 minutes recommended).
- `inCartUntil` is set during `cart-confirm` (long TTL; value is an ops decision).

---

## 6. Storefront endpoints (App Proxy)

### 6.1 POST /apps/insignia/prepare

Purpose: Given an already-priced draft customization, reserve a slot variant and make it purchasable at the correct unit price.

Backend must do:

1. Verify App Proxy signature and resolve `shop`.
2. Rate limit.
3. Enforce idempotency.
4. Load the draft by `customizationId` and validate it.
5. Use the canonical pricing result (or recompute) to obtain `pricing_version`, `config_hash`, `unit_price_cents`.
6. Upsert `customization_config` (one per shop+method+hash) in a transactional way.
7. Reserve a `FREE` slot variant atomically (DB transaction + row locking).
8. Update the slot variant in Shopify Admin API:
   - `price = unit_price`
   - `sku = INSIGNIA/<method>/<customization_config_id>`
   - variant metafield: `insignia.config_id = <customization_config_id>`
9. Return: `slot_variant_id`, `config_hash`, `pricing_version`, `unit_price_cents`.

State outputs:

- Set config/slot state to `RESERVED`.
- Set `reserved_until = now + 15 minutes`.

### 6.2 POST /apps/insignia/cart-confirm

Purpose: mark the config/slot as "in cart" so we do not recycle it prematurely.

Backend must do:

1. Verify App Proxy signature.
2. Validate `{ customizationId }`.
3. Transition config/slot to `IN_CART` with a long TTL.

---

## 8. Webhooks: order finalization and recycling (best practice)

Shopify webhook delivery is at-least-once and can be delayed; handlers must be idempotent and order-independent.

Recommended Shopify references:

- Webhook best practices: https://shopify.dev/docs/apps/build/webhooks/best-practices
- Ignore duplicates (dedupe by `X-Shopify-Event-Id`): https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates

### 8.0 Dedupe + async processing

- Verify webhook HMAC.
- Read `X-Shopify-Event-Id` and store it with unique constraint per shop; skip duplicates.
- Ack fast, enqueue heavy work.
- Implement a reconciliation job to re-fetch recent orders to repair missed webhooks.

### 8.1 orders/create

- For each line item that contains `properties._insignia_customization_id`:
  - Bind `(shop_id, order_id, line_item_id)` to that internal customization/config.
  - Set `customization_config.state = ORDERED`.

### 8.2 orders/paid (or financial status transition)

- For each line item that contains `properties._insignia_customization_id`:
  - Set `customization_config.state = PURCHASED`.
  - Recycle slot variant and mark slot `FREE`.

### 8.3 Optional (recommended)

- `orders/cancelled`: transition to `EXPIRED` and optionally recycle earlier.
- `orders/delete`: cleanup bindings.

---

## 10. External references

- Shopify Ajax Cart API reference (cart.js/add.js/change.js, line item key, properties): https://shopify.dev/docs/api/ajax/reference/cart
- Shopify app proxy authentication (cookie stripping): https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- Shopify webhooks best practices: https://shopify.dev/docs/apps/build/webhooks/best-practices
- Shopify ignore duplicates (X-Shopify-Event-Id): https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates
- Community note: line item keys can change after some cart operations: https://community.shopify.com/t/line-item-key-changing-if-add-update-delete-multiple-products-at-same-request-with-cart-api/3076
