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
};

const DEFAULT_ZONE_COLOR: ZoneColor = {
  border: "#7C3AED",
  fill: "rgba(124,58,237,0.12)",
};

const MAX_CANVAS_DIM = 700;

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
}: NativeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ w: 440, h: 560 });
  const productImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const perPlacementImgsRef = useRef<Record<string, HTMLImageElement>>({});
  const [perPlacementTick, setPerPlacementTick] = useState(0);

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

    const scale = Math.min(
      canvas.width / productImg.naturalWidth,
      canvas.height / productImg.naturalHeight,
    );
    const pw = productImg.naturalWidth * scale;
    const ph = productImg.naturalHeight * scale;
    const px = (canvas.width - pw) / 2;
    const py = (canvas.height - ph) / 2;

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
