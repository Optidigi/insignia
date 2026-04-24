/**
 * Mockup preview surface used by the Placement and Size steps and the
 * desktop persistent left panel.
 *
 * Renders the NativeCanvas inside a `.insignia-canvas-frame` with all
 * loading / failed / empty states + view-navigation chrome (prev/next
 * arrows, dot indicators, optional named tabs for desktop). Touch swipe
 * navigates between views.
 *
 * View cross-fade: when `currentView.id` changes, the frame keeps two
 * stacked NativeCanvas layers alive for one transition — the outgoing
 * (frozen props) fades to 0 while the incoming (live props) fades to 1.
 * Without this, remounting the single canvas caused an image-load flash.
 * See docs/notes/plans/storefront-canvas-view-switch-cue.md §11.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontConfig, PlacementSelections, ConfiguredView } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import NativeCanvas, {
  type CanvasPlacement,
  type ImageMeta,
  type ZoomGeometry,
} from "./NativeCanvas";
import { IconChevronLeft, IconChevronRight, IconImageOff, IconRefresh, IconShirt } from "./icons";

type LoadState = "loading" | "ready" | "error";

// Aspect ratio threshold above which the canvas frame switches from square
// (1:1) to wide (4:3). Source: docs/storefront/modal-design-intent.md:131 (B6).
const WIDE_ASPECT_THRESHOLD = 1.3;

// Duration of the outgoing layer's CSS @keyframes fade-out. Must match
// the `animation:` value on .insignia-canvas-layer[data-role="outgoing"]
// in storefront-modal.css. Only used here to schedule the unmount timer.
const FADE_OUT_MS = 320;

type PreviewCanvasProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  logo: LogoState;
  highlightPlacementId?: string | null;
  /**
   * Placement id whose geometry the canvas should zoom toward. When null or
   * omitted, the canvas renders un-zoomed (identical to today's behaviour).
   */
  zoomTargetPlacementId?: string | null;
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

// Snapshot of the draw-relevant props the outgoing NativeCanvas renders with.
// Captured at the start of each transition so parent re-renders cannot trigger
// a redraw on the frozen layer (MF-1).
type FrozenCanvasProps = {
  imageUrl: string;
  logoUrl: string | null;
  placements: CanvasPlacement[];
  highlightedPlacementId: string | null;
  zoomGeometry: ZoomGeometry | null;
};

export function PreviewCanvas({
  config,
  placementSelections,
  logo,
  highlightPlacementId,
  zoomTargetPlacementId,
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

  // Resolve zoom target geometry against the FULL placement list (not just
  // selected ones) so hover-to-preview works in the Placement step where the
  // hovered row has not yet been selected. Returns null if the target
  // placement has no geometry on the currently visible view — in which case
  // the canvas snaps un-zoomed (e.g. user swiped to a view that doesn't own
  // this placement).
  const zoomGeometry: ZoomGeometry | null = useMemo(() => {
    if (!zoomTargetPlacementId || !currentView) return null;
    const placement = config.placements.find((p) => p.id === zoomTargetPlacementId);
    if (!placement) return null;
    const geom = placement.geometryByViewId[currentView.id];
    if (!geom) return null;
    return {
      centerXPercent: geom.centerXPercent,
      centerYPercent: geom.centerYPercent,
      maxWidthPercent: geom.maxWidthPercent,
      maxHeightPercent: geom.maxHeightPercent ?? null,
    };
  }, [zoomTargetPlacementId, config.placements, currentView]);

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
          maxHeightPercent: geom.maxHeightPercent ?? null,
          scaleFactor: step?.scaleFactor ?? 1,
        };
      });
  }, [config.placements, currentView, placementSelections]);

  // ── View cross-fade ─────────────────────────────────────────────────────
  // `displayedView` drives the live (incoming) layer. `outgoingView` mounts
  // the previous view as an absolutely-positioned sibling stacked above the
  // incoming; a CSS @keyframes animation fades it 1 → 0 over FADE_OUT_MS,
  // revealing the incoming underneath. We just snapshot the outgoing's
  // draw-relevant props (MF-1) and schedule the unmount — all timing is in
  // CSS. If incoming errors, outgoing is torn down immediately (MF-4).
  const [displayedView, setDisplayedView] = useState<ConfiguredView | null>(
    currentView ?? null,
  );
  const [outgoingView, setOutgoingView] = useState<ConfiguredView | null>(null);
  const [outgoingFrozenProps, setOutgoingFrozenProps] =
    useState<FrozenCanvasProps | null>(null);
  const [transitionId, setTransitionId] = useState(0);
  const [frozenAspectRatio, setFrozenAspectRatio] = useState<string | null>(null);
  const transitionTimeoutRef = useRef<number | null>(null);
  // Latest live draw-relevant props, kept fresh by render so the transition
  // effect can snapshot them without listing them all in its dep array (which
  // would fire transitions on every prop tick).
  const liveOutgoingPropsRef = useRef<FrozenCanvasProps | null>(null);

  // Keep liveOutgoingPropsRef in lock-step with the currently-displayed view's
  // live props. This is what gets frozen the instant a transition starts.
  useEffect(() => {
    if (!displayedView || !displayedView.imageUrl) {
      liveOutgoingPropsRef.current = null;
      return;
    }
    liveOutgoingPropsRef.current = {
      imageUrl: displayedView.imageUrl,
      logoUrl,
      placements: canvasPlacements,
      highlightedPlacementId: highlightPlacementId ?? null,
      zoomGeometry,
    };
  }, [displayedView, logoUrl, canvasPlacements, highlightPlacementId, zoomGeometry]);

  // Preload all view images up-front so subsequent view changes come out of
  // the browser image cache. For the FIRST navigation the preload may not
  // have resolved yet — cross-fade still runs; worst case the outgoing fades
  // away while the incoming resolves. Without Cache-Control on R2 responses,
  // the browser may still cache short-term in memory. See R2 finding in PR
  // summary.
  useEffect(() => {
    if (typeof window === "undefined") return;
    for (const v of availableViews) {
      if (!v.imageUrl) continue;
      const img = new Image();
      img.src = v.imageUrl;
      // No handlers — the browser caches by URL. Drop the reference.
    }
  }, [availableViews]);

  // Transition driver. Keyed on currentView.id ONLY — explicitly NOT retryKey
  // (retry remounts the incoming layer but must not cross-fade).
  useEffect(() => {
    if (!currentView) return;
    // Initial mount: nothing to fade from.
    if (displayedView == null) {
      setDisplayedView(currentView);
      return;
    }
    // Same view (e.g. controlled viewId stable across renders). No-op.
    if (displayedView.id === currentView.id) return;

    // Snapshot the outgoing draw props (MF-1). Use the live ref so we pick
    // up the latest values even though this effect's deps don't include them.
    const snapshot = liveOutgoingPropsRef.current;

    // Freeze current frame aspect-ratio so the frame doesn't wobble if the
    // incoming view has a different aspect.
    const frozenRatio =
      aspect != null && aspect > WIDE_ASPECT_THRESHOLD ? "4 / 3" : "1 / 1";

    if (transitionTimeoutRef.current != null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    setOutgoingView(displayedView);
    setOutgoingFrozenProps(snapshot);
    setFrozenAspectRatio(frozenRatio);
    setTransitionId((id) => id + 1);
    setDisplayedView(currentView);

    transitionTimeoutRef.current = window.setTimeout(() => {
      transitionTimeoutRef.current = null;
      setOutgoingView(null);
      setOutgoingFrozenProps(null);
      setFrozenAspectRatio(null);
    }, FADE_OUT_MS);
    // We intentionally omit displayedView / aspect from deps: the trigger
    // is strictly the current view id changing. liveOutgoingPropsRef carries
    // the live draw snapshot; reading it at effect time avoids stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView?.id]);

  // Unmount outgoing on incoming-error (MF-4).
  useEffect(() => {
    if (loadState !== "error") return;
    if (transitionTimeoutRef.current != null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    setOutgoingView(null);
    setOutgoingFrozenProps(null);
    setFrozenAspectRatio(null);
  }, [loadState]);

  // Unmount cleanup for the pending timer.
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current != null) {
        window.clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, []);

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
  const isTransitioning = outgoingView != null;
  const activeDisplayedView = displayedView ?? currentView;

  const frameStyle: React.CSSProperties | undefined =
    frozenAspectRatio != null ? { aspectRatio: frozenAspectRatio } : undefined;

  return (
    <>
      <div
        className="insignia-canvas-frame"
        data-state={frameDataState}
        data-aspect={wide ? "wide" : undefined}
        data-context={context}
        data-transitioning={isTransitioning ? "true" : undefined}
        style={frameStyle}
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
          <>
            {outgoingView && outgoingFrozenProps && outgoingView.imageUrl && (
              <div
                className="insignia-canvas-layer"
                data-role="outgoing"
                key={`${outgoingView.id}:outgoing:${transitionId}`}
                aria-hidden="true"
              >
                <NativeCanvas
                  imageUrl={outgoingFrozenProps.imageUrl}
                  logoUrl={outgoingFrozenProps.logoUrl}
                  placements={outgoingFrozenProps.placements}
                  highlightedPlacementId={
                    outgoingFrozenProps.highlightedPlacementId ?? undefined
                  }
                  zoomTarget={undefined}
                  headless
                />
              </div>
            )}
            <div
              className="insignia-canvas-layer"
              data-role="incoming"
            >
              <NativeCanvas
                key={`${activeDisplayedView.id}:${retryKey}`}
                imageUrl={activeDisplayedView.imageUrl!}
                logoUrl={logoUrl}
                placements={canvasPlacements}
                highlightedPlacementId={highlightPlacementId ?? undefined}
                zoomTarget={
                  zoomTargetPlacementId !== undefined
                    ? { geometry: zoomGeometry }
                    : undefined
                }
                headless
                onLoadStateChange={setLoadState}
                onImageMeta={(meta) => {
                  setAspect(meta.aspect);
                  onImageMeta?.(activeDisplayedView.id, meta);
                }}
                onLogoMeta={onLogoMeta}
              />
            </div>
          </>
        )}
        {loadState === "loading" && !isTransitioning && (
          <div className="insignia-canvas-status">
            <span>{t.v2.placement.canvasLoading}</span>
          </div>
        )}
        {showNav && activeDisplayedView && (
          <span className="insignia-canvas-view-label" aria-live="polite">
            {activeDisplayedView.name || capitalize(activeDisplayedView.perspective)}
          </span>
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
