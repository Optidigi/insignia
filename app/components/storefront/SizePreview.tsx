/**
 * Product preview canvas: product view image + logo overlay.
 * Two rendering modes:
 *  - Default (inline/mobile): carousel with prev/next arrows + dots
 *  - showTabs (desktop left panel): named view tabs + centered canvas area
 */

import { useMemo, useState } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import NativeCanvas from "./NativeCanvas";

type SizePreviewProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  logo: LogoState;
  highlightPlacementId?: string;
  sizeMultiplier?: number;
  /** Desktop left panel mode: shows named view tabs and centers the canvas */
  showTabs?: boolean;
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function SizePreview({
  config,
  placementSelections,
  logo,
  highlightPlacementId,
  sizeMultiplier = 0.6,
  showTabs = false,
}: SizePreviewProps) {
  // Only show views that have a real image assigned
  const availableViews = config.views.filter((v) => v.imageUrl && !v.isMissingImage);

  const [viewIndex, setViewIndex] = useState(0);
  const view = availableViews[viewIndex] ?? availableViews[0];
  const viewId = view?.id;
  const imageUrl = view?.imageUrl ?? null;
  const hasImage = Boolean(imageUrl);

  const logoUrl = useMemo(() => {
    if (logo.type === "uploaded") return logo.previewPngUrl;
    if (
      logo.type === "later" &&
      config.placeholderLogo.mode === "merchant_asset" &&
      config.placeholderLogo.imageUrl
    ) {
      return config.placeholderLogo.imageUrl;
    }
    return null;
  }, [logo, config.placeholderLogo]);

  const canvasPlacements = useMemo(() => {
    if (!viewId) return [];
    return config.placements
      .filter((p) => {
        const sel = placementSelections[p.id];
        if (sel === undefined) return false;
        const geom = p.geometryByViewId[viewId];
        return geom != null;
      })
      .map((p) => {
        const geom = p.geometryByViewId[viewId]!;
        const stepIndex = placementSelections[p.id] ?? p.defaultStepIndex;
        const step = p.steps[stepIndex] ?? p.steps[0];
        return {
          id: p.id,
          centerXPercent: geom.centerXPercent,
          centerYPercent: geom.centerYPercent,
          maxWidthPercent: geom.maxWidthPercent,
          scaleFactor: step?.scaleFactor ?? 1,
        };
      });
  }, [config.placements, viewId, placementSelections]);

  // Show canvas whenever there's a valid view with an image — placements are
  // optional (NativeCanvas draws just the product image when placements is []).
  const canPreview = Boolean(viewId && hasImage);

  const canvasContent = canPreview ? (
    <NativeCanvas
      imageUrl={imageUrl!}
      logoUrl={logoUrl}
      placements={canvasPlacements}
      highlightedPlacementId={highlightPlacementId}
      sizeMultiplier={sizeMultiplier}
    />
  ) : (
    <div className="insignia-preview-fallback">No preview available</div>
  );

  // ── Desktop panel mode ───────────────────────────────────────────────────
  if (showTabs) {
    return (
      <div className="insignia-preview-panel">
        {availableViews.length > 1 && (
          <div className="insignia-view-tabs">
            {availableViews.map((v, i) => (
              <button
                key={v.id}
                type="button"
                className="insignia-view-tab"
                data-active={i === viewIndex ? "true" : undefined}
                onClick={() => setViewIndex(i)}
              >
                {v.name || capitalize(v.perspective)}
              </button>
            ))}
          </div>
        )}
        <div className="insignia-preview-panel-canvas">{canvasContent}</div>
      </div>
    );
  }

  // ── Inline / mobile carousel mode ────────────────────────────────────────
  return (
    <div className="insignia-preview-carousel">
      {canvasContent}
      {availableViews.length > 1 && (
        <>
          <button
            type="button"
            className="insignia-preview-nav"
            data-dir="prev"
            aria-label="Previous view"
            disabled={viewIndex === 0}
            onClick={() => setViewIndex((i) => Math.max(0, i - 1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="insignia-preview-nav"
            data-dir="next"
            aria-label="Next view"
            disabled={viewIndex === availableViews.length - 1}
            onClick={() => setViewIndex((i) => Math.min(availableViews.length - 1, i + 1))}
          >
            ›
          </button>
          <div className="insignia-preview-dots">
            {availableViews.map((_, i) => (
              <button
                key={i}
                type="button"
                className="insignia-preview-dot"
                data-active={i === viewIndex}
                aria-label={`View ${i + 1}`}
                onClick={() => setViewIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
