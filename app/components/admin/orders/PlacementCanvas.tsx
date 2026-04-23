/**
 * PlacementCanvas — thin view-switching wrapper around NativeCanvas.
 *
 * Receives the linePreviewData array for a single line (one element per
 * product view that has a signed image URL). Renders a segmented
 * <s-button-group> view selector above the canvas when there are multiple
 * views; renders a single canvas when there is only one view.
 *
 * Uses NativeCanvas with:
 *   - logoUrlByPlacementId  (per-placement artwork map from ViewPreview.logoUrls)
 *   - showZoneOverlays=true (coloured zone rects in admin context)
 *   - headless=true         (we render our own loading/error shell)
 *
 * Canvas image load failure is reported via onLoadStateChange and surfaced
 * as an explanatory message inside the canvas container.
 */

import { useCallback, useState } from "react";
import NativeCanvas from "../../storefront/NativeCanvas";
import type { CanvasPlacement, ImageMeta } from "../../storefront/NativeCanvas";
import type { PlacementGeometry, Placement } from "../../../lib/admin-types";

// ---------------------------------------------------------------------------
// Colour palette — cycles when there are more placements than colours.
// Matches the ZONE_COLORS constants from in-scope.html.
// ---------------------------------------------------------------------------

const PALETTE: Array<{ border: string; fill: string }> = [
  { border: "#2563EB", fill: "rgba(37,99,235,0.12)" },
  { border: "#16A34A", fill: "rgba(22,163,74,0.12)" },
  { border: "#D97706", fill: "rgba(217,119,6,0.12)" },
  { border: "#7C3AED", fill: "rgba(124,58,237,0.12)" },
  { border: "#DB2777", fill: "rgba(219,39,119,0.12)" },
];

// ---------------------------------------------------------------------------
// Types mirroring the loader's ViewPreview shape (defined locally in the
// route file — we copy the shape here to avoid importing from the route).
// ---------------------------------------------------------------------------

export type ViewPreview = {
  viewId: string;
  viewName: string;
  imageUrl: string;
  geometry: Record<string, PlacementGeometry | null>;
  logoUrls: Record<string, string | null>;
  calibrationPxPerCm: number | null;
};

type Props = {
  views: ViewPreview[] | null;
  /** All placements for this line — used for names and colour assignment. */
  placements: Placement[];
  /**
   * Called when the active view's product image loads (or when the view changes).
   * Forwarded from NativeCanvas `onImageMeta` with the active viewId prepended.
   */
  onViewImageMeta?: (viewId: string, meta: { naturalWidthPx: number; naturalHeightPx: number } | null) => void;
  /**
   * Handler for the "Download all" legend button. When omitted or undefined,
   * the button renders disabled — no artwork is currently available to
   * download for the line. Caller owns the download logic (typically via
   * `triggerBatchDownload` over the line's uploaded assets).
   */
  onDownloadAll?: () => void;
};

// ---------------------------------------------------------------------------
// Build zone colour map keyed by placement id (stable across view switches).
// ---------------------------------------------------------------------------

function buildZoneColors(
  placements: Placement[],
): Record<string, { border: string; fill: string }> {
  const result: Record<string, { border: string; fill: string }> = {};
  placements.forEach((p, i) => {
    result[p.id] = PALETTE[i % PALETTE.length];
  });
  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlacementCanvas({ views, placements, onViewImageMeta, onDownloadAll }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [canvasState, setCanvasState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const handleLoadStateChange = useCallback(
    (state: "loading" | "ready" | "error") => {
      setCanvasState(state);
    },
    [],
  );

  // Filter down to views that are *relevant* to this order line — i.e. at
  // least one customer-selected placement has non-null geometry on the view.
  // Views with no selected zones shouldn't appear as buttons; otherwise the
  // merchant sees a "Back" tab for a line where the customer only customised
  // the front, and clicking it renders an empty canvas with zero zones.
  const selectedPlacementIds = new Set(placements.map((p) => p.id));
  const relevantViews = views
    ? views.filter((v) =>
        Object.entries(v.geometry).some(
          ([id, g]) => g !== null && selectedPlacementIds.has(id),
        ),
      )
    : null;

  const hasRelevantViews = relevantViews != null && relevantViews.length > 0;
  const safeIdx = hasRelevantViews
    ? Math.min(activeIdx, relevantViews.length - 1)
    : 0;
  const activeView = hasRelevantViews ? relevantViews[safeIdx] : null;

  // Hooks must run in the same order on every render — declare before any
  // early return. `activeView` may be null during the empty state; the
  // callback guards against it.
  const activeViewId = activeView?.viewId;
  const handleImageMeta = useCallback(
    (meta: ImageMeta) => {
      if (!activeViewId) return;
      onViewImageMeta?.(activeViewId, {
        naturalWidthPx: meta.naturalWidthPx,
        naturalHeightPx: meta.naturalHeightPx,
      });
    },
    [activeViewId, onViewImageMeta],
  );

  // Empty-state early return is safe here — all hooks above have been called.
  if (!hasRelevantViews || !activeView) {
    return (
      <s-box background="subdued" borderRadius="base" padding="base">
        <s-stack direction="block" alignItems="center" gap="small-200">
          <s-text color="subdued">
            No product view images available for this line.
          </s-text>
        </s-stack>
      </s-box>
    );
  }

  // Build CanvasPlacement array — only customer-selected placements (the
  // caller passes the filtered set in `placements`). Unselected zones must
  // NOT render, otherwise the merchant sees phantom outlines for placements
  // the customer chose not to customize.
  const canvasPlacements: CanvasPlacement[] = Object.entries(activeView.geometry)
    .filter(([id, g]) => g !== null && selectedPlacementIds.has(id))
    .map(([id, g]) => ({
      id,
      centerXPercent: g!.centerXPercent,
      centerYPercent: g!.centerYPercent,
      maxWidthPercent: g!.maxWidthPercent,
      maxHeightPercent: g!.maxHeightPercent ?? null,
    }));

  const zoneColors = buildZoneColors(placements);

  // Placement name lookup map.
  const placementNameById: Record<string, string> = {};
  for (const p of placements) {
    placementNameById[p.id] = p.name;
  }

  // Legend entries = placements that have geometry on the active view.
  const activePlacementIds = canvasPlacements.map((p) => p.id);

  return (
    <s-box background="subdued" borderRadius="base" overflow="hidden">
      {/* View selector — segmented toggle when 2+ views, label-only when 1 view.
          Why this shape:
          - `<s-button-group>` requires children to live in `primary-action`
            or `secondary-actions` slots; the default slot doesn't render.
          - `<s-press-button>` is the documented primitive for toggle /
            segmented-control state (carries `pressed` boolean). Using plain
            `<s-button>` with variant-swapping fights the design system. */}
      <s-stack direction="inline" justifyContent="center" paddingBlock="large-200">
        {relevantViews.length > 1 ? (
          <s-button-group gap="none" accessibilityLabel="Product view selector">
            {relevantViews.map((v, i) => (
              <s-press-button
                key={v.viewId}
                slot="secondary-actions"
                variant="secondary"
                pressed={i === safeIdx}
                onClick={() => {
                  setActiveIdx(i);
                  setCanvasState("loading");
                }}
              >
                {v.viewName}
              </s-press-button>
            ))}
          </s-button-group>
        ) : (
          <s-text type="strong">{activeView.viewName}</s-text>
        )}
      </s-stack>

      {/* Canvas area — headless mode so we control the loading/error shell.
          Wrapped in an <s-box> for Polaris-token horizontal + vertical padding
          so the <canvas> doesn't run flush against the subdued container's
          edges. Inner <div> retains `position: relative` for the canvas
          exception layout (zone overlays are absolutely positioned over the
          canvas in NativeCanvas; the wrapper provides a flex center). */}
      <s-box paddingInline="base" paddingBlockEnd="small-400">
        <div
          style={{
            position: "relative",
            minHeight: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label={`Product view: ${activeView.viewName}`}
          role="img"
        >
        {canvasState === "loading" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <s-spinner size="base" accessibilityLabel="Loading product preview" />
          </div>
        )}
        {canvasState === "error" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <s-text color="subdued">
              Product view image could not be loaded. The presigned URL may
              have expired — refresh the page to reload.
            </s-text>
          </div>
        )}
        {/* Ready-state canvas wrapper: rounded corners + subtle shadow to
            lift the product image off the subdued container background.
            Token sources:
              borderRadius → Polaris --p-border-radius-200 (4–8 px scale)
              boxShadow    → Polaris --p-shadow-100 (subtle card lift)
            overflow:hidden clips the <canvas> element to the rounded corners. */}
        <div
          style={{
            display: canvasState === "ready" ? "block" : "none",
            borderRadius: "var(--p-border-radius-200)",
            overflow: "hidden",
            boxShadow: "var(--p-shadow-100)",
            backgroundColor: "var(--p-color-bg-surface, #fff)",
          }}
        >
          <NativeCanvas
            imageUrl={activeView.imageUrl}
            logoUrl={null}
            logoUrlByPlacementId={activeView.logoUrls}
            placements={canvasPlacements}
            showZoneOverlays={true}
            zoneColors={zoneColors}
            headless={true}
            onLoadStateChange={handleLoadStateChange}
            onImageMeta={handleImageMeta}
          />
        </div>
        </div>
      </s-box>

      {/* Legend row: zone colour dots (start) + Download all (end).
          Mirrors the in-scope prototype's canvas footer. Download all is
          disabled until a bulk-download backend exists (v3 feature #19). */}
      <s-box paddingBlock="small-300" paddingInline="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            {activePlacementIds.length === 0 ? (
              <s-text color="subdued">No placements on this view</s-text>
            ) : (
              activePlacementIds.map((id) => {
                const color = zoneColors[id] ?? PALETTE[0];
                return (
                  <s-stack
                    key={id}
                    direction="inline"
                    gap="small-100"
                    alignItems="center"
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color.border,
                        flexShrink: 0,
                      }}
                    />
                    <s-text color="subdued">
                      {placementNameById[id] ?? id}
                    </s-text>
                  </s-stack>
                );
              })
            )}
          </s-stack>
          {activePlacementIds.length > 0 && (
            <s-button
              variant="tertiary"
              icon="download"
              disabled={!onDownloadAll}
              accessibilityLabel={
                onDownloadAll
                  ? "Download all uploaded artwork for this line"
                  : "No artwork has been uploaded yet"
              }
              onClick={onDownloadAll}
            >
              Download all
            </s-button>
          )}
        </s-stack>
      </s-box>
    </s-box>
  );
}
