/**
 * D9 — Quantity grid for the Review step (B2B per-size quantities).
 *
 * 4-column grid of compact cards: size label on top, [− input +] stepper
 * below. Cards with qty > 0 get tint fill + accent border. Unavailable
 * variants render disabled with "Sold out" subscript.
 *
 * Input spec (from design intent doc):
 *   - type="text" with inputmode="numeric" pattern="[0-9]*" — not type="number"
 *   - onFocus selects all text
 *   - onInput strips non-digits live
 *   - onBlur clamps to [0, 999]; empty → "0"
 *   - enterkeyhint="done"
 *   - long-press ± 400ms hold → auto-repeat every 120ms
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ProductVariantOption } from "./types";
import type { TranslationStrings } from "./i18n";

const MAX_QTY = 999;
const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 120;
// Industry-standard "touch slop" — iOS HIG uses ~10px, Android Material uses 8dp.
// If the pointer moves more than this many pixels after pointerdown, the gesture
// is treated as a scroll, not a tap, and the press is cancelled.
const TOUCH_SLOP_PX = 10;

/**
 * Detect whether the variant set has duplicate `sizeLabel` values. The
 * backend tries to identify the size axis heuristically — when it fails on
 * multi-axis catalogs (e.g. Color × Material × Size where the wrong axis
 * is detected), several variants can share the same label. In that case the
 * grid falls back to `variant.title` (always unique) for disambiguation.
 */
function hasSizeLabelCollisions(variants: ProductVariantOption[]): boolean {
  const seen = new Set<string>();
  for (const v of variants) {
    if (seen.has(v.sizeLabel)) return true;
    seen.add(v.sizeLabel);
  }
  return false;
}

type QuantityGridProps = {
  variants: ProductVariantOption[];
  quantities: Record<string, number>;
  onChange: (q: Record<string, number>) => void;
  variantAxis: "size" | "color" | "option";
  t: TranslationStrings;
};

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > MAX_QTY) return MAX_QTY;
  return Math.floor(n);
}

export function QuantityGrid({ variants, quantities, onChange, variantAxis, t }: QuantityGridProps) {
  const setQty = useCallback(
    (variantId: string, qty: number) => {
      const next = { ...quantities, [variantId]: clamp(qty) };
      if (next[variantId] === 0) delete next[variantId];
      onChange(next);
    },
    [quantities, onChange],
  );

  // D9 — when sizeLabel collisions exist (multi-axis catalog where the
  // backend's size-axis heuristic failed), fall back to variant.title which
  // is always unique. This keeps every cell visually distinct.
  const useTitleAsLabel = useMemo(() => hasSizeLabelCollisions(variants), [variants]);

  const labelKind: "size-code" | "free-text" =
    variantAxis === "size" && !useTitleAsLabel ? "size-code" : "free-text";

  return (
    <div className="insignia-qty-grid">
      {variants.map((v) => {
        const qty = quantities[v.id] ?? 0;
        const disabled = !v.available;
        return (
          <QuantityCard
            key={v.id}
            label={useTitleAsLabel ? v.title : v.sizeLabel}
            labelKind={labelKind}
            qty={qty}
            disabled={disabled}
            onSet={(n) => setQty(v.id, n)}
            t={t}
          />
        );
      })}
    </div>
  );
}

function QuantityCard({
  label,
  labelKind,
  qty,
  disabled,
  onSet,
  t,
}: {
  label: string;
  labelKind: "size-code" | "free-text";
  qty: number;
  disabled: boolean;
  onSet: (n: number) => void;
  t: TranslationStrings;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="insignia-qty-card"
      data-state={disabled ? "disabled" : qty > 0 ? "selected" : undefined}
    >
      <span
        className="insignia-qty-card-label"
        data-label-kind={labelKind}
      >{label}</span>
      {disabled ? (
        <span className="insignia-qty-card-soldout">{t.v2.review.soldOut}</span>
      ) : (
        <div className="insignia-qty-stepper">
          <HoldRepeatButton
            ariaLabel={`Decrease ${label}`}
            disabled={qty <= 0}
            onTick={() => onSet(qty - 1)}
          >
            &minus;
          </HoldRepeatButton>
          <input
            ref={inputRef}
            className="insignia-qty-stepper-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            value={qty}
            aria-label={`Quantity for ${label}`}
            onFocus={(e) => e.target.select()}
            onInput={(e) => {
              const stripped = (e.currentTarget.value || "").replace(/\D/g, "");
              e.currentTarget.value = stripped;
            }}
            onChange={(e) => {
              const n = e.target.value === "" ? 0 : parseInt(e.target.value, 10);
              onSet(n);
            }}
            onBlur={(e) => {
              if (e.target.value === "") onSet(0);
            }}
          />
          <HoldRepeatButton
            ariaLabel={`Increase ${label}`}
            disabled={qty >= MAX_QTY}
            onTick={() => onSet(qty + 1)}
          >
            +
          </HoldRepeatButton>
        </div>
      )}
    </div>
  );
}

/**
 * HoldRepeatButton — scroll-safe stepper button.
 *
 * Activation model (industry-standard "tap-up with touch-slop"):
 *
 *  • pointerdown  — record start position; start HOLD_DELAY_MS timer but do
 *                   NOT fire immediately and do NOT call preventDefault().
 *                   Not calling preventDefault() is critical: it allows the
 *                   browser to fire pointercancel if the touch turns into a
 *                   scroll gesture, which our onPointerCancel handler uses to
 *                   cleanly abort. (MDN: "if the pointer is then used to
 *                   manipulate the viewport by panning/scrolling, pointercancel
 *                   fires" — but only when preventDefault was NOT called.)
 *
 *  • pointermove  — if pointer travels > TOUCH_SLOP_PX (10px, matching iOS HIG
 *                   and react-aria) the gesture is treated as scroll: cancel
 *                   all pending timers without firing.
 *
 *  • pointerup    — if we reach here without a slop-cancel AND the hold-repeat
 *                   interval is not already running, fire once (tap path).
 *                   If hold-repeat is running, stop it — the first tick already
 *                   fired via the hold timer.
 *
 *  • pointercancel — browser cancelled the gesture (user started scrolling).
 *                    Clear all timers, fire nothing.
 *
 *  • onClick      — keyboard path (Space/Enter). pointerdown doesn't precede a
 *                   synthetic keyboard click, so we fire here when the pointer
 *                   path didn't already fire.
 *
 * CSS companion: .insignia-qty-stepper-btn gets touch-action: manipulation so
 * the 300ms click-delay is suppressed without blocking vertical scroll on the
 * grid container.
 */
function HoldRepeatButton({
  ariaLabel,
  disabled,
  onTick,
  children,
}: {
  ariaLabel: string;
  disabled: boolean;
  onTick: () => void;
  children: React.ReactNode;
}) {
  const holdTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  // Pointer-press tracking state — stored in a ref to avoid re-renders.
  const pressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    /** True once the hold-delay fired and auto-repeat is (or was) running. */
    didHold: boolean;
    /** True if we already fired the single tap tick (pointerup path). */
    didTick: boolean;
  } | null>(null);

  // Set to true when a pointer sequence handled the action; guards onClick from
  // double-firing when the browser synthesises a click after pointerup.
  const pointerHandledRef = useRef(false);

  const stopTimers = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancelPress = useCallback(() => {
    stopTimers();
    pressRef.current = null;
  }, [stopTimers]);

  useEffect(() => () => stopTimers(), [stopTimers]);

  return (
    <button
      type="button"
      className="insignia-qty-stepper-btn"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        // Keyboard path (Space/Enter): no preceding pointer sequence.
        // pointerHandledRef guards against the browser's synthetic click that
        // follows a real pointer tap — we already fired in onPointerUp.
        if (pointerHandledRef.current) {
          pointerHandledRef.current = false;
          return;
        }
        tickRef.current();
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        // Only handle primary pointer (ignore secondary touches / mouse buttons)
        if (e.button !== 0 && e.button !== undefined) return;

        // --- DO NOT call e.preventDefault() here ---
        // Calling it would suppress the browser's scroll-gesture recognition,
        // which means pointercancel would never fire when the user scrolls over
        // this button — exactly the accidental-tap bug we're fixing.

        pressRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          didHold: false,
          didTick: false,
        };

        // Start the hold timer. First repeat fires after HOLD_DELAY_MS; we
        // fire the initial tick at that point too (matching native stepper UX).
        holdTimerRef.current = window.setTimeout(() => {
          if (pressRef.current == null) return;
          pressRef.current.didHold = true;
          pressRef.current.didTick = true;
          tickRef.current(); // first tick on hold
          intervalRef.current = window.setInterval(() => {
            tickRef.current();
          }, HOLD_INTERVAL_MS);
        }, HOLD_DELAY_MS);
      }}
      onPointerMove={(e) => {
        const press = pressRef.current;
        if (press == null || e.pointerId !== press.pointerId) return;

        const dx = e.clientX - press.startX;
        const dy = e.clientY - press.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > TOUCH_SLOP_PX) {
          // Pointer has drifted — treat as scroll. Cancel cleanly.
          cancelPress();
        }
      }}
      onPointerUp={(e) => {
        const press = pressRef.current;
        if (press == null || e.pointerId !== press.pointerId) {
          stopTimers();
          return;
        }

        stopTimers();

        if (!press.didTick) {
          // Short tap path: hold never fired, so fire the single tick now.
          tickRef.current();
        }
        // If didHold is true the hold timer already fired — do NOT double-fire.

        // Mark that a pointer sequence handled this interaction so the
        // browser's synthetic onClick (which follows pointerup) is suppressed.
        pointerHandledRef.current = true;
        pressRef.current = null;
      }}
      onPointerCancel={() => {
        // Browser cancelled the gesture (e.g. user started scrolling).
        // Clear timers and do NOT fire — this is the scroll-cancel path.
        cancelPress();
      }}
      onPointerLeave={() => {
        // Pointer left the button surface; treat same as cancel.
        cancelPress();
      }}
    >
      {children}
    </button>
  );
}
