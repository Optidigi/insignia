/**
 * Step 3 — Size selection per placement.
 *
 * Layout decision per `placement.steps.length`:
 *   ≤ 1 → single-size card (no control; tab label becomes "Preview" in the
 *         shell's header logic when ALL placements are single-step).
 *   = 2 → segmented control (pill).
 *   ≥ 3 → stepped slider with notches + end labels.
 *   ≥ 7 → slider with data-dense="true" (smaller labels).
 *
 * Multiple selected placements → segment progress bar at top (1 of N) + the
 * placement name. Imperative `tryAdvance` ref allows the shell to drive
 * "Continue" through each placement before proceeding to Review.
 *
 * Calibration suffix (C6): when ConfiguredView.calibrationPxPerCm is non-null
 * and the placement geometry's maxWidthPercent is known, append "· ~N cm wide"
 * to the size label. Stub today (server doesn't return calibrationPxPerCm yet).
 *
 * Backend bindings: none. Pure client state on top of config.placements.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StorefrontConfig,
  PlacementSelections,
  PlacementStep as PlacementStepType,
} from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatPriceDelta } from "./currency";
import { PreviewCanvas } from "./PreviewCanvas";
import type { ImageMeta } from "./NativeCanvas";

export type SizeStepHandle = {
  tryAdvance: () => boolean;
};

type SizeStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  logo: LogoState;
  desktopActiveViewId?: string;
  onDesktopActiveViewChange?: (viewId: string) => void;
  /** Per-view natural image dimensions, populated by PreviewCanvas. */
  imageMetaByViewId?: Record<string, ImageMeta>;
  /** Forward to the embedded PreviewCanvas so it populates the meta cache. */
  onImageMeta?: (viewId: string, meta: ImageMeta) => void;
  /** Logo image natural dimensions, used to fit logo aspect into zone. */
  logoMeta?: ImageMeta | null;
  /** Forward to the embedded PreviewCanvas so it populates logoMeta. */
  onLogoMeta?: (meta: ImageMeta | null) => void;
  /**
   * Placement id that the preview should zoom toward. On this step the
   * shell typically mirrors the currently-active placement, but the prop
   * is forwarded verbatim so the shell owns the policy.
   */
  zoomTargetPlacementId?: string | null;
  /**
   * Emitted whenever the active placement changes (user navigated between
   * placements or tryAdvance moved the pointer). Shell uses this to keep
   * zoomTargetPlacementId in sync.
   */
  onActivePlacementChange?: (placementId: string | null) => void;
  t: TranslationStrings;
  onAnalytics?: (name: string, detail: Record<string, unknown>) => void;
};

/**
 * Compute the calibrated cm-size suffix (W × H) for a placement at a given step.
 *
 * The zone is the merchant-configured print area:
 *   zoneWidthCm  = (maxWidthPercent  / 100) × mockupW × scale / pxPerCm
 *   zoneHeightCm = (maxHeightPercent / 100) × mockupH × scale / pxPerCm
 *
 * Inside that zone we letterbox-fit the logo (preserving its aspect). So the
 * actual rendered logo dimensions are bounded by whichever axis maxes out
 * first:
 *   fit   = min(zoneW / logoW, zoneH / logoH)   (in px)
 *   logoW_cm = (logoW × fit) / pxPerCm
 *   logoH_cm = (logoH × fit) / pxPerCm
 *
 * Equivalently — and without needing the logo's cm-space size — compare
 * aspect ratios: if logo is wider than zone, width-limited; else height-
 * limited.
 *
 * Falls back to the raw zone dimensions when logoMeta is missing (e.g. logo
 * hasn't loaded yet). Returns null if any calibration input is missing.
 * Both dimensions are rounded to the nearest centimeter.
 */
function calibrationLabel(
  step: PlacementStepType,
  geom: { maxWidthPercent: number; maxHeightPercent?: number | null } | undefined,
  imageMeta: { naturalWidthPx: number; naturalHeightPx: number } | null | undefined,
  logoMeta: { naturalWidthPx: number; naturalHeightPx: number } | null | undefined,
  calibrationPxPerCm: number | null | undefined,
  t: TranslationStrings,
): string | null {
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
  const scale = step.scaleFactor ?? 1;
  const zoneWidthCm =
    ((geom.maxWidthPercent / 100) * imageMeta.naturalWidthPx * scale) / calibrationPxPerCm;
  const heightPercent = geom.maxHeightPercent ?? geom.maxWidthPercent;
  const zoneHeightCm =
    ((heightPercent / 100) * imageMeta.naturalHeightPx * scale) / calibrationPxPerCm;
  if (
    !Number.isFinite(zoneWidthCm) ||
    !Number.isFinite(zoneHeightCm) ||
    zoneWidthCm <= 0 ||
    zoneHeightCm <= 0
  ) {
    return null;
  }

  // Fit the logo's aspect ratio inside the zone (letterbox). When the logo
  // dimensions aren't known yet (meta still loading) fall back to the zone.
  let widthCm = zoneWidthCm;
  let heightCm = zoneHeightCm;
  if (logoMeta && logoMeta.naturalWidthPx > 0 && logoMeta.naturalHeightPx > 0) {
    const logoAspect = logoMeta.naturalWidthPx / logoMeta.naturalHeightPx;
    const zoneAspect = zoneWidthCm / zoneHeightCm;
    if (logoAspect > zoneAspect) {
      // Logo is wider than zone → width-limited.
      widthCm = zoneWidthCm;
      heightCm = zoneWidthCm / logoAspect;
    } else {
      // Logo is taller or matches zone aspect → height-limited.
      heightCm = zoneHeightCm;
      widthCm = zoneHeightCm * logoAspect;
    }
  }

  return t.v2.size.calibratedSuffix
    .replace("{w}", String(Math.round(widthCm)))
    .replace("{h}", String(Math.round(heightCm)));
}

export const SizeStep = forwardRef<SizeStepHandle, SizeStepProps>(function SizeStep(
  {
    config,
    placementSelections,
    onPlacementSelectionsChange,
    logo,
    desktopActiveViewId,
    onDesktopActiveViewChange,
    imageMetaByViewId,
    onImageMeta,
    logoMeta,
    onLogoMeta,
    zoomTargetPlacementId,
    onActivePlacementChange,
    t,
    onAnalytics,
  },
  ref,
) {
  // Iterate config.placements (canonical order) and keep only selected ones,
  // so the Size step walks placements in the same order shown on Placement.
  const selectedPlacements = useMemo(
    () => config.placements.filter((p) => placementSelections[p.id] !== undefined),
    [placementSelections, config.placements],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(activeIndex, Math.max(0, selectedPlacements.length - 1));
  const activePlacement = selectedPlacements[safeIndex];

  useImperativeHandle(
    ref,
    () => ({
      tryAdvance: () => {
        if (safeIndex < selectedPlacements.length - 1) {
          setActiveIndex(safeIndex + 1);
          return true;
        }
        return false;
      },
    }),
    [safeIndex, selectedPlacements.length],
  );

  // Drive the desktop preview to the view that owns the active placement.
  // Run on every placement change — without this the viewId locks on the
  // first placement's view, so the back-view image (and its calibration meta)
  // never loads when the user navigates to a back-side placement.
  useEffect(() => {
    if (!activePlacement || !onDesktopActiveViewChange) return;
    const ownerView = config.views.find(
      (v) => activePlacement.geometryByViewId[v.id] != null,
    );
    if (ownerView && ownerView.id !== desktopActiveViewId) {
      onDesktopActiveViewChange(ownerView.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlacement?.id]);

  // Emit the active placement id up to the shell so it can drive the zoom
  // target. Both user navigation and tryAdvance funnel through activeIndex,
  // so a single effect keyed on activePlacement?.id covers both paths.
  useEffect(() => {
    onActivePlacementChange?.(activePlacement?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlacement?.id]);

  const setStep = useCallback(
    (placementId: string, stepIndex: number) => {
      onPlacementSelectionsChange({
        ...placementSelections,
        [placementId]: stepIndex,
      });
      onAnalytics?.("size_changed", { placementId, stepIndex });
    },
    [placementSelections, onPlacementSelectionsChange, onAnalytics],
  );

  if (!activePlacement) {
    // No placements selected → the shell shouldn't have routed here, but
    // render a benign empty state defensively.
    return (
      <section aria-labelledby="insignia-size-heading">
        <div className="insignia-step-heading">
          <h2 id="insignia-size-heading" className="insignia-step-heading-title">
            {t.size.title}
          </h2>
        </div>
        <p className="insignia-pick-header-meta">{t.placement.subtitle}</p>
      </section>
    );
  }

  const ownerView = config.views.find(
    (v) => activePlacement.geometryByViewId[v.id] != null,
  );
  const geom = ownerView ? activePlacement.geometryByViewId[ownerView.id] : null;

  const currentStepIndex = placementSelections[activePlacement.id] ?? activePlacement.defaultStepIndex;
  const currentStep = activePlacement.steps[currentStepIndex] ?? activePlacement.steps[0];
  const totalSteps = activePlacement.steps.length;

  // C6 — calibrated cm suffix (W × H). Requires (a) merchant calibration on
  // the owning view, (b) the loaded mockup image's natural pixel dimensions
  // (lifted from PreviewCanvas via imageMetaByViewId).
  const ownerImageMeta = ownerView ? imageMetaByViewId?.[ownerView.id] : null;
  const calibration = calibrationLabel(
    currentStep,
    geom ?? undefined,
    ownerImageMeta ?? null,
    logoMeta ?? null,
    ownerView?.calibrationPxPerCm ?? null,
    t,
  );
  // Task 2 — build valueLabel as a React node so the cm suffix gets its own
  // smaller/lighter <span> rather than being concatenated into a plain string.
  // When calibration is null we fall back to the plain label string (safe for
  // aria-live and aria-valuetext on the slider which expects a string).
  const valueLabelStr = calibration
    ? `${currentStep.label} ${calibration}`
    : currentStep.label;
  const valueLabelNode = calibration ? (
    <>
      {currentStep.label}{" "}
      <span className="insignia-size-card-value-cm">{calibration}</span>
    </>
  ) : (
    currentStep.label
  );

  const segmentsCount = selectedPlacements.length;
  const showSegments = segmentsCount > 1;

  return (
    <section aria-labelledby="insignia-size-heading">
      <div className="insignia-step-heading">
        <h2 id="insignia-size-heading" className="insignia-step-heading-title">
          {t.size.title}
        </h2>
        <p className="insignia-step-heading-sub">{t.size.adjustSizePerPosition}</p>
      </div>

      <PreviewCanvas
        config={config}
        placementSelections={placementSelections}
        logo={logo}
        highlightPlacementId={activePlacement.id}
        zoomTargetPlacementId={zoomTargetPlacementId}
        viewId={desktopActiveViewId}
        onViewChange={onDesktopActiveViewChange}
        onImageMeta={onImageMeta}
        onLogoMeta={onLogoMeta}
        context="step"
        t={t}
      />

      {showSegments && (
        <div className="insignia-size-header" aria-live="polite">
          <p className="insignia-size-progress">
            {t.v2.size.placementOf
              .replace("{current}", String(safeIndex + 1))
              .replace("{total}", String(segmentsCount))}
          </p>
          <p className="insignia-size-placement-name">{activePlacement.name}</p>
          <div
            className="insignia-size-segments"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={segmentsCount}
            aria-valuenow={safeIndex + 1}
          >
            {selectedPlacements.map((p, i) => (
              <span
                key={p.id}
                className="insignia-size-segment"
                data-state={i <= safeIndex ? "filled" : undefined}
              />
            ))}
          </div>
        </div>
      )}
      {!showSegments && (
        <div className="insignia-size-header">
          <p className="insignia-size-placement-name">{activePlacement.name}</p>
        </div>
      )}

      {totalSteps <= 1 ? (
        <>
          <div className="insignia-size-card" data-variant="single">
            <div className="insignia-size-card-row">
              <span className="insignia-size-card-label">{t.v2.size.sizeLabel}</span>
              <span className="insignia-size-card-value" aria-live="polite" aria-label={valueLabelStr}>
                {valueLabelNode}
              </span>
            </div>
            <div className="insignia-size-single-pill">
              <svg
                className="insignia-size-single-pill-icon"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{t.v2.size.singleStepNotice}</span>
            </div>
          </div>

          <p className="insignia-size-card-meta">
            {(() => {
              const cents = currentStep?.priceAdjustmentCents ?? 0;
              return (
                <>
                  {t.v2.size.priceDelta} —{" "}
                  <strong data-included={cents === 0 ? "true" : undefined}>
                    {cents === 0
                      ? t.v2.size.included
                      : formatPriceDelta(cents, config.currency)}
                  </strong>
                </>
              );
            })()}
          </p>
        </>
      ) : (
        <>
          <div className="insignia-size-card">
            <div className="insignia-size-card-row">
              <span className="insignia-size-card-label">{t.v2.size.sizeLabel}</span>
              <span className="insignia-size-card-value" aria-live="polite" aria-label={valueLabelStr}>
                {valueLabelNode}
              </span>
            </div>

            {totalSteps >= 3 ? (
              <SizeSlider
                steps={activePlacement.steps}
                activeIndex={currentStepIndex}
                onChange={(i) => setStep(activePlacement.id, i)}
              />
            ) : (
              <SizeSegmented
                steps={activePlacement.steps}
                activeIndex={currentStepIndex}
                onChange={(i) => setStep(activePlacement.id, i)}
                currency={config.currency}
                t={t}
              />
            )}
          </div>

          <p className="insignia-size-card-meta">
            {(() => {
              const cents = currentStep?.priceAdjustmentCents ?? 0;
              return (
                <>
                  {t.v2.size.priceDelta} —{" "}
                  <strong data-included={cents === 0 ? "true" : undefined}>
                    {cents === 0
                      ? t.v2.size.included
                      : formatPriceDelta(cents, config.currency)}
                  </strong>
                </>
              );
            })()}
          </p>
        </>
      )}
    </section>
  );
});

// ── Sub-controls ─────────────────────────────────────────────────────────────

function SizeSlider({
  steps,
  activeIndex,
  onChange,
}: {
  steps: PlacementStepType[];
  activeIndex: number;
  onChange: (i: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dense = steps.length >= 7;
  const fillPercent = steps.length <= 1 ? 0 : (activeIndex / (steps.length - 1)) * 100;

  const snapToClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || steps.length <= 1) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(Math.round(pct * (steps.length - 1)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    snapToClientX(e.clientX);
    const onMove = (ev: PointerEvent) => snapToClientX(ev.clientX);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(steps.length - 1, activeIndex + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, activeIndex - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(steps.length - 1);
    }
  };

  return (
    <div>
      <div
        ref={trackRef}
        className="insignia-slider"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={steps.length - 1}
        aria-valuenow={activeIndex}
        aria-valuetext={steps[activeIndex]?.label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="insignia-slider-track" />
        <div className="insignia-slider-fill" style={{ width: `${fillPercent}%` }} />
        <div className="insignia-slider-notches">
          {steps.map((_, i) => {
            const left = (i / (steps.length - 1)) * 100;
            return (
              <span
                key={i}
                className="insignia-slider-notch"
                data-state={i <= activeIndex ? "passed" : undefined}
                style={{ left: `${left}%` }}
              />
            );
          })}
        </div>
        <div
          className="insignia-slider-thumb"
          data-dragging={dragging ? "true" : undefined}
          style={{ left: `${fillPercent}%` }}
        >
          <span className="insignia-slider-tooltip">{steps[activeIndex]?.label}</span>
        </div>
      </div>
      <div className="insignia-slider-labels" data-dense={dense ? "true" : undefined}>
        {steps.map((s, i) => (
          <span
            key={i}
            className="insignia-slider-label"
            data-active={i === activeIndex ? "true" : undefined}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SizeSegmented({
  steps,
  activeIndex,
  onChange,
  currency,
  t,
}: {
  steps: PlacementStepType[];
  activeIndex: number;
  onChange: (i: number) => void;
  currency: string;
  t: TranslationStrings;
}) {
  return (
    <div className="insignia-segmented" role="tablist">
      {steps.map((s, i) => {
        const isActive = i === activeIndex;
        const cents = s.priceAdjustmentCents;
        const isIncluded = cents === 0;
        const priceLabel = isIncluded
          ? t.v2.size.included
          : formatPriceDelta(cents, currency);
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            className="insignia-segmented-btn"
            data-state={isActive ? "active" : undefined}
            onClick={() => onChange(i)}
          >
            <span className="insignia-segmented-label">{s.label}</span>
            <span
              className="insignia-segmented-price"
              data-included={isActive && isIncluded ? "true" : undefined}
            >
              {priceLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

