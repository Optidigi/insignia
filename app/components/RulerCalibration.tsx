/**
 * RulerCalibration
 *
 * A transparent HTML overlay rendered on top of the canvas area.
 * The merchant clicks two points on the product image, enters the real-world
 * distance between them, and the component derives pixels-per-cm.
 *
 * NOT Konva-based — uses regular HTML/CSS with absolute positioning.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

type Point = { x: number; y: number }; // fractional (0–1) relative to overlay

type Props = {
  active: boolean;
  onCalibrate: (pxPerCm: number) => void;
  onCancel: () => void;
  /** Natural pixel width of the product image */
  imageWidth: number;
  /** Natural pixel height of the product image */
  imageHeight: number;
};

// ============================================================================
// Helpers
// ============================================================================

/** Convert fractional coords + image dimensions → pixel distance in image space */
function pixelDistance(
  a: Point,
  b: Point,
  imageWidth: number,
  imageHeight: number,
): number {
  const dx = (b.x - a.x) * imageWidth;
  const dy = (b.y - a.y) * imageHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Given two fractional points on an overlay, return the angle (degrees) of the
 *  connecting line so we can rotate a div to draw it. */
function lineAngle(a: Point, b: Point, width: number, height: number): number {
  const dx = (b.x - a.x) * width;
  const dy = (b.y - a.y) * height;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Length of the line in px (screen space) between two fractional points */
function lineLength(a: Point, b: Point, width: number, height: number): number {
  const dx = (b.x - a.x) * width;
  const dy = (b.y - a.y) * height;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// Component
// ============================================================================

export function RulerCalibration({
  active,
  onCalibrate,
  onCancel,
  imageWidth,
  imageHeight,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const distanceInputRef = useRef<HTMLInputElement>(null);

  const [pointA, setPointA] = useState<Point | null>(null);
  const [pointB, setPointB] = useState<Point | null>(null);

  // Card input state
  const [distance, setDistance] = useState<string>("");
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const [error, setError] = useState<string>("");

  // Reset internal state whenever `active` changes
  useEffect(() => {
    if (!active) {
      setPointA(null);
      setPointB(null);
      setDistance("");
      setUnit("cm");
      setError("");
    }
  }, [active]);

  // Esc key → cancel
  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, onCancel]);

  // Focus the distance input when both points are set
  useEffect(() => {
    if (pointA && pointB) {
      distanceInputRef.current?.focus();
    }
  }, [pointA, pointB]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Once both points are set, clicks on the overlay are ignored (card handles it)
      if (pointA && pointB) return;

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const pt: Point = { x: Math.max(0, Math.min(1, fx)), y: Math.max(0, Math.min(1, fy)) };

      if (!pointA) {
        setPointA(pt);
      } else {
        setPointB(pt);
      }
    },
    [pointA, pointB],
  );

  const handleApply = useCallback(() => {
    setError("");
    const d = parseFloat(distance);
    if (!isFinite(d) || d <= 0) {
      setError("Enter a positive distance.");
      return;
    }
    if (!pointA || !pointB) return;

    const realCm = unit === "in" ? d * 2.54 : d;
    const px = pixelDistance(pointA, pointB, imageWidth, imageHeight);
    if (px < 1) {
      setError("Points are too close together.");
      return;
    }
    onCalibrate(px / realCm);
  }, [distance, unit, pointA, pointB, imageWidth, imageHeight, onCalibrate]);

  const handleReset = useCallback(() => {
    setPointA(null);
    setPointB(null);
    setDistance("");
    setError("");
  }, []);

  if (!active) return null;

  // ── Overlay dimensions (needed for line math in screen space) ──────────────
  // We use CSS percentages for point positions so the overlay can be any size.
  // The line width/angle computation needs screen-space dimensions.
  // We derive them lazily from a ref on first render; they're used only for the
  // decorative line, so rough values are fine.
  const overlayW = overlayRef.current?.offsetWidth ?? 600;
  const overlayH = overlayRef.current?.offsetHeight ?? 400;

  // Midpoint of the line (fractional)
  const mid: Point | null =
    pointA && pointB
      ? { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 }
      : null;

  const angle = pointA && pointB ? lineAngle(pointA, pointB, overlayW, overlayH) : 0;
  const len = pointA && pointB ? lineLength(pointA, pointB, overlayW, overlayH) : 0;

  // ── Step label ─────────────────────────────────────────────────────────────
  const stepLabel = !pointA
    ? "Click to set first point"
    : !pointB
      ? "Click to set second point"
      : null;

  return (
    <div
      ref={overlayRef}
      role="presentation"
      onClick={handleOverlayClick}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      style={{
        position: "absolute",
        inset: 0,
        cursor: pointA && pointB ? "default" : "crosshair",
        zIndex: 50,
        // Transparent — no background so the canvas is visible
      }}
    >
      {/* Step label (top-center) */}
      {stepLabel && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(124, 58, 237, 0.9)",
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: 20,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          {stepLabel}
        </div>
      )}

      {/* Point A */}
      {pointA && (
        <PointMarker point={pointA} label="A" />
      )}

      {/* Connecting line */}
      {pointA && pointB && (
        <div
          style={{
            position: "absolute",
            left: `${pointA.x * 100}%`,
            top: `${pointA.y * 100}%`,
            width: len,
            height: 2,
            background: "#7C3AED",
            transformOrigin: "0 50%",
            transform: `rotate(${angle}deg)`,
            pointerEvents: "none",
            opacity: 0.8,
          }}
        />
      )}

      {/* Point B */}
      {pointB && (
        <PointMarker point={pointB} label="B" />
      )}

      {/* Measurement card */}
      {pointA && pointB && mid && (
        <div
          role="presentation"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: `${mid.x * 100}%`,
            top: `${mid.y * 100}%`,
            transform: "translate(-50%, -120%)",
            background: "#ffffff",
            border: "1.5px solid #7C3AED",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(124,58,237,0.18), 0 1px 4px rgba(0,0,0,0.10)",
            padding: "12px 14px",
            minWidth: 200,
            zIndex: 60,
            cursor: "default",
          }}
        >
          {/* Header */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#7C3AED",
              letterSpacing: "0.04em",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            What is this distance?
          </div>

          {/* Input row */}
          <div style={{ display: "flex", gap: 6, alignItems: "stretch", marginBottom: 8 }}>
            <input
              ref={distanceInputRef}
              type="number"
              min="0.01"
              step="0.1"
              value={distance}
              onChange={(e) => { setDistance(e.target.value); setError(""); }}
              placeholder="e.g. 12"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApply();
                if (e.key === "Escape") onCancel();
              }}
              style={{
                flex: 1,
                padding: "6px 8px",
                border: error ? "1.5px solid #DC2626" : "1.5px solid #D1D5DB",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
                background: "#FAFAFA",
                minWidth: 0,
              }}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "cm" | "in")}
              style={{
                padding: "6px 8px",
                border: "1.5px solid #D1D5DB",
                borderRadius: 6,
                fontSize: 13,
                background: "#FAFAFA",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="cm">cm</option>
              <option value="in">in</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: "#DC2626", fontSize: 11, marginBottom: 6 }}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleApply}
              style={{
                flex: 1,
                padding: "7px 12px",
                borderRadius: 6,
                border: "none",
                background: "#7C3AED",
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #D1D5DB",
                background: "#F9FAFB",
                color: "#6B7280",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #D1D5DB",
                background: "#F9FAFB",
                color: "#6B7280",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Cancel hint when only point A is set */}
      {pointA && !pointB && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            padding: "5px 12px",
            borderRadius: 16,
            border: "1px solid #E5E7EB",
            background: "#ffffff",
            color: "#6B7280",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          Cancel (Esc)
        </button>
      )}

      {/* Cancel button when no point set yet */}
      {!pointA && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            padding: "5px 12px",
            borderRadius: 16,
            border: "1px solid #E5E7EB",
            background: "#ffffff",
            color: "#6B7280",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          Cancel (Esc)
        </button>
      )}
    </div>
  );
}

// ============================================================================
// PointMarker sub-component
// ============================================================================

function PointMarker({ point, label }: { point: Point; label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 55,
      }}
    >
      {/* Circle */}
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#7C3AED",
          border: "2px solid #ffffff",
          boxShadow: "0 0 0 1.5px #7C3AED, 0 2px 6px rgba(0,0,0,0.3)",
        }}
      />
      {/* Label */}
      <div
        style={{
          position: "absolute",
          top: -18,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 9,
          fontWeight: 700,
          color: "#7C3AED",
          background: "#ffffff",
          borderRadius: 3,
          padding: "1px 4px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}
