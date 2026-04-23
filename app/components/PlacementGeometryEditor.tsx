/**
 * Placement Geometry Editor (Konva)
 *
 * Client-only: draw placement zones on the view image and save percent-based geometry.
 * Canonical: docs/core/placement-editor.md
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image, Rect, Transformer, Line } from "react-konva";
import type Konva from "konva";
import { Button, InlineStack } from "@shopify/polaris";
import type { PlacementGeometry, PlacementDefinition } from "../lib/admin-types";
import { getZoneColor } from "../lib/zone-colors";

export type { PlacementGeometry, PlacementDefinition };

const MAX_CANVAS = 560;
const SNAP_GRID_PERCENT = 1;
const NUDGE_PERCENT = 0.5; // 0.5% nudge per arrow key press

type RectState = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  imageUrl: string;
  placements: PlacementDefinition[];
  initialGeometry: Record<string, PlacementGeometry | null>;
  onSave: (geometry: Record<string, PlacementGeometry>) => void;
  onCancel: () => void;
  /** Called whenever a zone is moved or resized (before saving), with the current computed geometry. */
  onChange?: (geometry: Record<string, PlacementGeometry>) => void;
  /**
   * When true, renders the canvas only — no instruction box, no Save/Cancel/Undo/Redo
   * button row. The host page is responsible for save/discard via App Bridge SaveBar.
   * Keyboard shortcuts (Ctrl+Z/Y, arrow keys) still work.
   */
  inline?: boolean;
  /** Externally-driven selection — when the parent sets this, the canvas syncs its internal selection. */
  selectedPlacementId?: string | null;
  /** Called when a zone is clicked (or deselected by clicking empty canvas). */
  onSelectPlacement?: (id: string | null) => void;
};

function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Unique grid positions in [0, maxSize], integer-only.
 * One position per step so no double lines; used to draw one Line per grid line.
 */
function getGridPositions(maxSize: number, step: number): number[] {
  const max = Math.floor(maxSize);
  if (max <= 0 || step <= 0) return [];
  const seen = new Set<number>();
  for (let i = 0; i * step <= max + 0.5; i++) {
    const pos = Math.round(i * step);
    if (pos >= 0 && pos <= max) seen.add(pos);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

export function PlacementGeometryEditor({
  imageUrl,
  placements,
  initialGeometry,
  onSave,
  onCancel,
  onChange,
  inline = false,
  selectedPlacementId: externalSelectedId,
  onSelectPlacement,
}: Props) {
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: MAX_CANVAS, height: MAX_CANVAS });
  const [rects, setRects] = useState<Record<string, RectState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // Undo/redo history using refs (avoids stale-closure issues in event handlers)
  const historyRef = useRef<Record<string, RectState>[]>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const imageRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rectRefs = useRef<Record<string, Konva.Rect | null>>({});
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setImageError(null);
    setImageLoaded(false);
    setImageSize(null);
    const img = new window.Image();
    // Do not set crossOrigin: R2 signed URLs often lack CORS headers, which would
    // block the load. Without it the image loads and displays; canvas is tainted
    // but we only draw, we don't export pixel data.
    img.src = imageUrl;
    imgRef.current = img;
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImageSize({ width: w, height: h });
      const scale = Math.min(MAX_CANVAS / w, MAX_CANVAS / h, 1);
      setStageSize({ width: w * scale, height: h * scale });
      setImageLoaded(true);
    };
    img.onerror = () => {
      setImageError("Image could not be loaded. It may have expired — try uploading the image again.");
    };
    return () => {
      img.onload = null;
      img.onerror = null;
      img.src = "";
      imgRef.current = null;
    };
  }, [imageUrl]);

  const stageWidth = stageSize.width;
  const stageHeight = stageSize.height;
  const snapX = (stageWidth * SNAP_GRID_PERCENT) / 100;
  const snapY = (stageHeight * SNAP_GRID_PERCENT) / 100;

  // Track the latest initialGeometry in a ref so the initialization effect can read it
  // without listing it as a dep. This prevents spurious re-initialization on every
  // React Router revalidation (which produces a new object reference even when the
  // geometry values haven't changed).
  const initialGeometryRef = useRef(initialGeometry);
  useEffect(() => {
    initialGeometryRef.current = initialGeometry;
  }, [initialGeometry]);

  useEffect(() => {
    if (!imageLoaded || !stageWidth || !stageHeight || placements.length === 0) return;

    setRects((prev) => {
      const placementIds = new Set(placements.map((p) => p.id));
      const next: Record<string, RectState> = {};

      // Keep existing rects for placements that still exist (preserves user-positioned rects
      // across revalidations so the Konva Transformer stays properly attached).
      for (const id of Object.keys(prev)) {
        if (placementIds.has(id)) {
          next[id] = prev[id];
        }
      }

      // Detect deleted placements (present in prev but not in the new placement list)
      let changed = Object.keys(prev).some((id) => !placementIds.has(id));

      // Initialize rects only for placements that are NEW (not yet in rects)
      for (const p of placements) {
        if (next[p.id]) continue; // already have a rect — don't reset it
        const geom = initialGeometryRef.current[p.id];
        if (geom && typeof geom === "object" && "centerXPercent" in geom) {
          const cw = (geom.centerXPercent / 100) * stageWidth;
          const ch = (geom.centerYPercent / 100) * stageHeight;
          const w = (geom.maxWidthPercent / 100) * stageWidth;
          // Use stored height if available; fall back to width (legacy square zones)
          const h = ((geom.maxHeightPercent ?? geom.maxWidthPercent) / 100) * stageHeight;
          next[p.id] = {
            x: Math.max(0, cw - w / 2),
            y: Math.max(0, ch - h / 2),
            width: Math.min(w, stageWidth),
            height: Math.min(h, stageHeight),
          };
        } else {
          const defaultW = stageWidth * 0.2;
          next[p.id] = {
            x: (stageWidth - defaultW) / 2,
            y: (stageHeight - defaultW) / 2,
            width: defaultW,
            height: defaultW,
          };
        }
        changed = true;
      }

      // If nothing actually changed, return the same reference so React bails out the
      // state update — no re-render, no Transformer disruption.
      return changed ? next : prev;
    });
    // initialGeometry is intentionally read via initialGeometryRef rather than listed
    // as a dep here — including it would re-run this effect on every revalidation even
    // when geometry values are identical (React Router returns a new object reference
    // after each loader run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLoaded, stageWidth, stageHeight, placements]);

  useEffect(() => {
    if (!transformerRef.current) return;
    if (selectedId && rectRefs.current[selectedId]) {
      transformerRef.current.nodes([rectRefs.current[selectedId]!]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedId]);

  // Sync external selection into internal Konva selection
  useEffect(() => {
    if (externalSelectedId !== undefined) {
      setSelectedId(externalSelectedId ?? null);
    }
  }, [externalSelectedId]);

  // Push a new snapshot onto the history stack (discards any redo states ahead of current index)
  const pushHistory = useCallback((nextRects: Record<string, RectState>) => {
    const base = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current = [...base, nextRects].slice(-50);
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  const handleDragStart = useCallback(() => setShowGrid(true), []);
  const handleDragEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      setShowGrid(false);
      const shape = e.target;
      let x = shape.x();
      let y = shape.y();
      const w = rects[id]?.width ?? 0;
      const h = rects[id]?.height ?? 0;
      x = Math.max(0, Math.min(stageWidth - w, snapToGrid(x, snapX)));
      y = Math.max(0, Math.min(stageHeight - h, snapToGrid(y, snapY)));
      const nextRects: Record<string, RectState> = { ...rects, [id]: { ...rects[id], x, y } };
      setRects(nextRects);
      pushHistory(nextRects);
      shape.position({ x, y });
      if (onChange) {
        const geometry: Record<string, PlacementGeometry> = {};
        for (const [rid, r] of Object.entries(nextRects)) {
          if (!r || r.width <= 0 || r.height <= 0) continue;
          geometry[rid] = {
            centerXPercent: Math.max(0, Math.min(100, ((r.x + r.width / 2) / stageWidth) * 100)),
            centerYPercent: Math.max(0, Math.min(100, ((r.y + r.height / 2) / stageHeight) * 100)),
            maxWidthPercent: Math.max(0, Math.min(100, (r.width / stageWidth) * 100)),
            maxHeightPercent: Math.max(0, Math.min(100, (r.height / stageHeight) * 100)),
          };
        }
        onChange(geometry);
      }
    },
    [stageWidth, stageHeight, rects, snapX, snapY, onChange, pushHistory]
  );

  const handleTransformStart = useCallback(() => setShowGrid(true), []);
  const handleTransformEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<Event>) => {
      setShowGrid(false);
      const shape = e.target;
      const scaleX = shape.scaleX();
      const scaleY = shape.scaleY();
      shape.scaleX(1);
      shape.scaleY(1);
      let w = Math.max(snapX, Math.min(stageWidth, shape.width() * scaleX));
      let h = Math.max(snapY, Math.min(stageHeight, shape.height() * scaleY));
      w = snapToGrid(w, snapX);
      h = snapToGrid(h, snapY);
      const x = Math.max(0, Math.min(stageWidth - w, snapToGrid(shape.x(), snapX)));
      const y = Math.max(0, Math.min(stageHeight - h, snapToGrid(shape.y(), snapY)));
      const nextRects: Record<string, RectState> = { ...rects, [id]: { x, y, width: w, height: h } };
      setRects(nextRects);
      pushHistory(nextRects);
      shape.width(w);
      shape.height(h);
      shape.position({ x, y });
      if (onChange) {
        const geometry: Record<string, PlacementGeometry> = {};
        for (const [rid, r] of Object.entries(nextRects)) {
          if (!r || r.width <= 0 || r.height <= 0) continue;
          geometry[rid] = {
            centerXPercent: Math.max(0, Math.min(100, ((r.x + r.width / 2) / stageWidth) * 100)),
            centerYPercent: Math.max(0, Math.min(100, ((r.y + r.height / 2) / stageHeight) * 100)),
            maxWidthPercent: Math.max(0, Math.min(100, (r.width / stageWidth) * 100)),
            maxHeightPercent: Math.max(0, Math.min(100, (r.height / stageHeight) * 100)),
          };
        }
        onChange(geometry);
      }
    },
    [stageWidth, stageHeight, snapX, snapY, rects, onChange, pushHistory]
  );

  const handleSave = useCallback(() => {
    const geometry: Record<string, PlacementGeometry> = {};
    for (const [id, r] of Object.entries(rects)) {
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const centerXPercent = ((r.x + r.width / 2) / stageWidth) * 100;
      const centerYPercent = ((r.y + r.height / 2) / stageHeight) * 100;
      const maxWidthPercent = (r.width / stageWidth) * 100;
      const maxHeightPercent = (r.height / stageHeight) * 100;
      geometry[id] = {
        centerXPercent: Math.max(0, Math.min(100, centerXPercent)),
        centerYPercent: Math.max(0, Math.min(100, centerYPercent)),
        maxWidthPercent: Math.max(0, Math.min(100, maxWidthPercent)),
        maxHeightPercent: Math.max(0, Math.min(100, maxHeightPercent)),
      };
    }
    onSave(geometry);
  }, [rects, stageWidth, stageHeight, onSave]);

  /**
   * Clamp stage position so the scaled image always covers the entire canvas viewport.
   * Image edges must be at or beyond canvas edges — no whitespace gaps.
   */
  const clampStagePosition = useCallback(
    (stage: Konva.Stage, scale: number) => {
      const scaledW = stageWidth * scale;
      const scaledH = stageHeight * scale;
      let x = stage.x();
      let y = stage.y();
      // Right edge of image must reach or extend past canvas right edge
      // Left edge of image must be at or before canvas left edge
      x = Math.min(0, Math.max(stageWidth - scaledW, x));
      y = Math.min(0, Math.max(stageHeight - scaledH, y));
      stage.position({ x, y });
    },
    [stageWidth, stageHeight],
  );

  // Mouse-wheel zoom: zoom toward pointer, clamped so image always fills canvas
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const newScale = e.evt.deltaY > 0 ? oldScale * 0.9 : oldScale * 1.1;
      // Minimum scale = 1 (image fits canvas exactly at scale 1; below 1 creates whitespace)
      const clampedScale = Math.max(1, Math.min(3, newScale));
      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };
      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
      clampStagePosition(stage, clampedScale);
    },
    [clampStagePosition],
  );

  const handleResetZoom = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
  }, []);

  // Keyboard: arrow-key nudge for the selected zone + Ctrl+Z/Y undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const next = historyIndexRef.current - 1;
        if (next >= 0 && historyRef.current[next]) {
          historyIndexRef.current = next;
          setRects(historyRef.current[next]);
          setCanUndo(next > 0);
          setCanRedo(true);
        }
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        const next = historyIndexRef.current + 1;
        if (next < historyRef.current.length && historyRef.current[next]) {
          historyIndexRef.current = next;
          setRects(historyRef.current[next]);
          setCanUndo(true);
          setCanRedo(next < historyRef.current.length - 1);
        }
        return;
      }

      if (!selectedId) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const dxPx = e.key === "ArrowLeft" ? -(stageWidth * NUDGE_PERCENT) / 100
                 : e.key === "ArrowRight" ? (stageWidth * NUDGE_PERCENT) / 100
                 : 0;
      const dyPx = e.key === "ArrowUp" ? -(stageHeight * NUDGE_PERCENT) / 100
                 : e.key === "ArrowDown" ? (stageHeight * NUDGE_PERCENT) / 100
                 : 0;
      setRects((prev) => {
        const r = prev[selectedId];
        if (!r) return prev;
        const w = r.width;
        const h = r.height;
        const x = Math.max(0, Math.min(stageWidth - w, r.x + dxPx));
        const y = Math.max(0, Math.min(stageHeight - h, r.y + dyPx));
        const nextRects = { ...prev, [selectedId]: { ...r, x, y } };
        // Push to history after nudge (using refs directly)
        const base = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current = [...base, nextRects].slice(-50);
        historyIndexRef.current = historyRef.current.length - 1;
        setCanUndo(historyIndexRef.current > 0);
        setCanRedo(false);
        if (onChange) {
          const geometry: Record<string, PlacementGeometry> = {};
          for (const [rid, nr] of Object.entries(nextRects)) {
            if (!nr || nr.width <= 0 || nr.height <= 0) continue;
            geometry[rid] = {
              centerXPercent: Math.max(0, Math.min(100, ((nr.x + nr.width / 2) / stageWidth) * 100)),
              centerYPercent: Math.max(0, Math.min(100, ((nr.y + nr.height / 2) / stageHeight) * 100)),
              maxWidthPercent: Math.max(0, Math.min(100, (nr.width / stageWidth) * 100)),
              maxHeightPercent: Math.max(0, Math.min(100, (nr.height / stageHeight) * 100)),
            };
          }
          onChange(geometry);
        }
        return nextRects;
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, stageWidth, stageHeight, onChange]);

  if (imageError) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--p-color-text-critical, #d72c0d)" }}>{imageError}</p>
      </div>
    );
  }

  if (!imageLoaded || !imageSize) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <p>Loading image…</p>
      </div>
    );
  }

  const scaleX = stageWidth / imageSize.width;
  const scaleY = stageHeight / imageSize.height;
  const img = imgRef.current;

  // Grid: one Line per grid line (two points each) so no connecting diagonals or curves
  const gridW = Math.floor(stageWidth);
  const gridH = Math.floor(stageHeight);
  const verticalPositions = getGridPositions(gridW, snapX);
  const horizontalPositions = getGridPositions(gridH, snapY);

  return (
    <div
      role="region"
      aria-label="Placement zones editor"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: MAX_CANVAS + 2,
      }}
    >
      {!inline && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
            border: "1px solid var(--p-color-border-secondary, #e1e3e5)",
          }}
        >
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: 14,
              lineHeight: 1.4,
              color: "var(--p-color-text-subdued, #6d7175)",
            }}
          >
            Drag a zone to move it; select one to show resize handles. Zones snap to a 1% grid. Click the canvas background to deselect.
          </p>
          {placements.length > 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--p-color-text-subdued, #6d7175)",
              }}
            >
              Zones: {placements.map((p) => p.name).join(", ")}
            </p>
          )}
        </div>
      )}
      <div
        style={{
          boxShadow: "0 0 0 1px var(--p-color-border, #c9cccf)",
          borderRadius: 8,
          overflow: "hidden",
          alignSelf: "flex-start",
        }}
      >
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          draggable
          onWheel={handleWheel}
          onDragEnd={() => {
            const stage = stageRef.current;
            if (stage) clampStagePosition(stage, stage.scaleX());
          }}
          onClick={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (clickedOnEmpty) { setSelectedId(null); onSelectPlacement?.(null); }
          }}
          onTap={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (clickedOnEmpty) { setSelectedId(null); onSelectPlacement?.(null); }
          }}
        >
          <Layer>
            <Image
              ref={imageRef}
              image={img ?? undefined}
              width={imageSize.width}
              height={imageSize.height}
              scaleX={scaleX}
              scaleY={scaleY}
              listening={false}
            />
            {showGrid &&
              verticalPositions.map((x) => (
                <Line
                  key={`v-${x}`}
                  points={[x, 0, x, gridH]}
                  stroke="rgba(0, 0, 0, 0.22)"
                  strokeWidth={1}
                  lineCap="butt"
                  listening={false}
                />
              ))}
            {showGrid &&
              horizontalPositions.map((y) => (
                <Line
                  key={`h-${y}`}
                  points={[0, y, gridW, y]}
                  stroke="rgba(0, 0, 0, 0.22)"
                  strokeWidth={1}
                  lineCap="butt"
                  listening={false}
                />
              ))}
            {/* Center crosshair alignment guides */}
            <Line
              points={[stageWidth / 2, 0, stageWidth / 2, stageHeight]}
              stroke="#9CA3AF"
              strokeWidth={1}
              opacity={0.08}
              listening={false}
            />
            <Line
              points={[0, stageHeight / 2, stageWidth, stageHeight / 2]}
              stroke="#9CA3AF"
              strokeWidth={1}
              opacity={0.08}
              listening={false}
            />
          {placements.map((p) => {
            const r = rects[p.id];
            if (!r) return null;
            const zoneColor = getZoneColor(p.id);
            return (
              <Rect
                key={p.id}
                ref={(node) => {
                  rectRefs.current[p.id] = node;
                }}
                data-placement-id={p.id}
                x={r.x}
                y={r.y}
                width={r.width}
                height={r.height}
                fill={zoneColor.fill}
                stroke={zoneColor.stroke}
                strokeWidth={2}
                draggable
                onDragStart={handleDragStart}
                onDragEnd={(e) => handleDragEnd(p.id, e)}
                onTransformStart={handleTransformStart}
                onTransformEnd={(e) => handleTransformEnd(p.id, e)}
                onClick={() => { setSelectedId(p.id); onSelectPlacement?.(p.id); }}
                onTap={() => { setSelectedId(p.id); onSelectPlacement?.(p.id); }}
              />
            );
          })}
          {selectedId && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                const minSize = 20;
                if (Math.abs(newBox.width) < minSize || Math.abs(newBox.height) < minSize) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>
      </div>
      {!inline && (
        <InlineStack gap="300" wrap>
          <Button variant="primary" onClick={handleSave}>
            Save zones
          </Button>
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="plain"
            disabled={!canUndo}
            onClick={() => {
              const next = historyIndexRef.current - 1;
              if (next >= 0 && historyRef.current[next]) {
                historyIndexRef.current = next;
                setRects(historyRef.current[next]);
                setCanUndo(next > 0);
                setCanRedo(true);
              }
            }}
            accessibilityLabel="Undo last move"
          >
            Undo
          </Button>
          <Button
            variant="plain"
            disabled={!canRedo}
            onClick={() => {
              const next = historyIndexRef.current + 1;
              if (next < historyRef.current.length && historyRef.current[next]) {
                historyIndexRef.current = next;
                setRects(historyRef.current[next]);
                setCanUndo(true);
                setCanRedo(next < historyRef.current.length - 1);
              }
            }}
            accessibilityLabel="Redo last move"
          >
            Redo
          </Button>
          <Button
            variant="plain"
            onClick={handleResetZoom}
            size="slim"
            accessibilityLabel="Reset zoom and pan"
          >
            Reset zoom
          </Button>
        </InlineStack>
      )}
    </div>
  );
}
