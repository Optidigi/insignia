# Testing the storefront API

Ways to test the storefront endpoints **now** (without the modal) and **later** (with the modal).

Canonical contracts: [`docs/core/api-contracts/storefront.md`](../core/api-contracts/storefront.md), [`docs/core/storefront-config.md`](../core/storefront-config.md).

## Prerequisites

- App installed on a **development store**.
- App reachable via **App Proxy** (tunnel in dev, e.g. `shopify app dev`, or deployed URL in production).
- At least one **product config** with linked product, variant view images, and placements (so `GET /config` returns real data).

---

## 1. Test right now (no modal)

### Option A: Browser address bar (config only)

For a quick config check, open:

```text
https://<your-dev-store>.myshopify.com/apps/insignia/config?productId=gid://shopify/Product/XXX&variantId=gid://shopify/ProductVariant/YYY
```

Replace `XXX` and `YYY` with real IDs from your dev store and product config. You should get JSON (or a 404 if no config links that product).

### Option B: Browser console on any store page

On any page of the store (e.g. a product page), open DevTools → Console and run:

```js
fetch('/apps/insignia/config?productId=gid://shopify/Product/XXX&variantId=gid://shopify/ProductVariant/YYY')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
```

Again, use real product/variant GIDs. Requests are same-origin, so the proxy signs them.

### Option C: Verify App Proxy signature

To confirm the proxy is wired and signing correctly:

```text
https://<your-dev-store>.myshopify.com/apps/insignia/test
```

You should get JSON like `{ success: true, shop: "your-store.myshopify.com", ... }`. If you tamper with the URL (e.g. change `shop=`), you should get 401.

---

## 2. Test later with the frontend modal

Once the storefront modal exists:

- **Normal path**: Use the theme “Customize” entry point (or App Embed) so the modal opens on the product page. The modal will call the same endpoints in order: config → (uploads multipart POST) → customizations → price → prepare → cart update → cart-confirm.
- **Easier debugging**: In the modal, log API errors and optionally show a small “Debug” panel (e.g. last request/response or `customizationId`) when a query param like `?insignia_debug=1` is present.

No extra backend work is required for modal testing.

---

## 3. Endpoint checklist

| Step | Method | Path | What to provide |
|------|--------|------|------------------|
| 1 | GET | `/apps/insignia/config` | `productId`, `variantId` (query) |
| 2 | POST | `/apps/insignia/uploads` | `multipart/form-data` with `file` field (SVG/PNG/JPG/WebP, max 5 MB) → returns `{ logoAsset: { id, kind, previewPngUrl, sanitizedSvgUrl? } }` |
| 3 | POST | `/apps/insignia/customizations` | draft payload (productId, variantId, productConfigId, methodId, placements, logoAssetIdsByPlacementId, …) |
| 4 | POST | `/apps/insignia/price` | `customizationId` (body) |
| 5 | POST | `/apps/insignia/prepare` | `customizationId` (body) |
| 6 | POST | `/apps/insignia/cart-confirm` | `customizationId` (body) |

Prepare requires at least one **FREE** variant slot for the method (variant pool). If you get 503 “No available slot”, create variant slots in the admin or seed the DB.

---

## Sources

- Tier 1: `docs/core/api-contracts/storefront.md`, `docs/core/storefront-config.md`, `docs/storefront/integration-guide.md`
- This doc: Tier 2 (testing workflow)
