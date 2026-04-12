/**
 * OrderLinePreview — read-only Konva canvas showing product image + placement zones.
 * Client-only (Konva). Lazy-loaded by the parent.
 */
import { useEffect, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Text as KonvaText, Group } from "react-konva";
import type { PlacementGeometry } from "../lib/admin-types";

const STAGE_SIZE = 400;

const ZONE_COLORS = [
  { fill: "rgba(37, 99, 235, 0.15)", stroke: "#2563EB" },
  { fill: "rgba(16, 185, 129, 0.15)", stroke: "#10B981" },
  { fill: "rgba(245, 158, 11, 0.15)", stroke: "#F59E0B" },
  { fill: "rgba(139, 92, 246, 0.15)", stroke: "#8B5CF6" },
  { fill: "rgba(239, 68, 68, 0.15)", stroke: "#EF4444" },
];

type Props = {
  imageUrl: string; // presigned product image URL
  placements: Array<{ id: string; name: string }>; // ordered list
  geometry: Record<string, PlacementGeometry | null>; // keyed by placementId
  logoUrls: Record<string, string | null>; // keyed by placementId, presigned logo URLs or null
};

export function OrderLinePreview({ imageUrl, placements, geometry, logoUrls }: Props) {
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [logoImages, setLogoImages] = useState<Record<string, HTMLImageElement>>({});

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

  return (
    <Stage width={STAGE_SIZE} height={STAGE_SIZE}>
      <Layer>
        {/* Background product image */}
        {bgImage && (
          <KonvaImage
            image={bgImage}
            x={0}
            y={0}
            width={STAGE_SIZE}
            height={STAGE_SIZE}
          />
        )}

        {/* Placement zones */}
        {placements.map((placement, i) => {
          const geo = geometry[placement.id];
          if (!geo) return null;

          const zoneW = (geo.maxWidthPercent / 100) * STAGE_SIZE;
          const zoneH = zoneW; // square zone
          const zoneX = (geo.centerXPercent / 100) * STAGE_SIZE - zoneW / 2;
          const zoneY = (geo.centerYPercent / 100) * STAGE_SIZE - zoneH / 2;
          const color = ZONE_COLORS[i % ZONE_COLORS.length];
          const logoImg = logoImages[placement.id];

          return (
            <Group key={placement.id} x={zoneX} y={zoneY}>
              {/* Zone rectangle */}
              <Rect
                width={zoneW}
                height={zoneH}
                fill={color.fill}
                stroke={color.stroke}
                strokeWidth={1.5}
              />

              {/* Logo image or placeholder text */}
              {logoImg ? (() => {
                const scale = Math.min((zoneW - 8) / logoImg.width, (zoneH - 8) / logoImg.height);
                const drawW = logoImg.width * scale;
                const drawH = logoImg.height * scale;
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
                  y={zoneH / 2 - 8}
                  width={zoneW}
                  align="center"
                  fontSize={Math.max(10, Math.min(14, zoneW / 6))}
                  fill={color.stroke}
                  fontStyle="bold"
                />
              )}
            </Group>
          );
        })}
      </Layer>
    </Stage>
  );
}
