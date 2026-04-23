# Storefront integration guide

This doc describes how the storefront modal interacts with backend + Shopify.

**Testing (no modal):** See [testing.md](testing.md) for how to call the API now (browser, console) and later with the modal.

It is a practical implementation guide; canonical endpoint shapes live in:

- `docs/core/api-contracts/storefront.md`

## End-to-end flow (MVP)

Pattern A (canonical):

1. Load config: `GET /apps/insignia/config?productId=<gid>&variantId=<gid>`.
2. (Optional) Upload logo: `POST /apps/insignia/uploads` (multipart/form-data, `file` field) → returns `{ logoAsset: { id, kind, previewPngUrl, sanitizedSvgUrl? } }`.
3. Persist draft: `POST /apps/insignia/customizations`.
4. Price for review tab: `POST /apps/insignia/price`.
5. Reserve slot + set checkout price: `POST /apps/insignia/prepare`.
6. Update Shopify cart using Ajax Cart API.
7. Verify cart line + metadata: `POST /apps/insignia/cart-confirm`.

## Config load

The modal loads a complete deterministic config (views for the selected variant, placements, step schedules, placeholder logo rules).

Canonical references:

- Storefront API: [`../core/api-contracts/storefront.md`](../core/api-contracts/storefront.md)
- Storefront config shape: [`../core/storefront-config.md`](../core/storefront-config.md)

## Upload + Logo later

Upload types: `.svg`, `.png`, `.jpg`, `.webp` up to 5 MB.

If buyer chooses "Logo later":

- The modal MUST still render a placeholder logo (merchant placeholder image if configured, else bold `LOGO`).
- The placeholder is duplicated across all selected placements.

Canonical references:

- Modal behavior: [`modal-spec.md`](modal-spec.md)
- SVG safety: [`../core/svg-upload-safety.md`](../core/svg-upload-safety.md)

## Review tab pricing

The review tab MUST show backend-authoritative pricing.

Implementation:

- After the buyer selects quantities, call `/apps/insignia/customizations` to persist draft state.
- Call `/apps/insignia/price` and render the returned `unitPriceCents` and `breakdown`.
- Only proceed to `/prepare` if `/price.validation.ok = true`.

Canonical reference:

- Storefront API: [`../core/api-contracts/storefront.md`](../core/api-contracts/storefront.md)

## Cart update (non‑Plus)

After `/prepare` returns a `slotVariantId` and insignia identifiers, update the cart via Ajax Cart API.

### Recommended cart algorithm

1. `GET /cart.js` (to get existing items + `key` values).
2. If there is an existing line that matches the same configuration (method + config hash + pricing version), update that line's quantity using `POST /cart/change.js` with its current `key`.
3. Otherwise add a new line using `POST /cart/add.js` with:
   - the slot variant ID
   - quantity
   - required line item properties
4. `GET /cart.js` again.
5. Call `POST /apps/insignia/cart-confirm` with a minimal cart snapshot.

### Cart API safety rules (Shopify)

**Line item key non-persistence:**
- The line item `key` can change after mutations, property changes, discounts, or background app modifications.
- Always re-fetch `/cart.js` after any add/change request.
- If a cart mutation returns `400 "no valid id or line parameter"`, the key is likely stale: immediately re-fetch `/cart.js`, locate the intended line again, and retry with the fresh `key`.

**Properties overwrite behavior:**
- `POST /cart/change.js` with `properties` OVERWRITES the entire properties object.
- Any key not included in your request is deleted.
- Never send `properties` unless you intend to replace the full set.
- Correct pattern: fetch existing properties, merge your changes, send the complete merged object.

**Private underscore properties:**
- Underscore-prefixed properties (e.g., `_insignia_customization_id`) are hidden at checkout but visible in Shopify Admin order details.
- Only store IDs, hashes, and internal references—never store secrets, auth tokens, or PII.

Canonical Shopify reference:

- Shopify Ajax Cart API reference: https://shopify.dev/docs/api/ajax/reference/cart

### Required line item properties

Must be set on the slot line:

- `_insignia_customization_id`
- `_insignia_method`
- `_insignia_config_hash`
- `_insignia_pricing_version`

Canonical references:

- Variant pool overview: [`../core/variant-pool/overview.md`](../core/variant-pool/overview.md)
- Variant pool implementation: [`../core/variant-pool/implementation.md`](../core/variant-pool/implementation.md)
- Storefront API contract (cart-confirm): [`../core/api-contracts/storefront.md`](../core/api-contracts/storefront.md)

External references (Shopify + community)

- Shopify Ajax Cart API reference (cart.js/add.js/change.js, line item key, properties): https://shopify.dev/docs/api/ajax/reference/cart
- Shopify line_item object (key/properties details): https://shopify.dev/docs/api/liquid/objects/line_item
- Shopify app proxy authentication (cookie stripping, signature verification): https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- Community note: line item keys can change after some cart operations: https://community.shopify.com/t/line-item-key-changing-if-add-update-delete-multiple-products-at-same-request-with-cart-api/3076
- Practical explanation of underscore-prefixed "private" properties: https://nozzlegear.com/shopify/using-javascript-to-manage-a-shopify-cart

## Backend protections

For storefront endpoints, backend MUST:

- Verify App Proxy signature.
- Enforce rate limiting.
- Apply a strict CORS allowlist.

Canonical reference:

- Auth & verification: [`../core/auth.md`](../core/auth.md)
