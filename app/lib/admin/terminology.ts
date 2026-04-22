/**
 * Terminology lock for the Insignia admin UI.
 *
 * Single source of truth for mapping Prisma enums to display strings and
 * Polaris Web Component badge tones. The render layer must route every
 * status label and badge tone through this module — never render raw enum
 * strings, never invent labels.
 *
 * The amber tone for the Polaris WC `<s-badge>` is `"warning"` (confirmed
 * via @shopify/polaris-types, which uses ToneKeyword = "info" | "success"
 * | "warning" | "critical" and has no "attention" value).
 *
 * Terminology lock (from docs/frontend/backend-api-reference.md):
 *   Artwork (not Logo) · Complete (not Shipped) ·
 *   Awaiting artwork (not Pending) · Ready to produce (not Artwork provided
 *   at the order level) · In production · Quality check
 */

import type { ArtworkStatus, ProductionStatus } from "@prisma/client";

/** Polaris Web Component `<s-badge tone>` values we use. */
export type BadgeTone = "info" | "success" | "warning" | "critical";

/** Order-level production status → display label. */
export function productionStatusLabel(status: ProductionStatus): string {
  switch (status) {
    case "ARTWORK_PENDING":
      return "Awaiting artwork";
    case "ARTWORK_PROVIDED":
      return "Ready to produce";
    case "IN_PRODUCTION":
      return "In production";
    case "QUALITY_CHECK":
      return "Quality check";
    case "SHIPPED":
      return "Complete";
  }
}

/** Order-level production status → badge tone. */
export function productionStatusTone(status: ProductionStatus): BadgeTone {
  switch (status) {
    case "ARTWORK_PENDING":
      return "warning";
    case "ARTWORK_PROVIDED":
      return "info";
    case "IN_PRODUCTION":
      return "info";
    case "QUALITY_CHECK":
      return "info";
    case "SHIPPED":
      return "success";
  }
}

/** Per-line artwork status → display label (used in placement tables). */
export function artworkStatusLabel(status: ArtworkStatus): string {
  switch (status) {
    case "PROVIDED":
      return "Provided";
    case "PENDING_CUSTOMER":
      return "Awaiting";
  }
}

/** Per-line artwork status → badge tone. */
export function artworkStatusTone(status: ArtworkStatus): BadgeTone {
  return status === "PROVIDED" ? "success" : "warning";
}

/** Line-item card header label derived from all placement artwork states. */
export function lineItemArtworkSummary(
  placementStates: ArtworkStatus[],
): { label: string; tone: BadgeTone } {
  if (placementStates.length === 0) {
    return { label: "No placements", tone: "info" };
  }
  const providedCount = placementStates.filter((s) => s === "PROVIDED").length;
  if (providedCount === placementStates.length) {
    return { label: "Artwork provided", tone: "success" };
  }
  if (providedCount === 0) {
    return { label: "Awaiting artwork", tone: "warning" };
  }
  return { label: "Partial artwork", tone: "warning" };
}

/** Index-row artwork badge: aggregated across all lines of an order. */
export function indexArtworkBadge(
  pendingCount: number,
): { label: string; tone: BadgeTone } {
  return pendingCount > 0
    ? { label: "Awaiting artwork", tone: "warning" }
    : { label: "Provided", tone: "success" };
}
