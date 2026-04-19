/**
 * Mockup preview surface used by the Placement and Size steps and the
 * desktop persistent left panel.
 *
 * Renders the NativeCanvas inside a `.insignia-canvas-frame` with all
 * loading / failed / empty states + view-navigation chrome (prev/next
 * arrows, dot indicators, optional named tabs for desktop). Touch swipe
 * navigates between views.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { StorefrontConfig, PlacementSelections } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import NativeCanvas, { type CanvasPlacement, type ImageMeta } from "./NativeCanvas";
import { IconChevronLeft, IconChevronRight, IconImageOff, IconRefresh, IconShirt } from "./icons";

type LoadState = "loading" | "ready" | "error";

// Aspect ratio threshold above which the canvas frame switches from square
// (1:1) to wide (4:3). Source: docs/storefront/modal-design-intent.md:131 (B6).
const WIDE_ASPECT_THRESHOLD = 1.3;

type PreviewCanvasProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  logo: LogoState;
  highlightPlacementId?: string | null;
  /** Forces a particular view to be shown; controlled mode. */
  viewId?: string;
  onViewChange?: (viewId: string) => void;
  /** "step" hides this on desktop (the persistent left panel covers it). */
  context?: "step" | "panel" | "sheet";
  /** Lift image dimensions up so the SizeStep can compute calibration cm. */
  onImageMeta?: (viewId: string, meta: ImageMeta) => void;
  /** Lift logo dimensions up so the SizeStep can fit logo into the zone. */
  onLogoMeta?: (meta: ImageMeta | null) => void;
  t: TranslationStrings;
};

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function PreviewCanvas({
  config,
  placementSelections,
  logo,
  highlightPlacementId,
  viewId: controlledViewId,
  onViewChange,
  context = "step",
  onImageMeta,
  onLogoMeta,
  t,
}: PreviewCanvasProps) {
  const availableViews = useMemo(
    () => config.views.filter((v) => v.imageUrl && !v.isMissingImage),
    [config.views],
  );

  const [internalIndex, setInternalIndex] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const currentIndex = controlledViewId
    ? Math.max(0, availableViews.findIndex((v) => v.id === controlledViewId))
    : internalIndex;
  const currentView = availableViews[currentIndex] ?? availableViews[0];

  const setIndex = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(availableViews.length - 1, next));
      const view = availableViews[clamped];
      if (!view) return;
      if (controlledViewId == null) setInternalIndex(clamped);
      onViewChange?.(view.id);
    },
    [availableViews, controlledViewId, onViewChange],
  );

  const goPrev = useCallback(() => setIndex(currentIndex - 1), [currentIndex, setIndex]);
  const goNext = useCallback(() => setIndex(currentIndex + 1), [currentIndex, setIndex]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartXRef.current == null) return;
      const delta = e.changedTouches[0].clientX - touchStartXRef.current;
      touchStartXRef.current = null;
      if (delta <= -50) goNext();
      else if (delta >= 50) goPrev();
    },
    [goNext, goPrev],
  );

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

  const canvasPlacements: CanvasPlacement[] = useMemo(() => {
    if (!currentView) return [];
    return config.placements
      .filter((p) => {
        const sel = placementSelections[p.id];
        if (sel === undefined) return false;
        return p.geometryByViewId[currentView.id] != null;
      })
      .map((p) => {
        const geom = p.geometryByViewId[currentView.id]!;
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
  }, [config.placements, currentView, placementSelections]);

  // No views with images at all
  if (availableViews.length === 0) {
    return (
      <div className="insignia-canvas-frame" data-state="empty" data-context={context}>
        <div className="insignia-canvas-status">
          <IconShirt size={28} />
          <span>{t.v2.placement.noImage}</span>
        </div>
      </div>
    );
  }

  if (!currentView?.imageUrl) {
    return (
      <div className="insignia-canvas-frame" data-state="empty" data-context={context}>
        <div className="insignia-canvas-status">
          <IconShirt size={28} />
          <span>{t.v2.placement.noImage}</span>
        </div>
      </div>
    );
  }

  const wide = aspect != null && aspect > WIDE_ASPECT_THRESHOLD;
  const frameDataState =
    loadState === "loading" ? "loading" : loadState === "error" ? "failed" : undefined;

  const showNav = availableViews.length > 1;

  return (
    <>
      <div
        className="insignia-canvas-frame"
        data-state={frameDataState}
        data-aspect={wide ? "wide" : undefined}
        data-context={context}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loadState === "error" ? (
          <div className="insignia-canvas-status">
            <IconImageOff size={28} />
            <span>{t.v2.placement.canvasFailed}</span>
            <button
              type="button"
              className="insignia-btn insignia-btn--ghost"
              onClick={() => {
                setLoadState("loading");
                setRetryKey((k) => k + 1);
              }}
            >
              <IconRefresh size={14} />
              <span>{t.v2.placement.canvasRetry}</span>
            </button>
          </div>
        ) : (
          <NativeCanvas
            key={`${currentView.id}:${retryKey}`}
            imageUrl={currentView.imageUrl}
            logoUrl={logoUrl}
            placements={canvasPlacements}
            highlightedPlacementId={highlightPlacementId ?? undefined}
            headless
            onLoadStateChange={setLoadState}
            onImageMeta={(meta) => {
              setAspect(meta.aspect);
              onImageMeta?.(currentView.id, meta);
            }}
            onLogoMeta={onLogoMeta}
          />
        )}
        {loadState === "loading" && (
          <div className="insignia-canvas-status">
            <span>{t.v2.placement.canvasLoading}</span>
          </div>
        )}
        {showNav && (
          <>
            <button
              type="button"
              className="insignia-canvas-nav insignia-canvas-nav--prev"
              aria-label={t.v2.placement.viewNavPrev}
              disabled={currentIndex === 0}
              onClick={goPrev}
            >
              <IconChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="insignia-canvas-nav insignia-canvas-nav--next"
              aria-label={t.v2.placement.viewNavNext}
              disabled={currentIndex === availableViews.length - 1}
              onClick={goNext}
            >
              <IconChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {showNav && availableViews.length > 1 && (
        <div className="insignia-canvas-dots" data-context={context}>
          {availableViews.map((v, i) => (
            <button
              key={v.id}
              type="button"
              className="insignia-canvas-dot"
              data-active={i === currentIndex ? "true" : undefined}
              aria-label={v.name || capitalize(v.perspective)}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}

    </>
  );
}
