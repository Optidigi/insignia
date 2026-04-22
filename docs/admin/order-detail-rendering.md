# Order detail rendering (Dashboard)

> **Last verified**: 2026-04-23

This doc describes how the embedded dashboard renders order line previews and provides download links for logo/artwork assets.

**Important**: For order rendering always use the immutable geometry snapshot (`placementGeometrySnapshotByViewId`) from `OrderLineCustomization`, NOT the live config geometry. The snapshot captures what was ordered. See `docs/core/geometry-snapshot-specification.md` for details.

## Implementation pattern

Order data is loaded by the **React Router loader** in `app.orders.$id.tsx` — there is no separate JSON endpoint. The loader returns all data needed to render the page in one pass. The frontend renders client-side using Konva.

## Goals

- Merchant sees accurate previews (same placement geometry as the storefront at time of order).
- Merchant can download the correct logo/artwork per placement.
- Asset links must not be publicly guessable (presigned R2 URLs, 10-minute TTL).

## Authentication

The page route is authenticated by `authenticate.admin(request)` from `@shopify/shopify-app-react-router`. No manual session token handling required.

## Data returned by the loader

The loader for `app.orders.$id.tsx` returns (approximate shape):

```ts
{
  order: {
    id: string,            // Shopify Order GID
    name: string,          // "#1001"
    createdAt: string,
    financialStatus: string,
    currencyCode: string,
    orderStatusUrl: string | null,
    customer: { name, email } | null,
  },
  customizedLines: Array<{
    shopifyLineId: string,
    variantId: string,
    productConfigId: string,
    quantity: number,
    artworkStatus: "PROVIDED" | "PENDING_CUSTOMER",
    productionStatus: ProductionStatus,
    placements: Array<{ placementId: string, stepIndex: number }>,
    logoAssetIdsByPlacementId: Record<string, string | null>,
    placementGeometrySnapshotByViewId: Record<string, Record<string, PlacementGeometry | null> | null> | null,
    feeShopifyVariantId: string | null,
  }>,
  allShopifyLineItems: Array<{ ... }>,  // all lines for full order context
  productConfig: {
    id: string,
    views: Array<{ id, perspective, name }>,
    placements: Array<{ id, name, basePriceAdjustmentCents, hidePriceWhenZero, defaultStepIndex, steps }>
  },
  variantViewConfigurations: Array<{
    variantId: string,
    viewId: string,
    imageUrl: string | null,  // presigned R2 URL (10-min TTL)
    placementGeometry: Record<string, PlacementGeometry | null> | null,
  }>,
  logoAssets: Array<{
    id: string,
    kind: "buyer_upload" | "merchant_placeholder",
    previewPngUrl: string,        // presigned R2 URL
    sanitizedSvgUrl: string | null, // presigned R2 URL
    downloadUrl: string,          // presigned R2 URL for download
  }>,
  notes: Array<{
    id: string,
    body: string,
    authorName: string | null,
    createdAt: string,
  }>,
  emailReminderTemplate: string | null,
  productionQcEnabled: boolean,
}
```

## Asset URL strategy

- All image URLs (`imageUrl`, `previewPngUrl`, `sanitizedSvgUrl`) are **presigned R2 URLs** with a 10-minute TTL.
- Download URLs are also presigned R2 URLs. The frontend triggers a download by fetching with `authenticatedFetch` (App Bridge) and saving as a Blob — there is no separate `/admin/logo-assets/:id/download` endpoint.
- If an `<img>` returns 403 (expired URL), trigger a full re-fetch of the loader to get fresh signed URLs.
- Never expose raw R2 storage keys to the frontend.

## Rendering algorithm (per order line, per view)

For each `ProductView`:

1. Load the base `VariantViewConfiguration.imageUrl` (presigned R2 PNG/JPG).
2. For each selected placement in `OrderLineCustomization.placements`:
   - Read geometry from `placementGeometrySnapshotByViewId[viewId][placementId]`; if null, skip (placement not on this view).
   - Resolve the logo preview:
     - if `logoAssetIdsByPlacementId[placementId]` is set → use that `LogoAsset.previewPngUrl`
     - else if merchant placeholder configured → use `MerchantSettings.placeholderLogoImageUrl`
     - else → render bold `LOGO` text
   - Render logo centered at `(centerXPercent, centerYPercent)`, scale to `maxWidthPercent` (and `maxHeightPercent` if set).

## Operational notes

- Use `placementGeometrySnapshotByViewId` (immutable) not live config geometry.
- Return only `sanitizedSvgUrl` (never original unsanitized SVG) per `docs/core/svg-upload-safety.md`.
- Never store secrets or PII in line item properties; use only IDs and hashes.
