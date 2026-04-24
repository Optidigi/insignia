/**
 * Native HTML Canvas 2D renderer for product mockups + scaled logo overlays.
 *
 * Uses plain Canvas API (NOT Konva — Konva is admin-only). Draws a product
 * image and one or more logo overlays positioned by percent-of-image
 * coordinates and scaled by per-placement scaleFactor.
 *
 * Tainted-canvas note: R2 presigned URLs serve no CORS headers, so drawing
 * the image marks the canvas tainted. We never call toDataURL/getImageData,
 * so display works fine. Don't try to "fix" this — see CLAUDE.md.
 *
 * The new modal wraps this in its own data-state container for loading /
 * failed UI; this component reports its load state via onLoadStateChange so
 * the parent can render whatever shell it wants. The legacy inline spinner
 * is kept as a fallback for callers that don't supply a parent shell.
 */

import { useRef, useEffect, useState, useCallback } from "react";

export type CanvasPlacement = {
  id: string;
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  maxHeightPercent?: number | null;
  scaleFactor?: number;
};

export type ZoomGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  maxHeightPercent?: number | null;
};

export type ZoomTarget = {
  /**
   * Geometry of the placement to zoom toward, resolved by the caller against
   * the CURRENTLY VISIBLE view. Null = un-zoomed. We take geometry (not a
   * placement id) because hover-to-preview targets placements that may not
   * yet be selected, and `placements` is filtered to selected only.
   */
  geometry: ZoomGeometry | null;
  /** Fraction of the canvas shorter edge the placement should occupy. Default 0.20. */
  fraction?: number;
};

export type ImageMeta = {
  naturalWidthPx: number;
  naturalHeightPx: number;
  aspect: number;
};

export type ZoneColor = {
  border: string;
  fill: string;
};

type NativeCanvasProps = {
  imageUrl: string;
  /**
   * Fallback logo rendered at every placement when `logoUrlByPlacementId`
   * doesn't provide a per-placement override. The storefront modal uses
   * this (one customer logo across all zones); admin order detail uses
   * `logoUrlByPlacementId` instead.
   */
  logoUrl: string | null;
  placements: CanvasPlacement[];
  /**
   * Per-placement logo URLs for the admin order detail (each placement
   * may have a different customer-uploaded artwork). When present, this
   * takes precedence over `logoUrl` for matching placements. Missing or
   * null entries fall back to `logoUrl`.
   */
  logoUrlByPlacementId?: Record<string, string | null>;
  highlightedPlacementId?: string | null;
  /**
   * Draws coloured zone rectangles behind each placement (admin use case).
   * Zone colours are looked up by placement id in `zoneColors`. Default: off.
   */
  showZoneOverlays?: boolean;
  zoneColors?: Record<string, ZoneColor>;
  /** @deprecated Use per-placement scaleFactor instead. */
  sizeMultiplier?: number;
  className?: string;
  /**
   * When true, parent renders its own loading/error UI. The canvas just
   * stays empty until ready, and reports state changes via onLoadStateChange.
   */
  headless?: boolean;
  onLoadStateChange?: (state: "loading" | "ready" | "error") => void;
  /**
   * Reports the loaded image's natural pixel dimensions + aspect ratio
   * (width/height). Fired once per `imageUrl` after the image loads.
   * Consumers use this for wide-aspect frame detection (B6) and for
   * calibration cm computation (C6).
   */
  onImageMeta?: (meta: ImageMeta) => void;
  /**
   * Reports the loaded LOGO's intrinsic pixel dimensions + aspect.
   * Fired once per `logoUrl` after the logo image loads. Consumers use
   * this to compute the actual rendered logo size in cm (the logo is
   * letterboxed inside the placement zone — only one of width/height
   * matches the zone, the other is determined by the logo's aspect ratio).
   * Only fired for the fallback `logoUrl`, not for per-placement overrides.
   */
  onLogoMeta?: (meta: ImageMeta | null) => void;
  /**
   * When set with a non-null `placementId`, the canvas animates a "zoom"
   * transform that scales the product image (and all logo overlays that
   * derive from it) so the target placement occupies ~`fraction` of the
   * canvas shorter edge. When `placementId` is null or the prop is
   * omitted, the render is identical to the un-zoomed default.
   */
  zoomTarget?: ZoomTarget;
};

const DEFAULT_ZONE_COLOR: ZoneColor = {
  border: "#7C3AED",
  fill: "rgba(124,58,237,0.12)",
};

const MAX_CANVAS_DIM = 700;

// ── Zoom-to-placement tween parameters ──────────────────────────────────────
// Keep these aligned with the CSS tokens defined in storefront-modal.css
// (--insignia-dur-med, --insignia-ease-out). See §9 of the zoom plan.
// Target: the larger of (placement.width, placement.height) should occupy
// this fraction of the canvas shorter edge after zooming. 0.40 means "zone
// appears ~2× its natural size when the zone's maxWidthPercent is ~20%",
// which matches the visual intent of "make the zone clearly visible on
// mobile" for typical chest/sleeve zones. Smaller placements zoom more
// (capped at ZOOM_MAX); larger placements stay at 1× (no zoom-out).
const ZOOM_DEFAULT_FRACTION = 0.4;
const ZOOM_MAX = 8;
const ZOOM_DURATION_MS = 200;
// cubic-bezier(0.2, 0.8, 0.2, 1) — matches --insignia-ease-out.
function zoomEase(t: number): number {
  // Closed-form evaluation of the y-coordinate of the bezier curve at the
  // given x is expensive; the visual difference against this monotone
  // approximation for a (.2,.8,.2,1) curve is imperceptible at 200ms. Keep
  // it inline to avoid pulling in a dependency.
  // Approximation: easeOutCubic, which follows the same "fast-start,
  // decelerate" shape the bezier specifies.
  const c = 1 - t;
  return 1 - c * c * c;
}

type ZoomValues = { scale: number; px: number; py: number };

type ZoomAnimState = {
  from: ZoomValues;
  to: ZoomValues;
  startTs: number;
  duration: number;
};

function computeZoomValues(
  canvasW: number,
  canvasH: number,
  px0: number,
  py0: number,
  pw: number,
  ph: number,
  target: ZoomGeometry | null,
  fraction: number,
): ZoomValues {
  if (!target) {
    return { scale: 1, px: px0, py: py0 };
  }
  const mw = target.maxWidthPercent;
  const mh = target.maxHeightPercent ?? target.maxWidthPercent;
  const placementPx = Math.max((mw / 100) * pw, (mh / 100) * ph);
  if (!(placementPx > 0)) {
    return { scale: 1, px: px0, py: py0 };
  }
  const targetPx = fraction * Math.min(canvasW, canvasH);
  let scale = targetPx / placementPx;
  if (!(scale > 1)) {
    // When the placement is already larger than our target fraction, don't
    // zoom out — keep the un-zoomed render.
    return { scale: 1, px: px0, py: py0 };
  }
  if (scale > ZOOM_MAX) scale = ZOOM_MAX;

  const pwZoomed = pw * scale;
  const phZoomed = ph * scale;
  // Place the placement center at the canvas center (expressed in canvas
  // px space — px0/py0 are already the un-zoomed product origin).
  let pxZoomed = canvasW / 2 - (target.centerXPercent / 100) * pwZoomed;
  let pyZoomed = canvasH / 2 - (target.centerYPercent / 100) * phZoomed;

  // Per-axis clamp (MF-2): pin product edges to canvas edges when the zoomed
  // product covers the canvas on that axis. Otherwise center on that axis.
  if (pwZoomed > canvasW) {
    const lo = canvasW - pwZoomed; // negative
    const hi = 0;
    if (pxZoomed < lo) pxZoomed = lo;
    else if (pxZoomed > hi) pxZoomed = hi;
  } else {
    pxZoomed = (canvasW - pwZoomed) / 2;
  }
  if (phZoomed > canvasH) {
    const lo = canvasH - phZoomed;
    const hi = 0;
    if (pyZoomed < lo) pyZoomed = lo;
    else if (pyZoomed > hi) pyZoomed = hi;
  } else {
    pyZoomed = (canvasH - phZoomed) / 2;
  }

  return { scale, px: pxZoomed, py: pyZoomed };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateZoom(from: ZoomValues, to: ZoomValues, t: number): ZoomValues {
  return {
    scale: lerp(from.scale, to.scale, t),
    px: lerp(from.px, to.px, t),
    py: lerp(from.py, to.py, t),
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function NativeCanvas({
  imageUrl,
  logoUrl,
  placements,
  logoUrlByPlacementId,
  highlightedPlacementId,
  showZoneOverlays = false,
  zoneColors,
  sizeMultiplier = 0.6,
  className,
  headless = false,
  onLoadStateChange,
  onImageMeta,
  onLogoMeta,
  zoomTarget,
}: NativeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ w: 440, h: 560 });
  const productImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const perPlacementImgsRef = useRef<Record<string, HTMLImageElement>>({});
  const [perPlacementTick, setPerPlacementTick] = useState(0);

  // Current zoom values applied to the draw pipeline. `animStateRef` holds
  // an in-flight tween; when null, the `currentZoomRef` value is static.
  const currentZoomRef = useRef<ZoomValues | null>(null);
  const animStateRef = useRef<ZoomAnimState | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    setLoaded(false);
    setError(false);
    onLoadStateChange?.("loading");
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      productImgRef.current = img;
      const aspect = img.naturalWidth / img.naturalHeight;
      let w: number, h: number;
      if (aspect >= 1) {
        w = MAX_CANVAS_DIM;
        h = Math.round(MAX_CANVAS_DIM / aspect);
      } else {
        h = MAX_CANVAS_DIM;
        w = Math.round(MAX_CANVAS_DIM * aspect);
      }
      setCanvasDims({ w, h });
      setLoaded(true);
      setError(false);
      onLoadStateChange?.("ready");
      onImageMeta?.({
        naturalWidthPx: img.naturalWidth,
        naturalHeightPx: img.naturalHeight,
        aspect,
      });
    };
    img.onerror = () => {
      if (cancelled) return;
      setError(true);
      setLoaded(false);
      onLoadStateChange?.("error");
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const productImg = productImgRef.current;
    if (!canvas || !productImg) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const baseScale = Math.min(
      canvas.width / productImg.naturalWidth,
      canvas.height / productImg.naturalHeight,
    );
    const pwBase = productImg.naturalWidth * baseScale;
    const phBase = productImg.naturalHeight * baseScale;

    // Apply the current zoom (if any) on top of the base fit. When
    // `currentZoomRef` is null we render the un-zoomed, centered image —
    // byte-identical to the behaviour before the zoom feature shipped.
    const zoom = currentZoomRef.current;
    const zoomScale = zoom ? zoom.scale : 1;
    const pw = pwBase * zoomScale;
    const ph = phBase * zoomScale;
    const px = zoom ? zoom.px : (canvas.width - pwBase) / 2;
    const py = zoom ? zoom.py : (canvas.height - phBase) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(productImg, px, py, pw, ph);

    // Pass 1 — zone overlays (coloured rects behind logos). Admin uses this
    // to show the merchant where each placement zone lives regardless of
    // whether artwork has been uploaded. Drawn at the zone's FULL width
    // (maxWidthPercent without scaleFactor applied) so the zone outline
    // matches the geometry as authored in product config.
    if (showZoneOverlays) {
      for (const placement of placements) {
        const colour = zoneColors?.[placement.id] ?? DEFAULT_ZONE_COLOR;
        const cx = px + (placement.centerXPercent / 100) * pw;
        const cy = py + (placement.centerYPercent / 100) * ph;
        const zoneW = (placement.maxWidthPercent / 100) * pw;
        // Square-ish by default; real zone aspect comes from product config.
        const zoneH = zoneW;
        const rx = cx - zoneW / 2;
        const ry = cy - zoneH / 2;
        ctx.fillStyle = colour.fill;
        ctx.fillRect(rx, ry, zoneW, zoneH);
        ctx.strokeStyle = colour.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, zoneW, zoneH);
      }
    }

    // Pass 2 — logos per placement. Per-placement override takes precedence
    // over the shared fallback `logoUrl`. If neither resolves, the zone
    // overlay (if enabled) carries the visual meaning on its own.
    const fallbackLogo = logoImgRef.current;
    for (const placement of placements) {
      const perPlacementLogo = perPlacementImgsRef.current[placement.id] ?? null;
      const logoImg = perPlacementLogo ?? fallbackLogo;
      if (!logoImg) continue;
      if (!logoImg.naturalWidth || !logoImg.naturalHeight) continue;

      const cx = px + (placement.centerXPercent / 100) * pw;
      const cy = py + (placement.centerYPercent / 100) * ph;
      const effectiveScale = placement.scaleFactor ?? sizeMultiplier;
      const maxW = (placement.maxWidthPercent / 100) * pw * effectiveScale;
      const heightPct = placement.maxHeightPercent ?? placement.maxWidthPercent;
      const maxH = (heightPct / 100) * ph * effectiveScale;
      const fit = Math.min(maxW / logoImg.naturalWidth, maxH / logoImg.naturalHeight);
      const logoW = logoImg.naturalWidth * fit;
      const logoH = logoImg.naturalHeight * fit;

      const isHighlighted = placement.id === highlightedPlacementId;

      if (isHighlighted) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          cx - logoW / 2 - 2,
          cy - logoH / 2 - 2,
          logoW + 4,
          logoH + 4,
        );
      } else {
        ctx.globalAlpha = 0.85;
      }

      ctx.drawImage(logoImg, cx - logoW / 2, cy - logoH / 2, logoW, logoH);
      ctx.globalAlpha = 1;
    }
    // perPlacementTick is read implicitly via perPlacementImgsRef; listed
    // in deps to re-draw when new per-placement images finish loading.
    void perPlacementTick;
  }, [placements, highlightedPlacementId, sizeMultiplier, showZoneOverlays, zoneColors, perPlacementTick]);

  useEffect(() => {
    if (!logoUrl) {
      logoImgRef.current = null;
      onLogoMeta?.(null);
      if (loaded) draw();
      return;
    }
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      logoImgRef.current = img;
      onLogoMeta?.({
        naturalWidthPx: img.naturalWidth,
        naturalHeightPx: img.naturalHeight,
        aspect: img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1,
      });
      if (loaded) draw();
    };
    img.src = logoUrl;
    return () => {
      cancelled = true;
      img.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoUrl]);

  // Per-placement logo loading. Each URL loads independently; a failed
  // fetch (e.g. 403 from an expired presigned URL) leaves that placement
  // empty without blocking sibling placements. When the map changes, we
  // replace the ref entirely so stale entries don't leak.
  useEffect(() => {
    if (!logoUrlByPlacementId) {
      perPlacementImgsRef.current = {};
      setPerPlacementTick((t) => t + 1);
      return;
    }
    const nextImgs: Record<string, HTMLImageElement> = {};
    let cancelled = false;
    const loaders: Array<HTMLImageElement> = [];
    for (const [placementId, url] of Object.entries(logoUrlByPlacementId)) {
      if (!url) continue;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        nextImgs[placementId] = img;
        perPlacementImgsRef.current = { ...nextImgs };
        setPerPlacementTick((t) => t + 1);
      };
      img.onerror = () => {
        // Silent per-placement failure — draw falls back to zone overlay
        // (if enabled) or the shared logoUrl. Do NOT set top-level error.
      };
      img.src = url;
      loaders.push(img);
    }
    return () => {
      cancelled = true;
      for (const img of loaders) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [logoUrlByPlacementId]);

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, draw]);

  // ── Zoom-to-placement tween ──────────────────────────────────────────────
  // Resolves the target zoom values whenever the zoomTarget, placement set,
  // canvas dimensions, or product image changes. Animates between the
  // previous and next values with requestAnimationFrame. First paint (no
  // prior animState) snaps directly. Reduced-motion also snaps.
  const targetGeometry = zoomTarget?.geometry ?? null;
  const targetFraction = zoomTarget?.fraction ?? ZOOM_DEFAULT_FRACTION;

  useEffect(() => {
    // If the image hasn't loaded yet, we can't resolve px/py/pw/ph.
    // Leave currentZoomRef untouched; the effect will re-run once
    // `loaded` flips to true because `loaded` is in the dep array.
    // Callers are expected to useMemo targetGeometry upstream (PreviewCanvas
    // does) so its identity is stable across parent renders.
    const productImg = productImgRef.current;
    if (!loaded || !productImg) return;

    const canvasW = canvasDims.w;
    const canvasH = canvasDims.h;
    const baseScale = Math.min(
      canvasW / productImg.naturalWidth,
      canvasH / productImg.naturalHeight,
    );
    const pwBase = productImg.naturalWidth * baseScale;
    const phBase = productImg.naturalHeight * baseScale;
    const px0 = (canvasW - pwBase) / 2;
    const py0 = (canvasH - phBase) / 2;

    const toValues = computeZoomValues(
      canvasW,
      canvasH,
      px0,
      py0,
      pwBase,
      phBase,
      targetGeometry,
      targetFraction,
    );

    const snap = () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      animStateRef.current = null;
      currentZoomRef.current = toValues;
      draw();
    };

    // First-paint snap (MF-5): no prior tween → set values directly.
    if (animStateRef.current == null && currentZoomRef.current == null) {
      snap();
      return;
    }
    // Honour reduced motion.
    if (prefersReducedMotion()) {
      snap();
      return;
    }

    const fromValues = currentZoomRef.current ?? toValues;
    // If nothing has actually changed, skip the tween.
    if (
      fromValues.scale === toValues.scale &&
      fromValues.px === toValues.px &&
      fromValues.py === toValues.py
    ) {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      animStateRef.current = null;
      currentZoomRef.current = toValues;
      return;
    }

    // Cancel any in-flight rAF before starting a new tween.
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const startTs =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    animStateRef.current = {
      from: fromValues,
      to: toValues,
      startTs,
      duration: ZOOM_DURATION_MS,
    };

    const tick = (now: number) => {
      const state = animStateRef.current;
      if (!state) {
        rafIdRef.current = null;
        return;
      }
      const delta = now - state.startTs;
      // Background-tab guard: if the tab was suspended for much longer than
      // the tween duration, snap to the end and stop.
      if (delta > state.duration * 2) {
        currentZoomRef.current = state.to;
        animStateRef.current = null;
        rafIdRef.current = null;
        draw();
        return;
      }
      const t = Math.max(0, Math.min(1, delta / state.duration));
      const eased = zoomEase(t);
      currentZoomRef.current = interpolateZoom(state.from, state.to, eased);
      draw();
      if (t >= 1) {
        currentZoomRef.current = state.to;
        animStateRef.current = null;
        rafIdRef.current = null;
        return;
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [
    loaded,
    canvasDims.w,
    canvasDims.h,
    targetGeometry,
    targetFraction,
    draw,
  ]);

  // Final cleanup on unmount — defensive in case a tween outlives the
  // component (e.g. rapid step transitions).
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  if (headless) {
    if (!loaded || error) return null;
    return (
      <canvas
        ref={canvasRef}
        width={canvasDims.w}
        height={canvasDims.h}
        className={className}
        style={{ maxWidth: "100%", height: "auto", display: "block" }}
      />
    );
  }

  if (error) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          maxWidth: canvasDims.w,
          aspectRatio: `${canvasDims.w} / ${canvasDims.h}`,
          background: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "12px",
          color: "#6b7280",
          fontSize: "14px",
        }}
      >
        Image could not be loaded
      </div>
    );
  }

  if (!loaded) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          maxWidth: canvasDims.w,
          aspectRatio: `${canvasDims.w} / ${canvasDims.h}`,
          background: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "12px",
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={canvasDims.w}
      height={canvasDims.h}
      className={className}
      style={{ maxWidth: "100%", height: "auto", display: "block" }}
    />
  );
}
