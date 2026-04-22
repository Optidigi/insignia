/**
 * Calibration helpers — compute printed artwork dimensions (cm) from zone
 * geometry + product image pixel dimensions + per-view pixels-per-cm
 * calibration.
 *
 * Mirrors the storefront computation in `app/components/storefront/SizeStep.tsx`
 * (`calibrationLabel`), but scoped to the admin order-detail use case:
 *   - Zone-dimensions-only (no logo-aspect letterbox fit — admin doesn't
 *     have reliable per-placement logo meta, and the zone bounds are the
 *     merchant-facing "what the customer chose" value).
 *   - Both dimensions rounded to nearest cm to match storefront output.
 *
 * Keep this module a pure, dependency-free helper: consumed both by unit
 * tests and by the React render layer.
 */

export type ZoneGeometry = {
  maxWidthPercent: number;
  /** Height as % of stage height; falls back to maxWidthPercent for legacy square zones. */
  maxHeightPercent?: number | null;
};

export type ImagePixels = {
  naturalWidthPx: number;
  naturalHeightPx: number;
};

/**
 * Compute calibrated width × height in cm for a zone on an image.
 *
 *   zoneWidthCm  = (maxWidthPercent  / 100) × imageWidthPx  × scale / pxPerCm
 *   zoneHeightCm = (maxHeightPercent / 100) × imageHeightPx × scale / pxPerCm
 *
 * Returns null when any input is missing or non-finite so callers can render
 * a graceful fallback (e.g. just the step label) without guarding every prop.
 */
export function computeCmDimensions(
  geom: ZoneGeometry | null | undefined,
  imageMeta: ImagePixels | null | undefined,
  scaleFactor: number,
  calibrationPxPerCm: number | null | undefined,
): { widthCm: number; heightCm: number } | null {
  if (
    !geom ||
    geom.maxWidthPercent == null ||
    !imageMeta ||
    !imageMeta.naturalWidthPx ||
    !imageMeta.naturalHeightPx ||
    !calibrationPxPerCm ||
    calibrationPxPerCm <= 0
  ) {
    return null;
  }
  const scale = scaleFactor || 1;
  const widthCm =
    ((geom.maxWidthPercent / 100) * imageMeta.naturalWidthPx * scale) /
    calibrationPxPerCm;
  const heightPercent = geom.maxHeightPercent ?? geom.maxWidthPercent;
  const heightCm =
    ((heightPercent / 100) * imageMeta.naturalHeightPx * scale) /
    calibrationPxPerCm;

  if (
    !Number.isFinite(widthCm) ||
    !Number.isFinite(heightCm) ||
    widthCm <= 0 ||
    heightCm <= 0
  ) {
    return null;
  }

  return {
    widthCm: Math.round(widthCm),
    heightCm: Math.round(heightCm),
  };
}

/**
 * Convenience: render the result as "W × H cm" or null when computation fails.
 * Uses U+00D7 (×) to match the storefront `calibratedSuffix` template.
 */
export function formatCmLabel(
  dims: { widthCm: number; heightCm: number } | null,
): string | null {
  if (!dims) return null;
  return `${dims.widthCm} × ${dims.heightCm} cm`;
}
