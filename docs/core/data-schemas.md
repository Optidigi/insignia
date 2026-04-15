# Data schemas (canonical)

> **Last verified against prisma/schema.prisma**: 2026-04-10

This file defines the canonical shape and meaning of shared data objects.

If a field is described here, other docs MUST link here instead of duplicating definitions.

## ProductConfig

Connects one or more Shopify products to customization rules.

- `id` (UUID): internal ID.
- `shopId` (UUID): owning shop.
- `name` (string): merchant-visible setup name.
- `linkedProductIds` (string[]): Shopify product GIDs.
- `presetKey` (string | null): preset applied at creation — "t-shirt", "hoodie", "polo", "cap", or null.
- `views` (ProductView[]): supported perspectives (front/back/etc.). Each view owns its own placements.
- `allowedMethods` (ProductConfigMethod[]): many-to-many relation to DecorationMethod via join table.

## ProductConfigMethod (join table)

Links ProductConfig to DecorationMethod (many-to-many).

- `productConfigId` (UUID)
- `decorationMethodId` (UUID)

## DecorationMethod

Represents a configurable decoration method (e.g., Embroidery, DTG).

- `id` (UUID): stable method identifier used for variant pools and line item properties.
- `shopId` (UUID): owning shop.
- `name` (string): merchant-visible label.
- `basePriceCents` (integer): base price for this method.
- `description` (string | null): merchant-facing notes.
- `customerName` (string | null): storefront display name (falls back to `name`).
- `customerDescription` (string | null): storefront method selector text.
- `artworkConstraints` (JSON | null): `{ fileTypes: string[], maxColors: number, minDpi: number }`.

## ProductView

A view is a perspective (front/back/left/right/etc.) and does not include color-specific assets.

- `id` (UUID): internal ID.
- `productConfigId` (UUID): owning config.
- `perspective` (enum): `front` | `back` | `left` | `right` | `side` | `custom`.
- `name` (string | null): custom name (used when perspective is `custom`).
- `displayOrder` (integer): sort order.
- `defaultImageKey` (string | null): R2 key for the view-level default image.
- `placementGeometry` (JSON | null): shared zone geometry, overridable per-variant.
- `sharedZones` (boolean, default true): whether geometry is shared across variants.

## VariantViewConfiguration

Variant-specific view image + optional per-variant placement geometry override.

- `productConfigId` (UUID)
- `variantId` (string): Shopify variant GID.
- `viewId` (UUID)
- `imageUrl` (URL | null): R2 URL for variant-specific image.
- `placementGeometry` (JSON | null): map `{ [placementId: string]: PlacementGeometry | null }`. Overrides the view-level geometry when set.

## PlacementDefinition

Defines a print area on a specific product view (e.g., "Left Chest" on the "Front" view). Each view owns its own placements — switching views shows different print areas.

- `id` (UUID)
- `productViewId` (UUID): the view this placement belongs to.
- `name` (string)
- `basePriceAdjustmentCents` (integer): placement-specific price delta.
- `hidePriceWhenZero` (boolean): suppress price display when the adjustment is zero.
- `defaultStepIndex` (integer): which size tier is selected by default.
- `displayOrder` (integer): sort order.
- `steps` (PlacementStep[]): logo size tiers.

## PlacementStep

A size tier within a placement (e.g., Small / Medium / Large).

- `id` (UUID)
- `label` (string): display name.
- `priceAdjustmentCents` (integer): price delta for this tier.
- `scaleFactor` (float, default 1.0): logo scale multiplier.
- `displayOrder` (integer): sort order.

## PlacementGeometry

Percent-based geometry relative to the view image. Used in both `ProductView.placementGeometry` and `VariantViewConfiguration.placementGeometry`.

- `centerXPercent` (number 0–100)
- `centerYPercent` (number 0–100)
- `maxWidthPercent` (number 0–100)

Validation:

- Values MUST be finite numbers (not NaN).
- Values MUST be within the inclusive range 0–100.
- Backend APIs SHOULD reject invalid geometry with a 400 (do not silently clamp).

## MerchantSettings

- `id` (UUID)
- `shopId` (UUID, unique)
- `placeholderLogoImageUrl` (URL | null): merchant-provided placeholder used when buyer selects "Logo later".
- `setupGuideDismissedAt` (timestamp | null): tracks whether the setup guide has been dismissed.

## LogoAsset

Represents a buyer-provided (or merchant-provided placeholder) logo.

- `id` (UUID)
- `shopId` (UUID)
- `kind` (`buyer_upload` | `merchant_placeholder`)
- `sanitizedSvgUrl` (URL | null)
- `previewPngUrl` (URL): always present for rendering.
- `originalFileName` (string | null)
- `fileSizeBytes` (integer | null)

## OrderLineCustomization

Internal record linking a Shopify line item to an Insignia customization.

- `id` (UUID)
- `shopifyOrderId` (string): Shopify Order GID.
- `shopifyLineId` (string): Shopify Line Item GID.
- `productConfigId` (UUID)
- `variantId` (string): Shopify variant GID.
- `customizationConfigId` (UUID | null)
- `artworkStatus` (`PROVIDED` | `PENDING_CUSTOMER`)
- `productionStatus` (`ARTWORK_PENDING` | `ARTWORK_PROVIDED` | `IN_PRODUCTION` | `QUALITY_CHECK` | `SHIPPED`)
- `logoAssetIdsByPlacementId` (JSON | null): map `{ [placementId: string]: string | null }`.
- `placementGeometrySnapshotByViewId` (JSON | null): immutable snapshot of placement geometry captured at order creation. Shape: `{ [viewId: string]: { [placementId: string]: PlacementGeometry | null } | null }`. See `geometry-snapshot-specification.md`.
- `useLiveConfigFallback` (boolean, default false): when true, fall back to live config geometry (for legacy orders without snapshots).
- `orderStatusUrl` (string | null): Shopify customer-facing order status page URL.

Notes:

- If `artworkStatus = PENDING_CUSTOMER`, the storefront uses the placeholder logo for preview, but production requires later artwork upload.
- `placementGeometrySnapshotByViewId` is immutable after order creation.

## CustomizationConfig

Represents a priced, method-specific configuration used by the variant pool.

- `id` (UUID)
- `shopId` (UUID)
- `methodId` (UUID): references `DecorationMethod.id`.
- `configHash` (string)
- `pricingVersion` (string)
- `unitPriceCents` (integer)
- `feeCents` (integer, default 0)
- `state` (`RESERVED` | `IN_CART` | `ORDERED` | `PURCHASED` | `EXPIRED`)
- `customizationDraftId` (string | null): links back to the draft for cart-confirm lookup.

## VariantSlot

Represents a reusable slot variant for non-Plus pricing.

- `id` (UUID)
- `shopId` (UUID)
- `methodId` (UUID): references `DecorationMethod.id`.
- `shopifyProductId` (string): Shopify product GID (the fee product).
- `shopifyVariantId` (string): Shopify variant GID.
- `state` (`FREE` | `RESERVED` | `IN_CART`)
- `reservedUntil` (timestamp | null)
- `inCartUntil` (timestamp | null)

## WebhookEvent

Record used to deduplicate Shopify webhook deliveries.

- `shopId` (UUID)
- `eventId` (string): `X-Shopify-Event-Id`
- `topic` (string): `X-Shopify-Topic`
- `receivedAt` (timestamp)

## StorefrontTranslation

Merchant overrides for storefront modal UI strings.

- `shopId` (UUID)
- `locale` (string): BCP-47 language code (e.g., "nl", "de", "fr").
- `key` (string): translation key (e.g., "upload.title").
- `value` (string): the translated/overridden text.

## Canonical references

- Placement editor contract: `docs/core/placement-editor.md`
- Storefront config response: `docs/core/storefront-config.md`
- SVG safety: `docs/core/svg-upload-safety.md`
- Geometry snapshot: `docs/core/geometry-snapshot-specification.md`
