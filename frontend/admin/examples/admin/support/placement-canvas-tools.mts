/** Local editor affordances. These colors and snap settings are never saved as production geometry. */
import { clampPlacementRect, type PlacementRect } from './placement-workflow-model.mts';

// Legacy Insignia zone palette, keyed by identity rather than display order.
const colors = [
  { stroke: '#2563eb', fill: 'rgba(37, 99, 235, 0.12)' },
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.12)' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.12)' },
  { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.12)' },
  { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.12)' },
] as const;

export function placementColor(id: string) {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length] ?? colors[0];
}

export type CanvasCamera = { scale: number; x: number; y: number };
export type CameraPoint = { x: number; y: number };
export type CameraViewport = { width: number; height: number };
export type CameraContentRect = { x: number; y: number; width: number; height: number };

const edgeEpsilon = 0.000001;

function snapEdge(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanRect(rect: PlacementRect): PlacementRect {
  const clean = (value: number) => Number(value.toFixed(8));
  return {
    centerX: clean(rect.centerX),
    centerY: clean(rect.centerY),
    width: clean(rect.width),
    height: clean(rect.height),
  };
}

function snapAxis(
  start: number,
  end: number,
  originalStart: number,
  originalEnd: number,
): { start: number; end: number } {
  const startMoved = Math.abs(start - originalStart) > edgeEpsilon;
  const endMoved = Math.abs(end - originalEnd) > edgeEpsilon;
  if (!startMoved && !endMoved) return { start: originalStart, end: originalEnd };

  if (startMoved && endMoved) {
    const startDelta = start - originalStart;
    const endDelta = end - originalEnd;
    if (Math.abs(startDelta - endDelta) <= edgeEpsilon) {
      // A move translates both edges together. Snap its leading edge while
      // preserving the placement's exact size.
      const snappedStart = snapEdge(start);
      return { start: snappedStart, end: snappedStart + (end - start) };
    }
    return { start: snapEdge(start), end: snapEdge(end) };
  }

  // A side or corner resize moves one edge and keeps the opposite edge fixed.
  return startMoved ? { start: snapEdge(start), end: originalEnd } : { start: originalStart, end: snapEdge(end) };
}

/** Snap only the edges changed by a pointer commit; keyboard/numeric edits bypass this helper. */
export function snapPlacementRect(rect: PlacementRect, original: PlacementRect): PlacementRect {
  const left = rect.centerX - rect.width / 2;
  const right = rect.centerX + rect.width / 2;
  const top = rect.centerY - rect.height / 2;
  const bottom = rect.centerY + rect.height / 2;
  const originalLeft = original.centerX - original.width / 2;
  const originalRight = original.centerX + original.width / 2;
  const originalTop = original.centerY - original.height / 2;
  const originalBottom = original.centerY + original.height / 2;
  const horizontal = snapAxis(left, right, originalLeft, originalRight);
  const vertical = snapAxis(top, bottom, originalTop, originalBottom);
  const bounded = clampPlacementRect({
    centerX: (horizontal.start + horizontal.end) / 2,
    centerY: (vertical.start + vertical.end) / 2,
    width: horizontal.end - horizontal.start,
    height: vertical.end - vertical.start,
  });
  return cleanRect(bounded);
}

/** Zoom around a point expressed in untransformed viewport coordinates. */
export function zoomCameraAt(camera: CanvasCamera, newScale: number, point: CameraPoint): CanvasCamera {
  const worldX = (point.x - camera.x) / camera.scale;
  const worldY = (point.y - camera.y) / camera.scale;
  return {
    scale: newScale,
    x: point.x - worldX * newScale,
    y: point.y - worldY * newScale,
  };
}

function clampAxis(
  offset: number,
  viewportExtent: number,
  contentStart: number,
  contentExtent: number,
  scale: number,
): number {
  const scaledExtent = contentExtent * scale;
  if (scaledExtent <= viewportExtent) {
    const centered = viewportExtent / 2 - (contentStart + contentExtent / 2) * scale;
    return centered === 0 ? 0 : centered;
  }
  const minimum = viewportExtent - (contentStart + contentExtent) * scale;
  const maximum = -contentStart * scale;
  const bounded = Math.min(maximum, Math.max(minimum, offset));
  return bounded === 0 ? 0 : bounded;
}

/** Keep the projected image covering the viewport; center an axis when its image is smaller. */
export function clampCanvasCamera(
  camera: CanvasCamera,
  viewport: CameraViewport,
  contentRect: CameraContentRect = { x: 0, y: 0, width: viewport.width, height: viewport.height },
): CanvasCamera {
  return {
    ...camera,
    x: clampAxis(camera.x, viewport.width, contentRect.x, contentRect.width, camera.scale),
    y: clampAxis(camera.y, viewport.height, contentRect.y, contentRect.height, camera.scale),
  };
}
