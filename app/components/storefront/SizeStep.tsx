/**
 * Step 3: Size selection per placement — 4 conditional states.
 * - slider: 3+ sizes, single position (range slider with tick marks)
 * - cards: 2 sizes, single position (radio cards)
 * - multi: multiple positions selected (position tabs + slider per position)
 * - preview: all ≤1 size (reassurance card, auto-skips)
 */

import { useEffect, useRef, useState } from "react";
import type { StorefrontConfig, PlacementSelections, PlacementStep as PlacementStepType } from "./types";
import type { LogoState } from "./CustomizationModal";
import type { TranslationStrings } from "./i18n";
import { formatCurrency } from "./currency";
import { IconCheck, IconCircleCheck, IconMapPin } from "./icons";

type SizeState = "slider" | "cards" | "multi" | "preview";

function getSizeState(
  selectedPlacements: { steps: { length: number } }[],
): SizeState {
  const allSingle = selectedPlacements.every((p) => p.steps.length <= 1);
  if (allSingle) return "preview";
  if (selectedPlacements.length > 1) return "multi";
  const stepCount = selectedPlacements[0]?.steps.length ?? 0;
  if (stepCount === 2) return "cards";
  return "slider";
}

/* ── Slider sub-component ─────────────────────────────────── */

function SizeSlider({
  steps,
  activeIndex,
  onIndexChange,
  currency,
}: {
  steps: PlacementStepType[];
  activeIndex: number;
  onIndexChange: (i: number) => void;
  currency: string;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const fillPercent = steps.length <= 1 ? 0 : (activeIndex / (steps.length - 1)) * 100;

  const snapToNearest = (clientX: number) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || steps.length <= 1) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onIndexChange(Math.round(pct * (steps.length - 1)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    snapToNearest(e.clientX);
    const onMove = (moveEvent: PointerEvent) => snapToNearest(moveEvent.clientX);
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const current = steps[activeIndex];

  return (
    <div className="insignia-size-slider-card">
      <div className="insignia-size-display-row">
        <span className="insignia-size-display-name">{current?.label}</span>
        <span className="insignia-size-display-dim">{current?.scaleFactor}x</span>
        {current && current.priceAdjustmentCents !== 0 && (
          <span className="insignia-size-display-price">
            +{formatCurrency(current.priceAdjustmentCents, currency)}
          </span>
        )}
      </div>

      <div
        ref={sliderRef}
        className="insignia-slider-wrap"
        role="slider"
        aria-valuenow={activeIndex}
        aria-valuemin={0}
        aria-valuemax={steps.length - 1}
        aria-label="Logo size"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onIndexChange(Math.min(activeIndex + 1, steps.length - 1));
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onIndexChange(Math.max(activeIndex - 1, 0));
          }
        }}
      >
        <div className="insignia-slider-track" />
        <div className="insignia-slider-fill" style={{ width: `${fillPercent}%` }} />
        <div className="insignia-slider-thumb" style={{ left: `${fillPercent}%` }} />
      </div>

      <div className="insignia-slider-ticks">
        {steps.map((step, i) => (
          <button
            key={i}
            type="button"
            className="insignia-slider-tick"
            data-active={i === activeIndex ? "true" : undefined}
            onClick={() => onIndexChange(i)}
            aria-label={step.label}
          >
            <div className="insignia-slider-tick-mark" />
            <span className="insignia-slider-tick-label">
              {step.label.charAt(0).toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main SizeStep component ──────────────────────────────── */

type SizeStepProps = {
  config: StorefrontConfig;
  placementSelections: PlacementSelections;
  onPlacementSelectionsChange: (s: PlacementSelections) => void;
  logo: LogoState;
  onContinue: () => void;
  t: TranslationStrings;
};

export function SizeStep({
  config,
  placementSelections,
  onPlacementSelectionsChange,
  logo: _logo, // eslint-disable-line @typescript-eslint/no-unused-vars
  onContinue,
  t,
}: SizeStepProps) {
  const selectedPlacementIds = config.placements.filter(
    (p) => placementSelections[p.id] !== undefined
  );
  const [currentPlacementIndex, setCurrentPlacementIndex] = useState(0);
  const currentPlacement = selectedPlacementIds[currentPlacementIndex];

  const sizeState = getSizeState(selectedPlacementIds);

  // Auto-skip when ALL selected placements have ≤1 step
  useEffect(() => {
    if (sizeState === "preview") {
      onContinue();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentPlacement) {
    return (
      <section>
        <p>No placements selected. Go back and select at least one.</p>
      </section>
    );
  }

  const stepIndex =
    placementSelections[currentPlacement.id] ?? currentPlacement.defaultStepIndex;
  const setStepIndex = (idx: number) => {
    onPlacementSelectionsChange({
      ...placementSelections,
      [currentPlacement.id]: Math.max(0, Math.min(idx, currentPlacement.steps.length - 1)),
    });
  };

  // Heading text based on state
  const headingTitle =
    sizeState === "preview" ? t.size.previewTitle : t.size.logoSize;
  const headingSub =
    sizeState === "preview"
      ? t.size.previewSubtitle
      : sizeState === "multi"
        ? t.size.adjustSizePerPosition
        : sizeState === "cards"
          ? t.size.chooseLogoSize
          : t.size.setSizeForPlacement;

  return (
    <section aria-labelledby="size-heading">
      <h2 id="size-heading" className="visually-hidden">
        {t.size.sizeLabel}
      </h2>

      {/* Desktop step heading */}
      <div className="insignia-step-heading">
        <p className="insignia-step-heading-title">{headingTitle}</p>
        <p className="insignia-step-heading-sub">{headingSub}</p>
      </div>

      {/* Position badge — single-position states only */}
      {sizeState !== "multi" && selectedPlacementIds.length <= 1 && (
        <div className="insignia-position-badge">
          <IconMapPin size={14} />
          <span>
            {t.size.position} 1 {t.size.of} 1 · {currentPlacement.name}
          </span>
        </div>
      )}

      {/* State A: Slider (3+ sizes, single position) */}
      {sizeState === "slider" && (
        <SizeSlider
          steps={currentPlacement.steps}
          activeIndex={stepIndex}
          onIndexChange={setStepIndex}
          currency={config.currency}
        />
      )}

      {/* State B: Cards (2 sizes, single position) */}
      {sizeState === "cards" && (
        <div
          className="insignia-size-cards"
          role="group"
          aria-label={t.size.sizeLabel}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {currentPlacement.steps.map((step, i) => {
            const isSelected = i === stepIndex;
            const priceText =
              step.priceAdjustmentCents === 0
                ? "No extra charge"
                : `+${formatCurrency(step.priceAdjustmentCents, config.currency)}`;
            return (
              <button
                key={i}
                type="button"
                className={`insignia-size-card${isSelected ? " insignia-size-card--selected" : ""}`}
                onClick={() => setStepIndex(i)}
                aria-pressed={isSelected}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0 20px",
                  minHeight: 72,
                  background: isSelected ? "var(--insignia-primary-light)" : "white",
                  border: `1px solid ${isSelected ? "var(--insignia-primary)" : "var(--insignia-border)"}`,
                  borderRadius: "var(--insignia-radius)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--insignia-text)" }}>
                    {step.label}
                  </span>
                  <span style={{ fontSize: 12, color: isSelected ? "var(--insignia-primary)" : "#6B7280" }}>
                    {step.scaleFactor}x · {priceText}
                  </span>
                </div>
                <div
                  className="insignia-method-indicator"
                  data-selected={isSelected ? "true" : undefined}
                >
                  {isSelected && (
                    <IconCheck size={12} style={{ color: "white" }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* State C: Multi-position (tabs + slider) */}
      {sizeState === "multi" && (
        <>
          <div className="insignia-position-tabs">
            {selectedPlacementIds.map((p, i) => {
              const isDone = i < currentPlacementIndex;
              const isActive = i === currentPlacementIndex;
              const state = isDone ? "done" : isActive ? "active" : "pending";
              return (
                <button
                  key={p.id}
                  type="button"
                  className="insignia-position-tab"
                  data-state={state}
                  onClick={() => setCurrentPlacementIndex(i)}
                >
                  {isDone && <IconCheck size={14} />}
                  {isActive && <IconMapPin size={14} />}
                  {!isDone && !isActive && (
                    <div className="insignia-position-tab-dot" />
                  )}
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>

          {currentPlacement.steps.length >= 2 && (
            <SizeSlider
              steps={currentPlacement.steps}
              activeIndex={stepIndex}
              onIndexChange={setStepIndex}
              currency={config.currency}
            />
          )}

          {currentPlacement.steps.length <= 1 && (
            <div className="insignia-reassurance">
              <div className="insignia-reassurance-top">
                <IconCircleCheck
                  size={16}
                  style={{ color: "var(--insignia-primary)" }}
                />
                <span className="insignia-reassurance-title">
                  {t.size.allSetTitle}
                </span>
              </div>
              <p className="insignia-reassurance-body">
                {t.size.allSetBody}
              </p>
            </div>
          )}
        </>
      )}

      {/* State D: Preview only (≤1 size on all placements) */}
      {sizeState === "preview" && (
        <div className="insignia-reassurance">
          <div className="insignia-reassurance-top">
            <IconCircleCheck
              size={16}
              style={{ color: "var(--insignia-primary)" }}
            />
            <span className="insignia-reassurance-title">
              {t.size.allSetTitle}
            </span>
          </div>
          <p className="insignia-reassurance-body">{t.size.allSetBody}</p>
        </div>
      )}
    </section>
  );
}
