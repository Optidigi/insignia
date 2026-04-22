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
import type { CanvasPlacement } from "../../storefront/NativeCanvas";
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
};

type Props = {
  views: ViewPreview[] | null;
  /** All placements for this line — used for names and colour assignment. */
  placements: Placement[];
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

export default function PlacementCanvas({ views, placements }: Props) {
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

  // No views available — product not configured yet or all view images failed.
  if (!views || views.length === 0) {
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

  const safeIdx = Math.min(activeIdx, views.length - 1);
  const activeView = views[safeIdx];

  // Build CanvasPlacement array from the active view's geometry.
  const canvasPlacements: CanvasPlacement[] = Object.entries(activeView.geometry)
    .filter(([, g]) => g !== null)
    .map(([id, g]) => ({
      id,
      centerXPercent: g!.centerXPercent,
      centerYPercent: g!.centerYPercent,
      maxWidthPercent: g!.maxWidthPercent,
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
      {/* View selector — only shown when there are 2+ views. */}
      {views.length > 1 && (
        <s-stack direction="inline" justifyContent="center" paddingBlock="small-400">
          {/* Segmented view selector — ARIA roles applied via data-* not native ARIA
              because s-button WC type does not accept role/aria-selected props.
              Keyboard users can navigate with Tab + Enter between buttons. */}
          <s-button-group gap="none" accessibilityLabel="Product view selector">
            {views.map((v, i) => (
              <s-button
                key={v.viewId}
                variant={i === safeIdx ? "secondary" : "tertiary"}
                onClick={() => {
                  setActiveIdx(i);
                  setCanvasState("loading");
                }}
              >
                {v.viewName}
              </s-button>
            ))}
          </s-button-group>
        </s-stack>
      )}

      {/* Canvas area — headless mode so we control the loading/error shell. */}
      <div
        style={{ position: "relative", minHeight: 200 }}
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
        <div style={{ display: canvasState === "ready" ? "block" : "none" }}>
          <NativeCanvas
            imageUrl={activeView.imageUrl}
            logoUrl={null}
            logoUrlByPlacementId={activeView.logoUrls}
            placements={canvasPlacements}
            showZoneOverlays={true}
            zoneColors={zoneColors}
            headless={true}
            onLoadStateChange={handleLoadStateChange}
          />
        </div>
      </div>

      {/* Legend row below canvas. */}
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
        </s-stack>
      </s-box>
    </s-box>
  );
}
