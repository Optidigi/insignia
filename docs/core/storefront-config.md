# Storefront config (v1 contract)

This file defines the canonical response shape for the storefront modal configuration endpoint.

Contracts only: do not describe UI layout here; see `docs/storefront/modal-spec.md` for the modal behavior.

## Endpoint

- `GET /apps/insignia/config?productId=<gid>&variantId=<gid>`

## Response object

`StorefrontConfig`

### Identity

- `shop` (string): shop domain.
- `productId` (string): Shopify product GID.
- `variantId` (string): Shopify variant GID.
- `currency` (string): ISO currency code.

### Placeholder logo

When the buyer selects “Logo later”, the modal still renders a placeholder logo.

- `placeholderLogo` (object):
  - `mode` (`merchant_asset` | `bold_text`)
  - `text` (string | null): used when `mode = bold_text` (default value: `LOGO`).
  - `imageUrl` (URL | null): used when `mode = merchant_asset`.

Rules:

- If merchant has configured a placeholder logo image, return `mode = merchant_asset`.
- Otherwise return `mode = bold_text` with `text = LOGO`.

### Views (per selected variant)

A variant has a selected color; for MVP the merchant provides manual per-color assets.

- `views` (array of `ConfiguredView`)

`ConfiguredView`

- `id` (string): internal view ID.
- `name` (string | null): merchant-defined display name for the view (optional).
- `perspective` (`front` | `back` | `left` | `right` | `side` | `custom`): display ordering key. Use `custom` for merchant-defined views that don't map to a standard perspective.
- `imageUrl` (URL | null): preview image for this variant/perspective.
- `isMissingImage` (boolean): true if `imageUrl` is null.

### Methods

Methods available for this product configuration:

- `methods` (array of `DecorationMethod`)

`DecorationMethod`

- `id` (string): matches `DecorationMethod.id` in `docs/core/data-schemas.md` and maps to `_insignia_method`.
- `name` (string): display label.

### Placements

- `placements` (array of `Placement`)

`Placement`

- `id` (string): internal placement ID.
- `name` (string): merchant-defined label.
- `basePriceAdjustmentCents` (integer): may be 0.
- `hidePriceWhenZero` (boolean): if true, UI hides currency display when base + step adjustment is 0.
- `steps` (array of `PlacementStep`)
- `defaultStepIndex` (integer): 0-based index into `steps`.
- `geometryByViewId` (object map): `{ [viewId: string]: PlacementGeometry | null }`

`PlacementStep`

- `label` (string): merchant-defined.
- `priceAdjustmentCents` (integer): may be 0.

`PlacementGeometry`

- `centerXPercent` (number): 0–100.
- `centerYPercent` (number): 0–100.
- `maxWidthPercent` (number): 0–100.

Missing-data rules:

- If a placement has `geometryByViewId[viewId] = null`, the modal MUST treat preview geometry as missing for that view.
- If all selected placements for the current view have null geometry, the size tab SHOULD be slider-only.

### Variants

The config response includes the available Shopify variants filtered to those matching the selected non-size options (e.g. same color).

- `variants` (array of `ProductVariantOption`)

`ProductVariantOption`

- `id` (string): Shopify variant GID.
- `title` (string): variant display title.
- `sizeLabel` (string): resolved size label (extracted from the size-typed selected option, across 12 languages with value-based fallback).
- `priceCents` (integer): variant price in the smallest currency unit.
- `available` (boolean): true if the variant is in stock and purchasable.

Note: `selectedOptions` (the raw Shopify option array) is used server-side for size detection and non-size filtering but is **stripped before the client response** — it is not present in `ProductVariantOption` as returned to the storefront.

### Notes

- This contract intentionally uses percent geometry; the renderer converts percent → pixels at runtime.
- This contract intentionally does not include tint/mask pipeline fields (feature deferred).
- Variant list is capped at 250 per Shopify API limit; server-side filtering by non-size options reduces this further to only the relevant color variants.
