# Variant pool pricing (overview)

This document summarizes the **why** and the invariants of the non‑Plus pricing approach.

For full details (tables, TTLs, algorithms), see `implementation.md`.

## Problem

Shopify non‑Plus stores cannot reliably override an existing product’s price in the cart/checkout, so we represent customization cost using a purchasable “fee” line item whose price is set server-side.

## Approach

- One **Unlisted** container product per method (e.g., Embroidery, DTG).
- A pool of “slot” variants per method whose price is updated to match the calculated unit price.
- Storefront aggregates quantity only when method + exact configuration match.

## Invariants (do not break)

- Quantity aggregation MUST match: `insignia_method`, `insignia_config_hash`, and `insignia_pricing_version`.
- Never aggregate across methods.
- Slot variants are reused, so we must avoid reusing a slot while an older cart/order might still contain it.

MVP note: Cart aggregation is optional; if you choose not to aggregate, omit the hash/version properties as described in [`implementation.md`](implementation.md).

Method note: `insignia_method` values map to `DecorationMethod.id` as defined in `docs/core/data-schemas.md`.

## Canonical implementation

- [`implementation.md`](implementation.md)
- Legacy consolidated reference: `storefront-pricing-variant-pool.md` (legacy, not in this repo)
