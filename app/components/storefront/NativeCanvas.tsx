import { useRef, useEffect, useState, useCallback } from "react";

type Placement = {
  id: string;
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
};

type NativeCanvasProps = {
  imageUrl: string;
  logoUrl: string | null;
  placements: Placement[];
  highlightedPlacementId?: string | null;
  sizeMultiplier?: number;
  className?: string;
};

// Portrait canvas matching the design's 440×560 product card aspect ratio.
// Product images are typically portrait (T-shirts, hoodies, etc.) so this
// eliminates the letterboxing that made images appear small in a square canvas.
const CANVAS_W = 440;
const CANVAS_H = 560;

export default function NativeCanvas({
  imageUrl,
  logoUrl,
  placements,
  highlightedPlacementId,
  sizeMultiplier = 0.6,
  className,
}: NativeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const productImgRef = useRef<HTMLImageElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setLoaded(false);
    setError(false);
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      productImgRef.current = img;
      setLoaded(true);
      setError(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      setError(true);
      setLoaded(false);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
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

    const logoImg = logoImgRef.current;
    if (!logoImg) return;

    for (const placement of placements) {
      const cx = px + (placement.centerXPercent / 100) * pw;
      const cy = py + (placement.centerYPercent / 100) * ph;
      const maxW = (placement.maxWidthPercent / 100) * pw * sizeMultiplier;
      const aspect = logoImg.naturalHeight / logoImg.naturalWidth;
      const logoW = maxW;
      const logoH = maxW * aspect;

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
  }, [placements, highlightedPlacementId, sizeMultiplier]);

  useEffect(() => {
    if (!logoUrl) {
      logoImgRef.current = null;
      return;
    }
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      logoImgRef.current = img;
      // Trigger redraw
      if (loaded) draw();
    };
    img.src = logoUrl;
    return () => {
      cancelled = true;
      img.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoUrl]);

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, draw]);

  if (error) {
    return (
      <div
        className={className}
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
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
          width: CANVAS_W,
          height: CANVAS_H,
          background: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "12px",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "4px solid #e5e7eb",
            borderTopColor: "#2563eb",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className={className}
      style={{ maxWidth: "100%", height: "auto", borderRadius: "12px" }}
    />
  );
}
