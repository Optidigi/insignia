/**
 * LineItemCard — one card per order line customization.
 *
 * Renders:
 *   - Section heading: "{productName} × {quantity}"
 *   - Meta row: variantTitle · method badge · artwork summary badge
 *   - PlacementCanvas (view-switching canvas)
 *   - PlacementsTable
 *   - Conditional "Mark in production" / "Mark quality check" / "Mark complete"
 *     button (only when all placements have artwork AND status is advanceable).
 *
 * Production cascade rules (from R2 Section A.8):
 *   ARTWORK_PROVIDED → IN_PRODUCTION (always)
 *   IN_PRODUCTION → QUALITY_CHECK (only when productionQcEnabled)
 *   IN_PRODUCTION → SHIPPED (when !productionQcEnabled)
 *   QUALITY_CHECK → SHIPPED (always)
 *
 * Uses useFetcher so the page does not fully navigate on status advance.
 */

import { useFetcher } from "react-router";
import { useEffect, useRef } from "react";
import type { ProductionStatus, ArtworkStatus } from "@prisma/client";
import {
  productionStatusLabel,
  productionStatusTone,
  lineItemArtworkSummary,
} from "../../../lib/admin/terminology";
import { useToast } from "../../../lib/admin/app-bridge.client";
import PlacementCanvas from "./PlacementCanvas";
import type { ViewPreview } from "./PlacementCanvas";
import PlacementsTable from "./PlacementsTable";
import type { LogoAssetDTO } from "./PlacementsTable";
import type { Placement } from "../../../lib/admin-types";

// ---------------------------------------------------------------------------
// Types — subset of the loader's line shape
// ---------------------------------------------------------------------------

export type LineItem = {
  id: string;
  shopifyLineId: string;
  artworkStatus: ArtworkStatus;
  productionStatus: ProductionStatus;
  productConfigName: string;
  methodName: string;
  variantTitle: string | null;
  unitPriceCents: number;
  placements: Placement[];
  logoAssetIdsByPlacementId: Record<string, string | null> | null;
  orderStatusUrl: string | null;
  createdAt: string;
};

type Props = {
  line: LineItem;
  /** Quantity from allShopifyLineItems (may be undefined if GraphQL errored). */
  quantity: number | undefined;
  views: ViewPreview[] | null;
  logoAssetMap: Record<string, LogoAssetDTO>;
  productionQcEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineItemCard({
  line,
  quantity,
  views,
  logoAssetMap,
  productionQcEnabled,
}: Props) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const showToast = useToast();
  // Track which label was submitted so the success toast reads correctly
  // regardless of which transition (In production / Quality check / Complete).
  const submittedLabelRef = useRef<string | null>(null);

  // Toast on status advance result.
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      const label = submittedLabelRef.current ?? "Status updated";
      // "Mark in production" → "Line marked as in production"
      const action = label.replace(/^Mark\s+/, "").toLowerCase();
      showToast(`Line marked as ${action}`);
      submittedLabelRef.current = null;
    } else if (fetcher.data.error) {
      showToast(fetcher.data.error, { isError: true });
      submittedLabelRef.current = null;
    }
  }, [fetcher.state, fetcher.data, showToast]);

  // Compute per-placement artwork statuses.
  const placementArtworkStatuses: ArtworkStatus[] = line.placements.map((p) => {
    const assetId = line.logoAssetIdsByPlacementId?.[p.id] ?? null;
    return assetId ? "PROVIDED" : "PENDING_CUSTOMER";
  });

  // Line-level artwork summary badge.
  const artworkSummary = lineItemArtworkSummary(placementArtworkStatuses);

  // Production status label + tone.
  const prodLabel = productionStatusLabel(line.productionStatus);
  const prodTone = productionStatusTone(line.productionStatus);

  // Determine what advance button (if any) to show.
  const allArtworkProvided =
    line.placements.length > 0 &&
    placementArtworkStatuses.every((s) => s === "PROVIDED");

  type AdvanceAction = {
    newStatus: ProductionStatus;
    label: string;
  } | null;

  let advanceAction: AdvanceAction = null;
  if (
    line.productionStatus === "ARTWORK_PROVIDED" &&
    allArtworkProvided
  ) {
    advanceAction = { newStatus: "IN_PRODUCTION", label: "Mark in production" };
  } else if (
    line.productionStatus === "IN_PRODUCTION" &&
    productionQcEnabled
  ) {
    advanceAction = { newStatus: "QUALITY_CHECK", label: "Mark quality check" };
  } else if (
    line.productionStatus === "IN_PRODUCTION" &&
    !productionQcEnabled
  ) {
    advanceAction = { newStatus: "SHIPPED", label: "Mark complete" };
  } else if (line.productionStatus === "QUALITY_CHECK") {
    advanceAction = { newStatus: "SHIPPED", label: "Mark complete" };
  }

  const isSubmitting = fetcher.state === "submitting";

  const heading = quantity !== undefined
    ? `${line.productConfigName} × ${quantity}`
    : line.productConfigName;

  return (
    <s-section heading={heading}>
      <s-stack direction="block" gap="base">
        {/* Meta row */}
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-text color="subdued">
            {[line.variantTitle, line.methodName].filter(Boolean).join(" · ")}
          </s-text>
          <s-stack direction="inline" gap="small-200">
            {/* Production status badge */}
            <s-badge tone={prodTone}>{prodLabel}</s-badge>
            {/* Artwork summary badge */}
            <s-badge tone={artworkSummary.tone}>{artworkSummary.label}</s-badge>
          </s-stack>
        </s-stack>

        {/* Canvas */}
        <PlacementCanvas views={views} placements={line.placements} />

        {/* Placements table */}
        <PlacementsTable
          lineId={line.id}
          placements={line.placements}
          logoAssetIdsByPlacementId={line.logoAssetIdsByPlacementId}
          logoAssetMap={logoAssetMap}
        />

        {/* Advance status button */}
        {advanceAction && (
          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              loading={isSubmitting}
              disabled={isSubmitting}
              onClick={() => {
                submittedLabelRef.current = advanceAction!.label;
                const fd = new FormData();
                fd.append("intent", "advance-status");
                fd.append("lineId", line.id);
                fd.append("newStatus", advanceAction!.newStatus);
                fetcher.submit(fd, { method: "POST" });
              }}
            >
              {advanceAction.label}
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}
