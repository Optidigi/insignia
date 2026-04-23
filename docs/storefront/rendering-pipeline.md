# Rendering pipeline (Storefront)

> **Last verified**: 2026-04-10

This document defines the deterministic storefront preview rendering pipeline.

## Inputs

Per view:

- `imageUrl` (required): garment preview image (typically a PNG/JPG for the selected color variant).
- `placementGeometry` (required): map of placement IDs to percent-based geometry for this view.

Per session:

- `selectedMethodId` (required if multiple methods allowed): DTG vs Embroidery.

## Layer order

For each view, the renderer should render these layers in this order:

1. Garment image (`imageUrl`).
2. Logo layers: one per selected placement, positioned by converting placement geometry percent coordinates to pixels.

Fallback rules:

- If a view image is missing for the current variant, the UI should hide the preview for that view.

## Placement geometry percent to pixels

Geometry uses `centerXPercent`, `centerYPercent`, and `maxWidthPercent` (all 0-100 range).

Given a placement with center `(centerXPercent, centerYPercent)` and max width `maxWidthPercent`:

- `centerX = (centerXPercent / 100) * canvasWidth`
- `centerY = (centerYPercent / 100) * canvasHeight`
- `logoMaxWidthPx = (maxWidthPercent / 100) * canvasWidth`
- `logoMaxHeightPx = (maxHeightPercent / 100) * canvasHeight`  (`maxHeightPercent` falls back to `maxWidthPercent` when absent — legacy square zones)

Logo is scaled using contain-fit: `scaleFactor = min(logoMaxWidthPx / logo.naturalWidth, logoMaxHeightPx / logo.naturalHeight)`. Both dimensions are bounded so tall logos never overflow the print area vertically.

## Geometry source priority

1. **Order rendering**: Use `OrderLineCustomization.placementGeometrySnapshotByViewId` (immutable snapshot from order time). See `docs/core/geometry-snapshot-specification.md`.
2. **Order fallback**: If snapshot is null and `useLiveConfigFallback` is true, use live `VariantViewConfiguration.placementGeometry`.
3. **Storefront modal**: Use live `VariantViewConfiguration.placementGeometry`, falling back to `ProductView.placementGeometry` (shared geometry) if no variant override exists.

## Method preview

- Preview can render the same logo overlay for DTG and Embroidery.
- UI must clearly label the chosen method.

## Canonical references

- Schemas: [`../core/data-schemas.md`](../core/data-schemas.md)
- Geometry snapshot: [`../core/geometry-snapshot-specification.md`](../core/geometry-snapshot-specification.md)
