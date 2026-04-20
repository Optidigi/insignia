/**
 * OrderLinePreview — read-only Konva canvas showing product image + placement zones.
 * Client-only (Konva). Lazy-loaded by the parent.
 * Responsive: fills container width up to BASE_SIZE using ResizeObserver.
 */
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Text as KonvaText, Group } from "react-konva";
import type { PlacementGeometry } from "../lib/admin-types";

const BASE_SIZE = 400;

const ZONE_COLORS = [
  { fill: "rgba(37, 99, 235, 0.15)", stroke: "#2563EB" },
  { fill: "rgba(16, 185, 129, 0.15)", stroke: "#10B981" },
  { fill: "rgba(245, 158, 11, 0.15)", stroke: "#F59E0B" },
  { fill: "rgba(139, 92, 246, 0.15)", stroke: "#8B5CF6" },
  { fill: "rgba(239, 68, 68, 0.15)", stroke: "#EF4444" },
];

type Props = {
  imageUrl: string;
  placements: Array<{ id: string; name: string }>;
  geometry: Record<string, PlacementGeometry | null>;
  logoUrls: Record<string, string | null>;
};

export function OrderLinePreview({ imageUrl, placements, geometry, logoUrls }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState(BASE_SIZE);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [logoImages, setLogoImages] = useState<Record<string, HTMLImageElement>>({});

  // Responsive sizing via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setStageSize(Math.min(Math.round(width), BASE_SIZE));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load background product image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
    img.src = imageUrl;
  }, [imageUrl]);

  // Load logo images
  useEffect(() => {
    let cancelled = false;
    const loaded: Record<string, HTMLImageElement> = {};
    let pending = 0;

    for (const [placementId, url] of Object.entries(logoUrls)) {
      if (!url) continue;
      pending++;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        loaded[placementId] = img;
        pending--;
        if (pending === 0) setLogoImages({ ...loaded });
      };
      img.onerror = () => {
        if (cancelled) return;
        pending--;
        if (pending === 0) setLogoImages({ ...loaded });
      };
      img.src = url;
    }

    if (pending === 0) setLogoImages({});
    return () => { cancelled = true; };
  }, [logoUrls]);

  const scale = stageSize / BASE_SIZE;

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <Stage width={stageSize} height={stageSize}>
        <Layer>
          {bgImage && (
            <KonvaImage image={bgImage} x={0} y={0} width={stageSize} height={stageSize} />
          )}

          {placements.map((placement, i) => {
            const geo = geometry[placement.id];
            if (!geo) return null;

            const zoneW = (geo.maxWidthPercent / 100) * stageSize;
            const zoneH = geo.maxHeightPercent ? (geo.maxHeightPercent / 100) * stageSize : zoneW;
            const zoneX = (geo.centerXPercent / 100) * stageSize - zoneW / 2;
            const zoneY = (geo.centerYPercent / 100) * stageSize - zoneH / 2;
            const color = ZONE_COLORS[i % ZONE_COLORS.length];
            const logoImg = logoImages[placement.id];

            return (
              <Group key={placement.id} x={zoneX} y={zoneY}>
                <Rect
                  width={zoneW}
                  height={zoneH}
                  fill={color.fill}
                  stroke={color.stroke}
                  strokeWidth={1.5 * scale}
                />

                {logoImg ? (() => {
                  const imgScale = Math.min((zoneW - 8) / logoImg.width, (zoneH - 8) / logoImg.height);
                  const drawW = logoImg.width * imgScale;
                  const drawH = logoImg.height * imgScale;
                  const offsetX = (zoneW - drawW) / 2;
                  const offsetY = (zoneH - drawH) / 2;
                  return (
                    <KonvaImage
                      image={logoImg}
                      x={offsetX}
                      y={offsetY}
                      width={drawW}
                      height={drawH}
                    />
                  );
                })() : (
                  <KonvaText
                    text={placement.name}
                    x={0}
                    y={zoneH / 2 - 8 * scale}
                    width={zoneW}
                    align="center"
                    fontSize={Math.max(8 * scale, Math.min(14 * scale, zoneW / 6))}
                    fill={color.stroke}
                    fontStyle="bold"
                  />
                )}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
