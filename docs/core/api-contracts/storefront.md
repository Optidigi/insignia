# Storefront API contract (canonical)

This file is the canonical reference for backend storefront endpoints.

All storefront endpoints in this project are expected to be served behind the Shopify App Proxy path (e.g., `/apps/insignia/*`).

## Authentication

All storefront endpoints:

- MUST verify the App Proxy signature.
- MUST resolve the `shop`.
- MUST apply rate limiting.
- MUST apply a strict CORS allowlist.

Note: App proxies do not forward cookies; Shopify strips the `Cookie` header from proxy requests. Storefront endpoints MUST NOT depend on cookie-based sessions.

## End-to-end flow (MVP)

Pattern A (canonical):

1. `GET /apps/insignia/config` (load config + placeholder logo; response contract: `../storefront-config.md`)
2. Upload logo (optional): `POST /apps/insignia/uploads` (multipart/form-data) → `{ logoAsset: { id, kind, previewPngUrl, sanitizedSvgUrl? } }`
3. `POST /apps/insignia/customizations` (persist draft)
4. `POST /apps/insignia/price` (authoritative unit price + breakdown for review tab)
5. `POST /apps/insignia/prepare` (reserve variant-pool slot + set slot price)
6. Storefront updates cart using Shopify Ajax Cart API
7. `POST /apps/insignia/cart-confirm`

## Endpoint contracts

### Logo Upload

**Endpoint:** `POST /apps/insignia/uploads`

The storefront modal sends logo files to the app server — not directly to R2.

**Request:** `multipart/form-data`
- `file` — the logo file (SVG, PNG, JPG, or WebP; max 5 MB)

The shop is resolved from the App Proxy session signature — no `shopId` field is required in the request body.

**Response (200):**
```json
{
  "logoAsset": {
    "id": "uuid",
    "kind": "buyer_upload",
    "previewPngUrl": "https://...",
    "sanitizedSvgUrl": "https://..." 
  }
}
```
(`sanitizedSvgUrl` is only present when the uploaded file was SVG.)

**Server behaviour:**
1. Validates MIME type (SVG, PNG, JPG, WebP only). Rejects anything else with 415.
2. For SVG: sanitises with DOMPurify + JSDOM before storing.
3. Generates a PNG preview via Sharp.
4. Stores both files in Cloudflare R2 under `logos/<shopId>/<assetId>.*`.
5. Creates a `LogoAsset` DB record.
6. Returns the full `logoAsset` object.

> **Note:** R2 bucket CORS policy allows GET and PUT only. The upload goes through the app server, not directly from the browser to R2.

### POST /apps/insignia/customizations

Persist a draft customization for pricing and later checkout.

**Request body**
```json
{
  "productId": "gid://shopify/Product/123",
  "variantId": "gid://shopify/ProductVariant/456",
  "productConfigId": "uuid",
  "methodId": "uuid",
  "placements": [
    { "placementId": "uuid", "stepIndex": 1 }
  ],
  "logoAssetIdsByPlacementId": {
    "uuid": "uuid"
  },
  "artworkStatus": "PROVIDED"
}
```

**Response body**
```json
{
  "customizationId": "uuid"
}
```

### POST /apps/insignia/price

Compute authoritative unit pricing for the review tab.

**Request body**
```json
{
  "customizationId": "uuid"
}
```

**Response body**
```json
{
  "unitPriceCents": 2500,
  "breakdown": [
    { "label": "Base garment", "amountCents": 1500 },
    { "label": "Placements", "amountCents": 1000 }
  ],
  "validation": { "ok": true }
}
```

### POST /apps/insignia/prepare

Reserve a slot variant and set the purchasable price.

**Request body**
```json
{
  "customizationId": "uuid"
}
```

**Response body**
```json
{
  "slotVariantId": "gid://shopify/ProductVariant/999",
  "configHash": "hash",
  "pricingVersion": "v1",
  "unitPriceCents": 2500
}
```

### POST /apps/insignia/cart-confirm

Confirm the cart line after Shopify Ajax Cart API updates.

**Request body**
```json
{
  "customizationId": "uuid",
  "cartLine": {
    "variantId": "gid://shopify/ProductVariant/999",
    "quantity": 5,
    "properties": {
      "_insignia_customization_id": "uuid",
      "_insignia_method": "uuid",
      "_insignia_config_hash": "hash",
      "_insignia_pricing_version": "v1"
    }
  }
}
```

**Response body**
```json
{ "ok": true }
```

### Required cart line item properties

When the storefront adds the reserved slot variant to cart, it MUST attach the canonical Insignia line item properties (used by order webhooks to bind Shopify line items back to internal records).

**Always required:**
- `_insignia_customization_id`

**Required only if aggregation is enabled:**
- `_insignia_method`
- `_insignia_config_hash`
- `_insignia_pricing_version`

See the canonical webhook contract for the rationale and mapping rules: `./webhooks.md`.

### Cart aggregation (MVP: optional)

For MVP, cart line aggregation by config hash is **optional**. The storefront can always create a new slot variant per add-to-cart, avoiding aggregation complexity. If you choose not to aggregate:

- Omit `insignia_config_hash` and `insignia_pricing_version` from line item properties.
- Simplify slot reservation to: one slot per add-to-cart (no hash-based reuse).
- Each cart line is independent; no aggregation logic required.

You can add aggregation later by implementing the hash/version rules without breaking existing orders.

See `../variant-pool/implementation.md` for the full aggregation algorithm and when to use it.

### POST /apps/insignia/uploads/:id/refresh

Refresh the signed URLs on an existing `LogoAsset` (called when a presigned URL has expired).

**Response (200):**
```json
{
  "logoAsset": {
    "id": "uuid",
    "kind": "buyer_upload",
    "previewPngUrl": "https://...",
    "sanitizedSvgUrl": "https://..."
  }
}
```

### POST /apps/insignia/uploads/:id/complete

Marks an upload session as complete (used in flows where a presigned PUT was issued separately). In the current server-side multipart flow this is a no-op confirmation endpoint.

### Canonical references

- Storefront config response schema: `../storefront-config.md`
- Variant pool lifecycle + prepare/cart-confirm implementation notes: `../variant-pool/implementation.md`
- Integration guide (practical walkthrough): `../../storefront/integration-guide.md`

---

## External references

- Shopify Ajax Cart API reference (cart.js/add.js/change.js, line item key, properties): https://shopify.dev/docs/api/ajax/reference/cart
- Shopify app proxy authentication (cookie stripping): https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
