import type { AdminTranslator } from '@insignia/ui-localization/admin';
import type { Visualizer } from '@insignia/ui-visualizer';
import {
  containFit,
  type EditorState,
  type GeometryCommand,
  type GeometryV1,
  type PixelRect,
  projectScene,
  type RenderScene,
  type RenderStatus,
  type Viewport,
} from '@insignia/ui-visualizer/geometry';
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import type { CalibrationPoint } from './placement-calibration.mts';
import {
  type CanvasCamera,
  clampCanvasCamera,
  placementColor,
  snapPlacementRect,
  zoomCameraAt,
} from './placement-canvas-tools.mts';
import { clampPlacementRect, type EditorView, type PlacementRect } from './placement-workflow-model.mts';

type MeasurementLine = { a: CalibrationPoint; b: CalibrationPoint };

export type CanvasDrawFailure = 'placement-required' | 'movement-must-contain-artwork';
type DrawFeedback = CanvasDrawFailure | 'area-too-small' | 'unsupported-draw' | 'movement-drawn' | 'artwork-drawn';
type MeasureFeedback = 'points-identical' | 'unsupported-measure';
type Props = {
  view: EditorView;
  selectedId: string | null;
  preview: boolean;
  editingLocked?: boolean;
  interactionRevision: number;
  sizePercent?: number;
  onSelect(id: string): void;
  onRect(id: string, rect: PlacementRect): void;
  movementRect?: PlacementRect | null;
  drawing?: boolean;
  drawTarget?: 'artwork' | 'movement';
  onDraw?(rect: PlacementRect): CanvasDrawFailure | undefined;
  onCancelDraw?(): void;
  measuring?: boolean;
  measurementLine?: MeasurementLine | null;
  measurementControls?: ComponentChildren;
  measurementCoordinates?: boolean;
  onEnterMeasureCoordinates?(): void;
  onMeasure?(line: MeasurementLine, pointerType: string): void;
  onCancelMeasure?(): void;
  onStartMeasure?(): void;
  onImageStatus?(status: RenderStatus): void;
};

type DrawDraft = { startX: number; startY: number; endX: number; endY: number; pointerId: number };
type CanvasTask = 'edit' | 'draw' | 'movement' | 'measure' | 'preview';
type CanvasImageState = 'loading' | 'ready' | 'missing-image' | 'missing-geometry' | 'image-error' | 'preview-error';

function canvasTask({
  preview,
  measuring,
  editingLocked,
  drawing,
}: Pick<Props, 'preview' | 'measuring' | 'editingLocked' | 'drawing'>): CanvasTask {
  if (preview) return 'preview';
  if (measuring) return 'measure';
  if (editingLocked) return 'movement';
  return drawing ? 'draw' : 'edit';
}

const demoArtworkUrl = 'https://insignia-order-demo.invalid/files/north-coast-chest.png';
const demoArtworkAspectRatio = 1;

function renderableDemoUrl(url: string): string {
  // Legacy demo images may use this loopback path. The reserved HTTPS origin is
  // intercepted by the local preview service worker.
  const match = /^\/__preview\/demo\/(files\/[a-z0-9-]+\.(?:jpg|png|svg))$/.exec(url);
  return match ? `https://insignia-order-demo.invalid/${match[1]}` : url;
}

function renderStatus(status: RenderStatus, imageUrl: string): CanvasImageState {
  if (!imageUrl || status === 'missing-image') return 'missing-image';
  return status;
}

function canvasStatusMessage(status: CanvasImageState, t: AdminTranslator): string {
  return t(`editor:canvas.imageStatus.${status}`);
}

function geometryFor(view: EditorView, sizePercent: number): GeometryV1 {
  const factor = Math.max(0.01, Math.min(1, Number.isFinite(sizePercent) ? sizePercent / 100 : 1));
  return {
    version: 'm5-geometry-v1',
    views: [
      {
        id: view.id,
        image: {
          revisionId: `placement-preview:${view.id}`,
          width: view.imageWidth,
          height: view.imageHeight,
        },
        variantImages: [],
        placements: view.placements.map(({ id, rect }) => ({ id, rect })),
      },
    ],
    steps: [{ id: 'placement-preview-artwork', widthFraction: factor, heightFraction: factor }],
  };
}

function sceneFor(
  view: EditorView,
  selectedId: string | null,
  task: CanvasTask,
  viewport: Viewport,
  sizePercent: number,
): RenderScene {
  const validDimensions =
    Number.isFinite(view.imageWidth) &&
    view.imageWidth > 0 &&
    Number.isFinite(view.imageHeight) &&
    view.imageHeight > 0;
  if (!validDimensions) return { version: 1, status: 'missing-geometry', placements: [] };

  try {
    const selectedPlacementId = selectedId ?? undefined;
    const state: EditorState = {
      version: 1,
      geometry: geometryFor(view, sizePercent),
      viewId: view.id,
      selectedPlacementId,
      ...(task === 'preview' && selectedPlacementId
        ? {
            selectedStepId: 'placement-preview-artwork',
            artwork: { kind: 'raster' as const, url: demoArtworkUrl, aspectRatio: demoArtworkAspectRatio },
          }
        : { artwork: { kind: 'none' as const } }),
    };
    const revisionId = `placement-preview:${view.id}`;
    const scene = projectScene(state, viewport, { [revisionId]: renderableDemoUrl(view.imageUrl) });
    // Presentation never changes saved geometry. A view is the overview; an
    // individual placement focuses editing on that area alone.
    const placements =
      task === 'preview' || task === 'measure'
        ? []
        : scene.placements.filter((area) => !selectedId || area.id === selectedId);
    return {
      ...scene,
      placements: task === 'draw' ? placements.map((area) => ({ ...area, selected: false })) : placements,
    };
  } catch {
    return { version: 1, status: 'missing-geometry', placements: [] };
  }
}

function normalizedPointerPoint(
  event: PointerEvent,
  surface: HTMLElement,
  view: EditorView,
  camera: CanvasCamera,
): { x: number; y: number; inside: boolean } | null {
  const content = containFit(
    { width: view.imageWidth, height: view.imageHeight },
    { width: Math.max(1, surface.clientWidth), height: Math.max(1, surface.clientHeight), pixelRatio: 1 },
  );
  const bounds = surface.getBoundingClientRect();
  const x = (event.clientX - bounds.left - camera.x) / camera.scale;
  const y = (event.clientY - bounds.top - camera.y) / camera.scale;
  return {
    x: Math.max(0, Math.min(1, (x - content.x) / content.width)),
    y: Math.max(0, Math.min(1, (y - content.y) / content.height)),
    inside: x >= content.x && x <= content.x + content.width && y >= content.y && y <= content.y + content.height,
  };
}

function normalizedDraftBox(draft: DrawDraft, content: PixelRect): PixelRect {
  const left = Math.min(draft.startX, draft.endX);
  const top = Math.min(draft.startY, draft.endY);
  return {
    x: content.x + left * content.width,
    y: content.y + top * content.height,
    width: Math.abs(draft.endX - draft.startX) * content.width,
    height: Math.abs(draft.endY - draft.startY) * content.height,
  };
}

function boundedNudge(
  rect: PlacementRect,
  dx: number,
  dy: number,
  image: { width: number; height: number },
): PlacementRect {
  return {
    ...rect,
    centerX: Math.max(rect.width / 2, Math.min(1 - rect.width / 2, rect.centerX + dx / image.width)),
    centerY: Math.max(rect.height / 2, Math.min(1 - rect.height / 2, rect.centerY + dy / image.height)),
  };
}

function sameRect(first: PlacementRect, second: PlacementRect): boolean {
  return (
    first.centerX === second.centerX &&
    first.centerY === second.centerY &&
    first.width === second.width &&
    first.height === second.height
  );
}

export default function PlacementCanvas({
  view,
  selectedId,
  preview,
  editingLocked = false,
  interactionRevision,
  sizePercent = 100,
  movementRect = null,
  drawing = false,
  drawTarget = 'artwork',
  measuring = false,
  measurementLine = null,
  measurementControls,
  measurementCoordinates = false,
  onEnterMeasureCoordinates,
  onSelect,
  onRect,
  onDraw,
  onCancelDraw,
  onMeasure,
  onCancelMeasure,
  onStartMeasure,
  onImageStatus,
}: Props) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const appleKeyboard = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcutModifier = appleKeyboard ? '⌘' : 'Ctrl';
  const canvas = useRef<HTMLDivElement>(null);
  const scrollport = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<CanvasCamera>({ scale: 1, x: 0, y: 0 });
  const cameraRef = useRef(camera);
  const zoom = camera.scale;
  const cameraAnimation = useRef<number | null>(null);
  const placementInteraction = useRef(false);
  const [panning, setPanning] = useState(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [manipulating, setManipulating] = useState(false);
  const finePlacement = useRef(false);
  const pointerMode = useRef({ space: false });
  const panGesture = useRef<{ pointerId: number; x: number; y: number; camera: CanvasCamera } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drawOverlay = useRef<HTMLDivElement>(null);
  const renderer = useRef<Visualizer | null>(null);
  const drawGesture = useRef<DrawDraft | null>(null);
  const propsRef = useRef({
    view,
    selectedId,
    preview,
    editingLocked,
    sizePercent,
    movementRect,
    drawing,
    drawTarget,
    measuring,
    onSelect,
    onRect,
    onDraw,
    onCancelDraw,
    onMeasure,
    onCancelMeasure,
    onImageStatus,
  });
  propsRef.current = {
    view,
    selectedId,
    preview,
    editingLocked,
    sizePercent,
    movementRect,
    drawing,
    drawTarget,
    measuring,
    onSelect,
    onRect,
    onDraw,
    onCancelDraw,
    onMeasure,
    onCancelMeasure,
    onImageStatus,
  };
  const [status, setStatus] = useState<CanvasImageState>(view.imageUrl ? 'loading' : 'missing-image');
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const [drawDraft, setDrawDraft] = useState<DrawDraft | null>(null);
  const [drawFeedback, setDrawFeedback] = useState<DrawFeedback | null>(null);
  const [measureFirst, setMeasureFirst] = useState<CalibrationPoint | null>(null);
  const [measureHover, setMeasureHover] = useState<CalibrationPoint | null>(null);
  const [measureFeedback, setMeasureFeedback] = useState<MeasureFeedback | null>(null);
  const suppressMeasureClick = useRef(false);
  const pendingMeasure = useRef<{ pointerId: number; line: MeasurementLine; pointerType: string } | null>(null);
  const statusId = useId();
  const drawingId = useId();
  const measuringId = useId();

  function stopCameraAnimation() {
    if (cameraAnimation.current !== null) cancelAnimationFrame(cameraAnimation.current);
    cameraAnimation.current = null;
  }
  function applyCamera(next: CanvasCamera) {
    cameraRef.current = next;
    setCamera(next);
    renderer.current?.setCamera(next);
  }
  function boundedCamera(next: CanvasCamera) {
    const element = surface.current;
    const current = propsRef.current;
    if (!element) return next;
    const viewport = viewportFor(element);
    const content = containFit({ width: current.view.imageWidth, height: current.view.imageHeight }, viewport);
    return clampCanvasCamera(next, viewport, content);
  }
  function settleCamera(animate = true) {
    stopCameraAnimation();
    const from = cameraRef.current;
    const to = boundedCamera(from);
    if (from.x === to.x && from.y === to.y) return;
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyCamera(to);
      return;
    }
    const started = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - started) / 220);
      const eased = 1 - (1 - progress) ** 3;
      applyCamera({ ...to, x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
      cameraAnimation.current = progress < 1 ? requestAnimationFrame(tick) : null;
    }
    cameraAnimation.current = requestAnimationFrame(tick);
  }
  function resetPan() {
    const active = panGesture.current;
    panGesture.current = null;
    if (active && scrollport.current?.hasPointerCapture(active.pointerId))
      scrollport.current.releasePointerCapture(active.pointerId);
    setPanning(false);
  }
  function zoomTo(scale: number, point?: { x: number; y: number }) {
    const element = surface.current;
    if (!element || propsRef.current.drawing || placementInteraction.current) return;
    stopCameraAnimation();
    const anchor = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const next = zoomCameraAt(cameraRef.current, Math.max(1, Math.min(3, scale)), anchor);
    applyCamera(boundedCamera(next));
  }
  function fitCamera() {
    renderer.current?.cancelInteraction();
    stopCameraAnimation();
    resetPan();
    applyCamera({ scale: 1, x: 0, y: 0 });
  }
  useEffect(() => {
    fitCamera();
    setManipulating(false);
    placementInteraction.current = false;
    setSpaceHeld(false);
    pointerMode.current.space = false;
  }, [view.id, view.imageUrl]);
  useEffect(() => {
    const port = scrollport.current;
    if (!port) return;
    function wheel(event: WheelEvent) {
      if (!port || propsRef.current.drawing || placementInteraction.current || panGesture.current || !event.deltaY)
        return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? port.clientHeight : 1);
      const bounds = port.getBoundingClientRect();
      zoomTo(cameraRef.current.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.0015), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    }
    function blur() {
      cancelPan();
      pointerMode.current.space = false;
      setSpaceHeld(false);
      setManipulating(false);
      placementInteraction.current = false;
    }
    port.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', blur);
    return () => {
      port.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
      stopCameraAnimation();
      panGesture.current = null;
    };
  }, []);
  function hitsArea(event: PointerEvent): boolean {
    const element = surface.current;
    const current = propsRef.current;
    if (!element || current.preview || current.measuring || current.drawing || current.editingLocked) return false;
    const content = containFit(
      { width: current.view.imageWidth, height: current.view.imageHeight },
      viewportFor(element),
    );
    const bounds = element.getBoundingClientRect();
    const camera = cameraRef.current;
    const x = (event.clientX - bounds.left - camera.x) / camera.scale;
    const y = (event.clientY - bounds.top - camera.y) / camera.scale;
    // Keep pointer downs in the resize handles' full screen-space hit area
    // out of the scrollport pan capture path.
    const margin = current.selectedId ? 24 / camera.scale : 0;
    return current.view.placements.some(({ id, rect }) => {
      if (current.selectedId && id !== current.selectedId) return false;
      const left = content.x + (rect.centerX - rect.width / 2) * content.width;
      const top = content.y + (rect.centerY - rect.height / 2) * content.height;
      return (
        x >= left - margin &&
        x <= left + rect.width * content.width + margin &&
        y >= top - margin &&
        y <= top + rect.height * content.height + margin
      );
    });
  }
  function beginPan(event: PointerEvent) {
    finePlacement.current = event.altKey;
    const port = scrollport.current;
    const current = propsRef.current;
    if (
      !port ||
      current.drawing ||
      (current.measuring && !pointerMode.current.space && event.button !== 1) ||
      placementInteraction.current ||
      panGesture.current ||
      !event.isPrimary ||
      ![0, 1].includes(event.button)
    )
      return;
    // A new pointer interaction takes over from spring-back before Konva edits the area.
    stopCameraAnimation();
    if (event.button !== 1 && !pointerMode.current.space && hitsArea(event)) return;
    event.preventDefault();
    event.stopPropagation();
    surface.current?.focus({ preventScroll: true });
    panGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current };
    port.setPointerCapture(event.pointerId);
    setPanning(true);
  }
  function continuePan(event: PointerEvent) {
    finePlacement.current = event.altKey;
    const start = panGesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    applyCamera({
      ...start.camera,
      x: start.camera.x + event.clientX - start.x,
      y: start.camera.y + event.clientY - start.y,
    });
  }
  function endPan(event: PointerEvent) {
    finePlacement.current = event.altKey;
    if (panGesture.current?.pointerId !== event.pointerId) {
      if (event.isPrimary && cameraAnimation.current === null) {
        // Finish Konva's pointer-up commit before resuming any interrupted spring-back.
        cameraAnimation.current = requestAnimationFrame(() => {
          cameraAnimation.current = null;
          settleCamera();
        });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    resetPan();
    settleCamera();
  }
  function cancelPan() {
    renderer.current?.cancelInteraction();
    resetPan();
    settleCamera(false);
  }
  useEffect(() => {
    if (interactionRevision > 0) cancelPan();
  }, [interactionRevision]);

  function viewportFor(element: HTMLElement): Viewport {
    return {
      width: Math.max(1, element.clientWidth),
      height: Math.max(1, element.clientHeight),
      pixelRatio: Math.max(1, globalThis.devicePixelRatio || 1),
    };
  }

  function command(command: GeometryCommand) {
    const current = propsRef.current;
    if (current.editingLocked) return;
    if (command.kind === 'select-placement') {
      if (command.placementId) current.onSelect(command.placementId);
    } else if (command.kind === 'set-placement-rect') {
      const original = current.view.placements.find((area) => area.id === command.placementId)?.rect;
      current.onRect(
        command.placementId,
        finePlacement.current || !original ? command.rect : snapPlacementRect(command.rect, original),
      );
    }
  }

  useEffect(() => {
    let cancelled = false;
    const element = canvas.current;
    if (!element) return;
    void import('@insignia/ui-visualizer')
      .then(({ createVisualizer }) =>
        createVisualizer({
          element,
          background: 'transparent',
          onCommand: command,
          placementAppearance: (id) => {
            const appearance = placementColor(id);
            return canvasTask(propsRef.current) === 'draw' ? { stroke: '#8a8a8a', fill: 'transparent' } : appearance;
          },
          onPlacementInteraction: (active) => {
            placementInteraction.current = active;
            setManipulating(active);
          },
          onStatus: (next) => {
            setStatus(renderStatus(next, propsRef.current.view.imageUrl));
            propsRef.current.onImageStatus?.(next);
          },
        }),
      )
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        renderer.current = created;
        created.setCamera(cameraRef.current);
        const current = propsRef.current;
        created.setMode(canvasTask(current) === 'edit' ? 'edit-placement' : 'preview');
        created.update(
          sceneFor(current.view, current.selectedId, canvasTask(current), viewportFor(element), current.sizePercent),
        );
      })
      .catch(() => {
        if (!cancelled) setStatus('preview-error');
      });
    return () => {
      cancelled = true;
      renderer.current?.cancelInteraction();
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0)
        setSurfaceSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (surfaceSize.width > 1 && surfaceSize.height > 1) settleCamera(false);
  }, [surfaceSize.width, surfaceSize.height]);

  useEffect(() => {
    if (drawing) {
      resetPan();
      setMeasureFirst(null);
      setMeasureHover(null);
      setMeasureFeedback(null);
      setDrawFeedback(null);
      drawOverlay.current?.focus({ preventScroll: true });
      return;
    }
    drawGesture.current = null;
    setDrawDraft(null);
    setDrawFeedback(null);
  }, [drawing]);

  useEffect(() => {
    pendingMeasure.current = null;
    if (measuring && !drawing) {
      resetPan();
      setMeasureFirst(null);
      setMeasureHover(null);
      setMeasureFeedback(null);
      surface.current?.focus({ preventScroll: true });
      return;
    }
    setMeasureFirst(null);
    setMeasureHover(null);
    setMeasureFeedback(null);
  }, [measuring, drawing]);

  useEffect(() => {
    pendingMeasure.current = null;
    setMeasureFirst(null);
    setMeasureHover(null);
    setMeasureFeedback(null);
  }, [view.id, view.imageUrl, view.imageWidth, view.imageHeight, measurementLine]);

  useLayoutEffect(() => {
    if (view.imageUrl) setStatus('loading');
    else setStatus('missing-image');
  }, [view.imageUrl]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !renderer.current) return;
    const task = canvasTask({ preview, measuring, editingLocked, drawing });
    renderer.current.setMode(task === 'edit' ? 'edit-placement' : 'preview');
    renderer.current.update(sceneFor(view, selectedId, task, viewportFor(element), sizePercent));
  }, [
    view,
    selectedId,
    preview,
    measuring,
    editingLocked,
    drawing,
    sizePercent,
    surfaceSize.width,
    surfaceSize.height,
  ]);

  function clearDrawGesture(pointerId?: number) {
    drawGesture.current = null;
    setDrawDraft(null);
    if (pointerId !== undefined && drawOverlay.current?.hasPointerCapture(pointerId))
      drawOverlay.current.releasePointerCapture(pointerId);
  }

  function handleDrawPointerDown(event: PointerEvent) {
    const current = propsRef.current;
    const element = surface.current;
    if (!current.drawing || current.preview || event.button !== 0 || !element) return;
    const point = normalizedPointerPoint(event, element, current.view, cameraRef.current);
    if (!point?.inside) return;
    event.preventDefault();
    event.stopPropagation();
    drawGesture.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    drawOverlay.current?.setPointerCapture(event.pointerId);
    setDrawDraft(drawGesture.current);
    setDrawFeedback(null);
  }

  function handleDrawPointerMove(event: PointerEvent) {
    const active = drawGesture.current;
    const current = propsRef.current;
    const element = surface.current;
    if (!active || active.pointerId !== event.pointerId || !current.drawing || !element) return;
    const point = normalizedPointerPoint(event, element, current.view, cameraRef.current);
    if (!point) return;
    const next = { ...active, endX: point.x, endY: point.y };
    drawGesture.current = next;
    setDrawDraft(next);
  }

  function handleDrawPointerUp(event: PointerEvent) {
    const active = drawGesture.current;
    const current = propsRef.current;
    const element = surface.current;
    if (!active || active.pointerId !== event.pointerId || !current.drawing || !element) return;
    const point = normalizedPointerPoint(event, element, current.view, cameraRef.current);
    if (!point) return;
    const draft = { ...active, endX: point.x, endY: point.y };
    const content = containFit(
      { width: current.view.imageWidth, height: current.view.imageHeight },
      viewportFor(element),
    );
    const box = normalizedDraftBox(draft, content);
    clearDrawGesture(event.pointerId);
    if (box.width / content.width < 0.02 || box.height / content.height < 0.02) {
      setDrawFeedback('area-too-small');
      return;
    }
    const rect = clampPlacementRect({
      centerX: (draft.startX + draft.endX) / 2,
      centerY: (draft.startY + draft.endY) / 2,
      width: Math.abs(draft.endX - draft.startX),
      height: Math.abs(draft.endY - draft.startY),
    });
    if (!current.onDraw) {
      setDrawFeedback('unsupported-draw');
      return;
    }
    const feedback = current.onDraw(rect);
    if (feedback) {
      setDrawFeedback(feedback);
      return;
    }
    setDrawFeedback(current.drawTarget === 'movement' ? 'movement-drawn' : 'artwork-drawn');
  }

  function handleDrawPointerCancel(event: PointerEvent) {
    if (drawGesture.current?.pointerId === event.pointerId) clearDrawGesture(event.pointerId);
  }

  function handleMeasurePointerDown(event: PointerEvent) {
    const current = propsRef.current;
    const element = surface.current;
    if (!current.measuring || current.drawing || current.preview || event.button !== 0 || !element) return;
    const point = normalizedPointerPoint(event, element, current.view, cameraRef.current);
    if (!point?.inside) return;
    event.preventDefault();
    event.stopPropagation();
    setMeasureFeedback(null);

    if (!measureFirst) {
      setMeasureFirst({ x: point.x, y: point.y });
      setMeasureHover({ x: point.x, y: point.y });
      return;
    }

    const linePixels = Math.hypot(
      (point.x - measureFirst.x) * current.view.imageWidth,
      (point.y - measureFirst.y) * current.view.imageHeight,
    );
    if (linePixels === 0) {
      setMeasureFeedback('points-identical');
      return;
    }
    if (!current.onMeasure) {
      setMeasureFeedback('unsupported-measure');
      return;
    }

    // Reveal controls after release so this gesture cannot hit a newly mounted field or action.
    pendingMeasure.current = {
      pointerId: event.pointerId,
      line: { a: measureFirst, b: { x: point.x, y: point.y } },
      pointerType: event.pointerType,
    };
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMeasurePointerUp(event: PointerEvent) {
    const pending = pendingMeasure.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pendingMeasure.current = null;
    if (!propsRef.current.measuring) return;
    suppressMeasureClick.current = true;
    propsRef.current.onMeasure?.(pending.line, pending.pointerType);
    setMeasureFirst(null);
    setMeasureHover(null);
  }

  function handleMeasurePointerMove(event: PointerEvent) {
    const current = propsRef.current;
    const element = surface.current;
    if (!current.measuring || current.drawing || current.preview || !measureFirst || !element) return;
    const point = normalizedPointerPoint(event, element, current.view, cameraRef.current);
    setMeasureHover(point?.inside ? { x: point.x, y: point.y } : null);
  }

  function cancelDrawing() {
    clearDrawGesture();
    setDrawFeedback(null);
    propsRef.current.onCancelDraw?.();
  }

  function handleKeyDown(event: KeyboardEvent) {
    setPointerFocus(false);
    const current = propsRef.current;
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.code === 'Space' && !current.drawing) {
      event.preventDefault();
      pointerMode.current.space = true;
      setSpaceHeld(true);
      return;
    }
    const vector = direction[event.key];
    if (event.altKey && vector) {
      event.preventDefault();
      stopCameraAnimation();
      applyCamera(
        boundedCamera({
          ...cameraRef.current,
          x: cameraRef.current.x - vector[0] * 40,
          y: cameraRef.current.y - vector[1] * 40,
        }),
      );
      return;
    }
    if (event.key === 'Escape') {
      cancelPan();
      pointerMode.current.space = false;
      setSpaceHeld(false);
      if (current.measuring) {
        event.preventDefault();
        setMeasureFirst(null);
        setMeasureHover(null);
        setMeasureFeedback(null);
        current.onCancelMeasure?.();
        return;
      }
    }
    if (event.key === 'Escape' && current.drawing) {
      event.preventDefault();
      cancelDrawing();
      return;
    }
    if (current.drawing || current.measuring || current.editingLocked) return;
    if (current.preview || !vector || !current.selectedId) return;
    const placement = current.view.placements.find((item) => item.id === current.selectedId);
    const element = canvas.current;
    if (!placement || !element) return;
    event.preventDefault();
    const content = containFit(
      { width: current.view.imageWidth, height: current.view.imageHeight },
      viewportFor(element),
    );
    const amount = event.shiftKey ? 5 : 1;
    const next = boundedNudge(
      placement.rect,
      (vector[0] * amount * current.view.imageWidth) / (content.width * cameraRef.current.scale),
      (vector[1] * amount * current.view.imageHeight) / (content.height * cameraRef.current.scale),
      { width: current.view.imageWidth, height: current.view.imageHeight },
    );
    if (!sameRect(placement.rect, next)) current.onRect(placement.id, next);
  }

  let drawingContent: PixelRect | null = null;
  let draftBox: PixelRect | null = null;
  let movementBox: PixelRect | null = null;
  if (view.imageWidth > 0 && view.imageHeight > 0) {
    drawingContent = containFit(
      { width: view.imageWidth, height: view.imageHeight },
      { width: surfaceSize.width, height: surfaceSize.height, pixelRatio: 1 },
    );
    if (drawDraft) draftBox = normalizedDraftBox(drawDraft, drawingContent);
    if (movementRect) {
      movementBox = {
        x: drawingContent.x + (movementRect.centerX - movementRect.width / 2) * drawingContent.width,
        y: drawingContent.y + (movementRect.centerY - movementRect.height / 2) * drawingContent.height,
        width: movementRect.width * drawingContent.width,
        height: movementRect.height * drawingContent.height,
      };
    }
  }
  const visibleMeasureLine = measureFirst ? { a: measureFirst, b: measureHover } : measurementLine;
  const measurePointOnCanvas = (point: CalibrationPoint) =>
    drawingContent
      ? {
          x: camera.x + (drawingContent.x + point.x * drawingContent.width) * camera.scale,
          y: camera.y + (drawingContent.y + point.y * drawingContent.height) * camera.scale,
        }
      : null;
  const measureAOnCanvas = visibleMeasureLine ? measurePointOnCanvas(visibleMeasureLine.a) : null;
  const measureBOnCanvas = visibleMeasureLine?.b ? measurePointOnCanvas(visibleMeasureLine.b) : null;

  return (
    <div
      class="placement-canvas-component"
      onPointerDownCapture={() => {
        suppressMeasureClick.current = false;
      }}
      onClickCapture={(event) => {
        // Point B reveals controls under this gesture. Its trailing click must not activate them.
        if (!suppressMeasureClick.current || event.detail === 0) return;
        suppressMeasureClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        class={`placement-canvas-scroll ${zoom > 1 ? 'is-zoomed' : ''} ${panning || spaceHeld ? 'is-panning' : ''}`}
        ref={scrollport}
        onPointerDownCapture={(event) => {
          setPointerFocus(true);
          beginPan(event);
        }}
        onPointerMoveCapture={continuePan}
        onPointerUpCapture={endPan}
        onPointerCancel={cancelPan}
        onLostPointerCapture={() => {
          if (panGesture.current) cancelPan();
        }}
      >
        <section
          ref={surface}
          class="placement-canvas"
          data-placement-canvas="true"
          data-camera-scale={camera.scale}
          data-camera-x={camera.x}
          data-camera-y={camera.y}
          data-measuring={measuring}
          data-pointer-focus={pointerFocus}
          style={{
            backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`,
            backgroundPosition: `${camera.x}px ${camera.y}px`,
          }}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard canvas navigation and placement nudges need a focus target.
          tabIndex={0}
          aria-label={translateUi('editor:canvas.placementCanvas', { viewName: view.name })}
          aria-describedby={`${statusId}${drawing && !preview ? ` ${drawingId}` : ''}${measuring && !preview ? ` ${measuringId}` : ''}`}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Space"
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            if (event.code === 'Space') {
              pointerMode.current.space = false;
              setSpaceHeld(false);
            }
          }}
          onBlur={() => {
            setPointerFocus(false);
            pointerMode.current.space = false;
            setSpaceHeld(false);
          }}
        >
          <div
            ref={canvas}
            class="placement-canvas-renderer"
            aria-hidden="true"
            style={{ position: 'absolute', inset: '0' }}
          />
          {movementBox && !preview && (
            <div
              class="placement-movement-boundary"
              aria-hidden="true"
              style={{
                left: `${camera.x + movementBox.x * camera.scale}px`,
                top: `${camera.y + movementBox.y * camera.scale}px`,
                width: `${movementBox.width * camera.scale}px`,
                height: `${movementBox.height * camera.scale}px`,
              }}
            />
          )}
          {manipulating && drawingContent && !preview && (
            <div
              class="placement-snap-grid"
              aria-hidden="true"
              style={{
                left: `${camera.x + drawingContent.x * camera.scale}px`,
                top: `${camera.y + drawingContent.y * camera.scale}px`,
                width: `${drawingContent.width * camera.scale}px`,
                height: `${drawingContent.height * camera.scale}px`,
                backgroundSize: `${(drawingContent.width * camera.scale) / 100}px ${(drawingContent.height * camera.scale) / 100}px`,
              }}
            />
          )}
          {drawing && !preview && (
            <section
              ref={drawOverlay}
              class="placement-draw-overlay"
              tabIndex={-1}
              aria-label={
                drawTarget === 'movement'
                  ? translateUi('editor:canvas.drawMovement')
                  : translateUi('editor:canvas.drawArtwork')
              }
              aria-describedby={drawingId}
              aria-keyshortcuts="Escape"
              onPointerDown={handleDrawPointerDown}
              onPointerMove={handleDrawPointerMove}
              onPointerUp={handleDrawPointerUp}
              onPointerCancel={handleDrawPointerCancel}
              style={{
                position: 'absolute',
                inset: '0',
                zIndex: 4,
                cursor: 'crosshair',
                touchAction: 'none',
                background: 'transparent',
              }}
            >
              {draftBox && (
                <div
                  class="placement-draw-draft"
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: `${camera.x + draftBox.x * camera.scale}px`,
                    top: `${camera.y + draftBox.y * camera.scale}px`,
                    width: `${draftBox.width * camera.scale}px`,
                    height: `${draftBox.height * camera.scale}px`,
                    boxSizing: 'border-box',
                    border: '2px dashed #1769aa',
                    background: 'rgb(23 105 170 / 16%)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </section>
          )}
          {drawingContent && measureAOnCanvas && (
            <svg
              class="placement-calibration-line"
              aria-hidden="true"
              viewBox={`0 0 ${surfaceSize.width} ${surfaceSize.height}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                inset: '0',
                width: '100%',
                height: '100%',
                overflow: 'visible',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            >
              {measureBOnCanvas && (
                <line
                  x1={measureAOnCanvas.x}
                  y1={measureAOnCanvas.y}
                  x2={measureBOnCanvas.x}
                  y2={measureBOnCanvas.y}
                  stroke="#0088ff"
                  strokeWidth="2"
                  strokeDasharray={measureFirst ? '6 4' : undefined}
                />
              )}
              <circle
                cx={measureAOnCanvas.x}
                cy={measureAOnCanvas.y}
                r="6"
                fill="white"
                stroke="#1769aa"
                strokeWidth="2"
              />
              {measureBOnCanvas && (
                <circle
                  cx={measureBOnCanvas.x}
                  cy={measureBOnCanvas.y}
                  r="6"
                  fill="white"
                  stroke="#1769aa"
                  strokeWidth="2"
                />
              )}
              <text
                x={measureAOnCanvas.x + 9}
                y={measureAOnCanvas.y - 9}
                fill="#102a43"
                fontSize="12"
                fontWeight="700"
                style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: '3px', strokeLinejoin: 'round' }}
              >
                A
              </text>
              {measureBOnCanvas && (
                <text
                  x={measureBOnCanvas.x + 9}
                  y={measureBOnCanvas.y - 9}
                  fill="#102a43"
                  fontSize="12"
                  fontWeight="700"
                  style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: '3px', strokeLinejoin: 'round' }}
                >
                  B
                </text>
              )}
            </svg>
          )}
          {measuring && !preview && !drawing && (
            <section
              class="placement-calibration-input-overlay"
              tabIndex={-1}
              aria-label={translateUi('editor:canvas.measureImage')}
              aria-describedby={measuringId}
              aria-keyshortcuts="Escape"
              onPointerDown={handleMeasurePointerDown}
              onPointerMove={handleMeasurePointerMove}
              onPointerUp={handleMeasurePointerUp}
              onPointerCancel={() => {
                pendingMeasure.current = null;
                setMeasureHover(null);
              }}
              style={{
                position: 'absolute',
                inset: '0',
                zIndex: 4,
                cursor: 'crosshair',
                touchAction: 'none',
                background: 'transparent',
              }}
            />
          )}
        </section>
      </div>
      <fieldset class="placement-zoom-controls" aria-label={translateUi('editor:canvas.canvasZoom')}>
        <s-button
          variant="tertiary"
          icon="minus"
          accessibilityLabel={translateUi('editor:canvas.zoomOut')}
          disabled={zoom <= 1 || drawing}
          onClick={() => zoomTo(cameraRef.current.scale - 0.25)}
        />
        <s-button
          variant="tertiary"
          disabled={drawing}
          accessibilityLabel={translateUi('editor:canvas.fitAccessible', {
            zoom: new Intl.NumberFormat(formatLocale, { style: 'percent' }).format(zoom),
          })}
          onClick={fitCamera}
        >
          <span class="placement-zoom-label">
            {zoom === 1
              ? translateUi('editor:canvas.fit')
              : new Intl.NumberFormat(formatLocale, { style: 'percent' }).format(zoom)}
          </span>
        </s-button>
        <s-button
          variant="tertiary"
          icon="plus"
          accessibilityLabel={translateUi('editor:canvas.zoomIn')}
          disabled={zoom >= 3 || drawing}
          onClick={() => zoomTo(cameraRef.current.scale + 0.25)}
        />
      </fieldset>
      {!drawing && (
        <div class="placement-canvas-help">
          <s-button
            icon="question-circle"
            variant="tertiary"
            accessibilityLabel={translateUi('editor:canvas.canvasControls')}
            commandFor={`${statusId}-help`}
          />
          <s-popover id={`${statusId}-help`} inlineSize="300px">
            <div class="placement-canvas-help-content">
              <s-heading>{translateUi('editor:canvas.canvasControls')}</s-heading>
              <dl class="placement-canvas-help-touch">
                <div>
                  <dt>{translateUi('editor:canvas.zoom')}</dt>
                  <dd>{translateUi('editor:canvas.useTheFitAndButtons')}</dd>
                </div>
                {!preview && !measuring && (
                  <>
                    <div>
                      <dt>{translateUi('editor:canvas.moveImage')}</dt>
                      <dd>{translateUi('editor:canvas.dragEmptySpace')}</dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.moveArea')}</dt>
                      <dd>{translateUi('editor:canvas.dragTheSelectedArea')}</dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.resizeArea')}</dt>
                      <dd>{translateUi('editor:canvas.dragACornerHandle')}</dd>
                    </div>
                  </>
                )}
              </dl>
              <dl class="placement-canvas-help-desktop">
                <div>
                  <dt>{translateUi('editor:canvas.zoom')}</dt>
                  <dd>{translateUi('editor:canvas.buttonsOrMouseWheel')}</dd>
                </div>
                {!measuring && (
                  <div>
                    <dt>{translateUi('editor:canvas.pan')}</dt>
                    <dd>{translateUi('editor:canvas.dragEmptySpace')}</dd>
                  </div>
                )}
                <div>
                  <dt>{translateUi('editor:canvas.panAnywhere')}</dt>
                  <dd>
                    <kbd>{translateUi('editor:canvas.space')}</kbd>
                    <span>{translateUi('editor:canvas.drag')}</span>
                  </dd>
                </div>
                {!preview && !measuring && (
                  <>
                    <div>
                      <dt>{translateUi('editor:canvas.moveArea')}</dt>
                      <dd>
                        <kbd aria-label={translateUi('editor:canvas.arrowKeys')}>↑ ↓ ← →</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.largerStep')}</dt>
                      <dd>
                        <kbd aria-label={translateUi('editor:canvas.shift')}>{appleKeyboard ? '⇧' : 'Shift'}</kbd>
                        <span>+</span>
                        <kbd aria-label={translateUi('editor:canvas.arrowKeys')}>↑ ↓ ← →</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.ignoreGrid')}</dt>
                      <dd>
                        <kbd
                          aria-label={translateUi(
                            appleKeyboard ? 'editor:canvas.keyNames.option' : 'editor:canvas.keyNames.alt',
                          )}
                        >
                          {appleKeyboard ? '⌥' : 'Alt'}
                        </kbd>
                        <span>{translateUi('editor:canvas.drag')}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.undo')}</dt>
                      <dd>
                        <kbd
                          aria-label={translateUi(
                            appleKeyboard ? 'editor:canvas.keyNames.command' : 'editor:canvas.keyNames.control',
                          )}
                        >
                          {shortcutModifier}
                        </kbd>
                        <kbd>Z</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>{translateUi('editor:canvas.redo')}</dt>
                      <dd>
                        <kbd
                          aria-label={translateUi(
                            appleKeyboard ? 'editor:canvas.keyNames.command' : 'editor:canvas.keyNames.control',
                          )}
                        >
                          {shortcutModifier}
                        </kbd>
                        <kbd aria-label={translateUi('editor:canvas.shift')}>{appleKeyboard ? '⇧' : 'Shift'}</kbd>
                        <kbd>Z</kbd>
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {!preview && (
                <p class="placement-canvas-help-note">
                  {translateUi(
                    'editor:canvas.arrowKeysMoveTheSelectedPlacementWhenTheCanvasIsFocusedUndoAndRedoApplyOutsideTextFields',
                  )}
                </p>
              )}
            </div>
          </s-popover>
        </div>
      )}
      {!preview && !drawing && !editingLocked && status === 'ready' && onStartMeasure && (
        <div class={`placement-canvas-ruler ${measuring ? 'is-active' : ''}`}>
          {/* Keep native icon-button metrics; the empty glyph reserves the custom ruler's slot. */}
          <s-button
            icon="empty"
            variant="tertiary"
            accessibilityLabel={
              measuring ? translateUi('editor:canvas.cancelMeasurement') : translateUi('editor:canvas.measureImage')
            }
            interestFor={`${statusId}-ruler-tip`}
            onClick={measuring ? onCancelMeasure : onStartMeasure}
          />
          <svg
            class="placement-ruler-glyph"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m3 12 9-9a1.5 1.5 0 0 1 2.1 0L17 5.9a1.5 1.5 0 0 1 0 2.1l-9 9a1.5 1.5 0 0 1-2.1 0L3 14.1A1.5 1.5 0 0 1 3 12Z"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path d="m10.5 4.5 2 2m-5 1 2 2m-5 1 2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
      )}
      <div class="placement-control-overlays">
        <s-tooltip id={`${statusId}-ruler-tip`}>
          {measuring ? translateUi('editor:canvas.cancelMeasurement') : translateUi('editor:canvas.measureImage')}
        </s-tooltip>
      </div>
      {measuring && !preview && !drawing && (
        <div
          class={
            measurementLine || measurementCoordinates
              ? 'placement-canvas-draw-instruction'
              : 'placement-canvas-measure-prompt'
          }
        >
          <span id={measuringId} role="status" aria-live="polite">
            {measureFirst
              ? translateUi('editor:canvas.chooseEnd')
              : measurementLine
                ? translateUi('editor:canvas.enterKnownLength')
                : translateUi('editor:canvas.chooseKnownPoints')}
          </span>
          {!measurementLine && !measurementCoordinates && (
            <>
              <s-button variant="tertiary" onClick={() => onEnterMeasureCoordinates?.()}>
                {translateUi('editor:canvas.enterPointCoordinates')}
              </s-button>
              <s-button variant="tertiary" onClick={onCancelMeasure}>
                {translateUi('editor:canvas.cancel')}
              </s-button>
            </>
          )}
        </div>
      )}
      {measuring && measurementControls}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        class={`placement-canvas-status ${status === 'ready' ? 'is-ready' : ''}`}
      >
        {canvasStatusMessage(status, translateUi)}
      </p>
      {drawing && !preview && (
        <p id={drawingId} class="placement-canvas-draw-instruction">
          {drawTarget === 'movement'
            ? translateUi('editor:canvas.movementInstructions')
            : translateUi('editor:canvas.artworkInstructions')}
        </p>
      )}
      {drawFeedback && (
        <p class="placement-canvas-draw-feedback" role="status" aria-live="polite">
          {translateUi(`editor:canvas.drawFeedback.${drawFeedback}`)}
        </p>
      )}
      {measureFeedback && (
        <p class="placement-canvas-draw-feedback" role="status" aria-live="polite">
          {translateUi(`editor:canvas.measureFeedback.${measureFeedback}`)}
        </p>
      )}
    </div>
  );
}
