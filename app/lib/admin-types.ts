/**
 * Admin-facing shared types for placement configuration.
 *
 * This file is intentionally free of server-only imports so it can be
 * consumed by both route files (loaders/actions) and client components
 * without triggering server-bundle leakage.
 *
 * Canonical: docs/core/placement-editor.md, docs/admin/
 */

/**
 * Percent-based bounding box for a placement zone on a product image.
 * Used by the admin canvas editor and order preview.
 *
 * @property centerXPercent  Horizontal centre of the zone (0–100).
 * @property centerYPercent  Vertical centre of the zone (0–100).
 * @property maxWidthPercent Width of the zone as a % of the image width (0–100).
 * @property maxHeightPercent Height as % of image height. Falls back to
 *   maxWidthPercent for legacy square zones when absent.
 */
export type PlacementGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  /** Height as % of stage height. Falls back to maxWidthPercent for legacy square zones. */
  maxHeightPercent?: number;
};

/**
 * A single logo-size option within a placement.
 *
 * @property id                    Database row ID.
 * @property label                 Human-readable size name shown to customers.
 * @property scaleFactor           Multiplier applied to the base logo size (1 = default).
 * @property priceAdjustmentCents  Price delta for choosing this size (negative = discount).
 * @property displayOrder          Sort order within the parent placement.
 */
export type PlacementStep = {
  id: string;
  label: string;
  scaleFactor: number;
  priceAdjustmentCents: number;
  displayOrder: number;
};

/**
 * A placement zone as used in admin configuration panels.
 *
 * @property id                        Database row ID.
 * @property name                      Merchant-facing zone name.
 * @property basePriceAdjustmentCents  Base fee for using this placement.
 * @property hidePriceWhenZero         Whether to hide the fee line when it is $0.
 * @property defaultStepIndex          Index into `steps` pre-selected for customers.
 * @property steps                     Available logo-size options.
 */
export type Placement = {
  id: string;
  name: string;
  basePriceAdjustmentCents: number;
  hidePriceWhenZero: boolean;
  defaultStepIndex: number;
  steps: PlacementStep[];
};

/** Minimal placement descriptor used by canvas editors (id + name only). */
export type PlacementDefinition = { id: string; name: string };
