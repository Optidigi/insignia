# Placement editor (Konva) — Contract v1

This file defines the canonical saved outputs of the dashboard placement editor.

The dashboard uses Konva for editing, but the backend stores a stable, renderer-agnostic model.

## Core idea

- Konva is used to edit and preview.
- Backend persists normalized placement geometry (percent-based) and step schedules.
- Storefront consumes the same model via `GET /apps/insignia/config`.

## Saved objects

### PlacementGeometry

Percent-based placement geometry relative to the view image.

- `centerXPercent` (0–100)
- `centerYPercent` (0–100)
- `maxWidthPercent` (0–100)

### PlacementStep

- `label` (string)
- `priceAdjustmentCents` (integer)

### PlacementDefinition

- `id` (string)
- `name` (string)
- `basePriceAdjustmentCents` (integer)
- `hidePriceWhenZero` (boolean)
- `steps` (`PlacementStep[]`)
- `defaultStepIndex` (integer)

### ViewConfiguration (per product config, per color variant)

- `viewId` (string)
- `variantId` (string)
- `imageUrl` (URL | null)
- `placements` (map `{ [placementId: string]: PlacementGeometry | null }`)

Rules:

- If `imageUrl` is null, storefront treats view image as missing.
- If a placement geometry is null for a view, storefront treats preview geometry as missing for that view.

Note: The canonical data schema uses the name `placementGeometry` for this map. Treat `placements` here as the same shape. See `docs/core/data-schemas.md`.

## Dashboard editor behavior (v1)

- Editor SHOULD support snap-to-grid while dragging/resizing.
- Editor MUST save percent values (not pixels).
- Editor MUST support duplicating a view configuration to another variant (copy geometry + step schedules, swap images only).

## Canonical references

- Storefront config response: `docs/core/storefront-config.md`
- Storefront modal behavior: `docs/storefront/modal-spec.md`
