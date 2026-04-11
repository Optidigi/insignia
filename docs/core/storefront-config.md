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
- `perspective` (`front` | `back` | `left` | `right` | `side`): display ordering key.
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

### Notes

- This contract intentionally uses percent geometry; the renderer converts percent → pixels at runtime.
- This contract intentionally does not include tint/mask pipeline fields (feature deferred).
