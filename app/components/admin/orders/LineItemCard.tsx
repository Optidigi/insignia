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
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductionStatus, ArtworkStatus } from "@prisma/client";
import {
  productionStatusLabel,
  productionStatusTone,
  lineItemArtworkSummary,
} from "../../../lib/admin/terminology";
import { useToast, triggerBatchDownload } from "../../../lib/admin/app-bridge";
import { computeCmDimensions, formatCmLabel } from "../../../lib/admin/calibration";
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
  /** Customer's chosen step per placement, keyed by placementId. Null when no draft entry. */
  selectedSteps: Record<string, { stepIndex: number; label: string; scaleFactor: number; priceAdjustmentCents: number } | null>;
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

  // Image meta keyed by viewId — populated by PlacementCanvas via onViewImageMeta.
  const [imageMetaByViewId, setImageMetaByViewId] = useState<
    Record<string, { naturalWidthPx: number; naturalHeightPx: number } | null>
  >({});

  const handleViewImageMeta = useCallback(
    (viewId: string, meta: { naturalWidthPx: number; naturalHeightPx: number } | null) => {
      setImageMetaByViewId((prev) => ({ ...prev, [viewId]: meta }));
    },
    [],
  );

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

  // `line.placements` from the loader is ALL configured placements across
  // every view of the product config. The customer only selected a subset —
  // the authoritative "which placements apply to THIS order line" source is
  // `logoAssetIdsByPlacementId` keys (key present = selected, absent = not).
  // Legacy OLCs may have a null/empty map → fall back to all placements.
  const assetMap = line.logoAssetIdsByPlacementId;
  const hasSelectionMap = assetMap != null && Object.keys(assetMap).length > 0;
  const selectedPlacements: Placement[] = hasSelectionMap
    ? line.placements.filter((p) => p.id in assetMap!)
    : line.placements;

  // Compute per-placement artwork statuses (over the selected subset only).
  const placementArtworkStatuses: ArtworkStatus[] = selectedPlacements.map((p) => {
    const assetId = assetMap?.[p.id] ?? null;
    return assetId ? "PROVIDED" : "PENDING_CUSTOMER";
  });

  // Line-level artwork summary badge.
  const artworkSummary = lineItemArtworkSummary(placementArtworkStatuses);

  // Production status label + tone.
  const prodLabel = productionStatusLabel(line.productionStatus);
  const prodTone = productionStatusTone(line.productionStatus);

  // Determine what advance button (if any) to show.
  const allArtworkProvided =
    selectedPlacements.length > 0 &&
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

  // Batch-download target list: for every customer-selected placement that
  // has an uploaded artwork asset, pull the presigned `downloadUrl` + a
  // filename. Undefined / null entries (placements awaiting upload) are
  // silently skipped. `downloadUrl` is already filename-safe (loader passes
  // it through `sanitizeFilename`).
  const downloadableAssets: Array<{ url: string; filename: string }> = [];
  for (const placement of selectedPlacements) {
    const assetId = assetMap?.[placement.id];
    if (!assetId) continue;
    const asset = logoAssetMap[assetId];
    if (!asset?.downloadUrl) continue;
    downloadableAssets.push({
      url: asset.downloadUrl,
      filename: asset.originalFileName ?? `artwork-${placement.id}.svg`,
    });
  }

  const handleDownloadAll = useCallback(() => {
    if (downloadableAssets.length === 0) return;
    triggerBatchDownload(downloadableAssets);
    const count = downloadableAssets.length;
    showToast(`Downloading ${count} file${count === 1 ? "" : "s"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast, downloadableAssets.length]);

  // Build enriched placement rows (customer-selected only) with step label +
  // cm dimensions. For each placement:
  //   1. Find owner view — first view whose geometry has this placement id.
  //   2. Read calibrationPxPerCm from that view (loader thread it through).
  //   3. Read imageMeta from imageMetaByViewId (populated by PlacementCanvas).
  //   4. Compute cmLabel from zone dims + step scaleFactor via the shared
  //      calibration helper.
  const placementsWithSize = selectedPlacements.map((placement) => {
    const ownerView = views?.find((v) => placement.id in v.geometry) ?? null;
    const geom = ownerView ? (ownerView.geometry[placement.id] ?? null) : null;
    const calibrationPxPerCm = ownerView?.calibrationPxPerCm ?? null;
    const imageMeta = ownerView ? (imageMetaByViewId[ownerView.viewId] ?? null) : null;
    const stepEntry = line.selectedSteps[placement.id] ?? null;

    const stepLabel = stepEntry?.label ?? null;
    const cmLabel = stepEntry
      ? formatCmLabel(
          computeCmDimensions(geom, imageMeta, stepEntry.scaleFactor, calibrationPxPerCm),
        )
      : null;

    return { placement, stepLabel, cmLabel };
  });

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

        {/* Canvas — only customer-selected placements get zone overlays */}
        <PlacementCanvas
          views={views}
          placements={selectedPlacements}
          onViewImageMeta={handleViewImageMeta}
          onDownloadAll={
            downloadableAssets.length > 0 ? handleDownloadAll : undefined
          }
        />

        {/* Placements table */}
        <PlacementsTable
          lineId={line.id}
          placementsWithSize={placementsWithSize}
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
