# Order detail rendering + secure downloads (Dashboard)

> **Last verified**: 2026-04-10

This doc describes how the embedded dashboard should render order line previews and provide secure download links for logo/artwork assets.

**Important**: For order rendering, always use the immutable geometry snapshot (`placementGeometrySnapshotByViewId`) from `OrderLineCustomization`, NOT the live config geometry. The snapshot captures what was ordered. See `docs/core/geometry-snapshot-specification.md` for details.

## Goals

- Merchant sees accurate previews (same placement geometry as storefront).
- Merchant can download the correct logo/artwork per placement.
- Asset links must not be publicly guessable.

## Authentication (embedded admin)

Dashboard → backend calls use Shopify **session tokens**:

- Frontend obtains a session token via Shopify App Bridge.
- Frontend sends `Authorization: Bearer <session_token>` to backend `/admin/*` endpoints.
- Backend MUST validate the session token on every request (tokens are short-lived and auto-refreshed by App Bridge).

Reference: https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens

## Data needed to render previews

Rendering should be done client-side (Konva), using the same primitives as the storefront modal:

For each order line customization, the dashboard needs:

- `OrderLineCustomization` (placements, step index per placement, `artworkStatus`, `logoAssetIdsByPlacementId`).
- `ProductConfig.placements` (placement steps and labels).
- `VariantViewConfiguration` for the order line's `variantId` and every `ProductView` (base `imageUrl` + `placementGeometry`).
- Resolved logo assets per placement:
  - if `logoAssetIdsByPlacementId[placementId] != null`, use that LogoAsset's `previewPngUrl`.
  - else (logo later), use `MerchantSettings.placeholderLogoImageUrl` if present, else render bold `LOGO` text.

Canonical schemas:

- `docs/core/data-schemas.md`

## Admin endpoints (recommended)

### Get order details

`GET /admin/orders/:id`

**Response shape (MVP, required):**

```json
{
  "order": {
    "id": "gid://shopify/Order/123",
    "name": "#1001",
    "createdAt": "2026-01-31T00:00:00Z",
    "financialStatus": "paid",
    "currency": "EUR"
  },
  "customizedLines": [
    {
      "shopifyLineId": "gid://shopify/LineItem/456",
      "variantId": "gid://shopify/ProductVariant/999",
      "productConfigId": "uuid",
      "quantity": 5,
      "artworkStatus": "PROVIDED",
      "placements": [
        { "placementId": "uuid", "stepIndex": 1 }
      ],
      "logoAssetIdsByPlacementId": {
        "uuid": "uuid"
      }
    }
  ],
  "productConfig": {
    "id": "uuid",
    "views": [{ "id": "uuid", "perspective": "front" }],
    "placements": [
      {
        "id": "uuid",
        "name": "Left chest",
        "basePriceAdjustmentCents": 500,
        "hidePriceWhenZero": false,
        "defaultStepIndex": 1,
        "steps": [{ "label": "Small", "priceAdjustmentCents": 0 }]
      }
    ]
  },
  "variantViewConfigurations": [
    {
      "variantId": "gid://shopify/ProductVariant/999",
      "viewId": "uuid",
      "imageUrl": "https://<signed-url-to-view-image>?expires=2026-01-31T00:45:00Z",
      "placementGeometry": {
        "uuid": { "centerXPercent": 50, "centerYPercent": 40, "maxWidthPercent": 30 }
      }
    }
  ],
  "logoAssets": [
    {
      "id": "uuid",
      "kind": "buyer_upload",
      "previewPngUrl": "https://<signed-url-to-logo-preview-png>?expires=2026-01-31T00:45:00Z",
      "sanitizedSvgUrl": "https://<signed-url-to-sanitized-svg>?expires=2026-01-31T00:45:00Z"
    }
  ],
  "downloads": {
    "lines": {
      "gid://shopify/LineItem/456": {
        "placements": {
          "uuid": {
            "png": "/admin/logo-assets/uuid/download?format=png",
            "svg": "/admin/logo-assets/uuid/download?format=svg"
          }
        }
      }
    }
  },
  "expiresInSeconds": 600
}
```

**Response contract rules:**
- All URLs intended for `<img>` tags (imageUrl, previewPngUrl, sanitizedSvgUrl) MUST be signed with a short-lived TTL (10 minutes).
- Signed image URLs expire at the timestamp in the query parameter (e.g., `expires=2026-01-31T00:45:00Z`).
- Download URLs MAY be authenticated endpoints (recommended), fetched using `authenticatedFetch` and saved as a Blob.
- Never return original (unsanitized) SVG; return sanitized SVG only per `docs/core/svg-upload-safety.md`.
- `expiresInSeconds` (600) applies to the entire response and all signed image URLs within it.

### Signed URL expiration (images only)

**Frontend responsibility:**
- Display or track `expiresInSeconds` from the response to know when to refresh.
- If an `<img>` fails to load due to 403/410, trigger a re-fetch of the entire order detail response to get fresh signed URLs.
- Do not cache image URLs beyond their expiration time.

**Backend implementation:**
- Use short-lived signing with a consistent clock (NTP-synced).
- TTL: 10 minutes (600 seconds) recommended for embedded admin workflows.
- Include the expiration timestamp in the URL query parameter for visibility and debugging.

### Download a placement artwork

Provide a backend download endpoint that requires admin Authorization and is fetched using `authenticatedFetch` (App Bridge).

Example:

`GET /admin/logo-assets/:logoAssetId/download?format=svg|png`

**Notes:**
- Backend MUST authenticate the request with `Authorization: Bearer <session_token>` validation.
- The dashboard should trigger downloads by fetching the bytes with Authorization and saving as a file (Blob download), rather than relying on `<a href>` with headers.
- Response MUST set `Content-Disposition: attachment; filename="..."` for a clean "save as" UX.
- Implement as a backend stream or return signed URLs; do not expose raw storage keys.

## Image URL strategy (best practice)

Images used in `<img>` tags cannot include Authorization headers.

Two acceptable approaches:

1. **Short-lived signed URLs (recommended for MVP):** Backend returns a time-limited signed GET URL for `imageUrl` and `previewPngUrl`. Tokens expire after 10 minutes; frontend re-fetches the order detail if images fail.
2. **Backend image proxy with one-time token:** Backend issues a short-lived opaque token embedded in the URL and validates it server-side.

For MVP, prefer (1) to keep implementation smaller.

Reference on signed URLs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html

## Rendering algorithm (per order line)

For each `ProductView`:

1. Load the base `VariantViewConfiguration.imageUrl` (PNG/JPG).
2. For each selected placement in `OrderLineCustomization.placements`:
   - Read `placementGeometry[placementId]` for this view; if null, skip (nothing to render on this view).
   - Resolve the logo preview:
     - if `logoAssetId` present: use its `previewPngUrl`
     - else: placeholder image or `LOGO` text
   - Render logo centered at `(centerXPercent, centerYPercent)` and scale to `maxWidthPercent`.

## Operational notes

- Keep download endpoints strictly authenticated; do not leak raw storage keys.
- Prefer returning sanitized SVG only (not original SVG) as described in `docs/core/svg-upload-safety.md`.
- Never store secrets, auth tokens, or PII in line item properties; use only IDs and hashes (properties are visible in Shopify Admin).
