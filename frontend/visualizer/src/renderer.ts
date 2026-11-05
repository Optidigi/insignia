import {
  containFit,
  type GeometryCommand,
  type PixelRect,
  type RenderScene,
  type RenderStatus,
  renderedToNormalized,
  type Viewport,
} from './geometry.js';

type Node = {
  setAttrs(attrs: Record<string, unknown>): void;
  moveToTop(): boolean;
  on(events: string, handler: () => void): void;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  scaleX(): number;
  scaleY(): number;
  scale(values: { x: number; y: number }): void;
  stopDrag(): void;
  visible(value: boolean): void;
  image(value: HTMLImageElement | undefined): void;
  destroy(): void;
};
type Container = {
  add(node: Node): void;
  setAttrs(attrs: Record<string, unknown>): void;
  destroy(): void;
  batchDraw(): void;
};
type Stage = Container & { width(value: number): void; height(value: number): void };
type Transformer = Node & { nodes(value: Node[]): void; stopTransform(): void };
type KonvaFacade = {
  Stage: new (attrs: Record<string, unknown>) => Stage;
  Layer: new () => Container;
  Rect: new (attrs: Record<string, unknown>) => Node;
  Image: new (attrs: Record<string, unknown>) => Node;
  Text: new (attrs: Record<string, unknown>) => Node;
  Transformer: new (attrs: Record<string, unknown>) => Transformer;
};

export interface Visualizer {
  update(scene: RenderScene): void;
  resize(viewport: Viewport): void;
  setCamera(camera: { scale: number; x: number; y: number }): void;
  cancelInteraction(): void;
  setMode(mode: 'preview' | 'edit-placement'): void;
  destroy(): void;
}

export interface VisualizerOptions {
  element: HTMLElement;
  /** Transparent lets an editor supply its own workspace backdrop behind the image. */
  background?: 'neutral' | 'transparent';
  onCommand(command: GeometryCommand): void;
  onStatus(status: RenderStatus): void;
  imageFactory?(): HTMLImageElement;
  placementAppearance?(id: string): { stroke: string; fill: string };
  onPlacementInteraction?(active: boolean): void;
}

function safeRasterUrl(url: string): boolean {
  return /^https:\/\//.test(url) || /^blob:/.test(url) || /^data:image\/(?:png|jpeg|webp);base64,/.test(url);
}

function mapRect(rect: PixelRect, from: PixelRect, to: PixelRect): PixelRect {
  return {
    x: to.x + ((rect.x - from.x) / from.width) * to.width,
    y: to.y + ((rect.y - from.y) / from.height) * to.height,
    width: (rect.width / from.width) * to.width,
    height: (rect.height / from.height) * to.height,
  };
}

/** Import Konva only at the client renderer factory. No stage exists in domain or saved state. */
export async function createVisualizer(options: VisualizerOptions): Promise<Visualizer> {
  const module = await import('konva');
  return createVisualizerWithKonva(options, module.default as unknown as KonvaFacade);
}

/** Injectable construction seam for deterministic renderer event tests. */
export function createVisualizerWithKonva(options: VisualizerOptions, konva: KonvaFacade): Visualizer {
  const initialViewport: Viewport = {
    width: Math.max(1, options.element.clientWidth),
    height: Math.max(1, options.element.clientHeight),
    pixelRatio: Math.max(1, globalThis.devicePixelRatio || 1),
  };
  let viewport = initialViewport;
  let source: RenderScene | undefined;
  let current: RenderScene | undefined;
  let mode: 'preview' | 'edit-placement' = 'preview';
  let cameraScale = 1;
  let cameraX = 0;
  let cameraY = 0;
  let imageRequest = 0;
  let imageUrl: string | undefined;
  let browserImage: HTMLImageElement | undefined;
  let artworkRequest = 0;
  let artworkUrl: string | undefined;
  let browserArtwork: HTMLImageElement | undefined;
  let artworkLoaded = false;
  let destroyed = false;
  let placementInteractionActive = false;
  const stage = new konva.Stage({ container: options.element, width: viewport.width, height: viewport.height });
  const background = new konva.Layer();
  const artworkLayer = new konva.Layer();
  const affordance = new konva.Layer();
  stage.add(background as unknown as Node);
  stage.add(artworkLayer as unknown as Node);
  stage.add(affordance as unknown as Node);
  const fallback = new konva.Rect({
    fill: options.background === 'transparent' ? 'transparent' : '#f1f2f4',
    listening: false,
  });
  const image = new konva.Image({ listening: false, visible: false });
  const artwork = new konva.Rect({ listening: false, visible: false });
  const artworkRaster = new konva.Image({ listening: false, visible: false });
  const logoLater = new konva.Text({
    text: 'LOGO',
    fill: '#17212b',
    fontStyle: 'bold',
    align: 'center',
    verticalAlign: 'middle',
    listening: false,
    visible: false,
  });
  const message = new konva.Text({ text: '', fill: '#5b6470', fontSize: 14, listening: false });
  background.add(fallback);
  background.add(image);
  artworkLayer.add(artwork);
  artworkLayer.add(artworkRaster);
  artworkLayer.add(logoLater);
  artworkLayer.add(message);
  const transformer = new konva.Transformer({
    rotateEnabled: false,
    flipEnabled: false,
    keepRatio: false,
    anchorSize: 10,
    borderStrokeWidth: 1,
    anchorStyleFunc: (anchor: Node) => {
      // Konva anchors scale with their layer. Counter-scale the hit stroke to
      // keep each handle easy to grab at every zoom level.
      anchor.setAttrs({ hitStrokeWidth: 24 / cameraScale });
    },
    enabledAnchors: [
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ],
    boundBoxFunc: (oldBox: PixelRect, newBox: PixelRect) =>
      Number.isFinite(newBox.x) &&
      Number.isFinite(newBox.y) &&
      Number.isFinite(newBox.width) &&
      Number.isFinite(newBox.height) &&
      newBox.width >= 1 &&
      newBox.height >= 1
        ? newBox
        : oldBox,
  });
  affordance.add(transformer);
  const placementNodes = new Map<string, Node>();
  type ArtworkNodes = {
    frame: Node;
    raster: Node;
    logo: Node;
    request: number;
    loaded: boolean;
    url?: string;
    image?: HTMLImageElement;
  };
  const artworkNodes = new Map<string, ArtworkNodes>();

  function setPlacementInteraction(active: boolean): void {
    if (placementInteractionActive === active) return;
    placementInteractionActive = active;
    options.onPlacementInteraction?.(active);
  }

  function draw(): void {
    background.batchDraw();
    artworkLayer.batchDraw();
    affordance.batchDraw();
  }

  function fillViewport(): void {
    // Counter the image layer's camera so the neutral workspace never pans or zooms.
    fallback.setAttrs({
      x: -cameraX / cameraScale,
      y: -cameraY / cameraScale,
      width: viewport.width / cameraScale,
      height: viewport.height / cameraScale,
    });
  }

  function projectedForViewport(scene: RenderScene): RenderScene {
    if (!scene.image || !scene.contentRect) return scene;
    const contentRect = containFit(scene.image, viewport);
    const from = scene.contentRect;
    return {
      ...scene,
      contentRect,
      placements: scene.placements.map((item) => ({ ...item, bounds: mapRect(item.bounds, from, contentRect) })),
      artworks: scene.artworks?.map((item) => ({ ...item, bounds: mapRect(item.bounds, from, contentRect) })),
      artwork: scene.artwork
        ? { ...scene.artwork, bounds: mapRect(scene.artwork.bounds, from, contentRect) }
        : undefined,
    };
  }

  function restore(): void {
    if (source) render(projectedForViewport(source));
  }

  function emitRect(id: string, node: Node): void {
    if (destroyed || !current?.contentRect || !current.viewId || mode !== 'edit-placement') return;
    const bounds = {
      x: node.x(),
      y: node.y(),
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
    };
    node.scale({ x: 1, y: 1 });
    try {
      const rect = renderedToNormalized(bounds, current.contentRect);
      options.onCommand({
        kind: 'set-placement-rect',
        baseVersion: current.version,
        viewId: current.viewId,
        variantId: current.variantId,
        placementId: id,
        rect,
      });
    } catch {
      // Invalid bounds or a rejected/stale owner command never become renderer authority.
    } finally {
      // A synchronous owner update is reflected here; otherwise the old scene restores the node.
      restore();
    }
  }

  function loadBackground(scene: RenderScene): void {
    const url = scene.image?.url;
    if (url === imageUrl) return;
    imageRequest += 1;
    const request = imageRequest;
    if (browserImage) {
      browserImage.onload = null;
      browserImage.onerror = null;
    }
    browserImage = undefined;
    imageUrl = url;
    image.visible(false);
    image.image(undefined);
    if (!url || !safeRasterUrl(url)) {
      options.onStatus('missing-image');
      return;
    }
    const candidate = options.imageFactory?.() ?? new globalThis.Image();
    browserImage = candidate;
    candidate.onload = () => {
      if (destroyed || request !== imageRequest) return;
      image.image(candidate);
      image.visible(true);
      draw();
      if (current?.status === 'ready') options.onStatus('ready');
    };
    candidate.onerror = () => {
      if (destroyed || request !== imageRequest) return;
      image.visible(false);
      draw();
      options.onStatus('image-error');
    };
    candidate.src = url;
  }

  function loadArtwork(scene: RenderScene): void {
    const url = scene.artwork?.kind === 'raster' ? scene.artwork.url : undefined;
    if (url === artworkUrl) return;
    artworkRequest += 1;
    const request = artworkRequest;
    if (browserArtwork) {
      browserArtwork.onload = null;
      browserArtwork.onerror = null;
    }
    browserArtwork = undefined;
    artworkUrl = url;
    artworkLoaded = false;
    artworkRaster.visible(false);
    artworkRaster.image(undefined);
    if (!url || !safeRasterUrl(url)) return;
    const candidate = options.imageFactory?.() ?? new globalThis.Image();
    browserArtwork = candidate;
    candidate.onload = () => {
      if (destroyed || request !== artworkRequest) return;
      artworkLoaded = true;
      artworkRaster.image(candidate);
      artworkRaster.visible(true);
      artwork.visible(false);
      draw();
    };
    candidate.onerror = () => {
      if (destroyed || request !== artworkRequest) return;
      artworkLoaded = false;
      artworkRaster.visible(false);
      artwork.visible(true);
      draw();
      options.onStatus('image-error');
    };
    candidate.src = url;
  }

  function releasePlacementArtwork(nodes: ArtworkNodes): void {
    nodes.request += 1;
    if (nodes.image) {
      nodes.image.onload = null;
      nodes.image.onerror = null;
      nodes.image = undefined;
    }
    nodes.raster.image(undefined);
    nodes.raster.visible(false);
    nodes.frame.destroy();
    nodes.raster.destroy();
    nodes.logo.destroy();
  }

  function renderPlacementArtworks(items: NonNullable<RenderScene['artworks']>): void {
    const present = new Set(items.map((item) => item.placementId));
    for (const [id, nodes] of artworkNodes) {
      if (!present.has(id)) {
        releasePlacementArtwork(nodes);
        artworkNodes.delete(id);
      }
    }
    for (const item of items) {
      let nodes = artworkNodes.get(item.placementId);
      if (!nodes) {
        nodes = {
          frame: new konva.Rect({ name: `artwork-frame:${item.placementId}`, listening: false }),
          raster: new konva.Image({ name: `artwork-image:${item.placementId}`, listening: false, visible: false }),
          logo: new konva.Text({
            name: `artwork-logo:${item.placementId}`,
            text: 'LOGO',
            fill: '#17212b',
            fontStyle: 'bold',
            align: 'center',
            verticalAlign: 'middle',
            listening: false,
          }),
          request: 0,
          loaded: false,
        };
        artworkNodes.set(item.placementId, nodes);
        artworkLayer.add(nodes.frame);
        artworkLayer.add(nodes.raster);
        artworkLayer.add(nodes.logo);
      }
      const url = item.kind === 'raster' ? item.url : undefined;
      nodes.frame.setAttrs({
        ...item.bounds,
        fill: item.kind === 'logo-later' ? '#d4d7dc' : '#a9b7ca',
        stroke: '#52616f',
        dash: item.kind === 'logo-later' ? [6, 4] : [],
        visible: item.kind === 'logo-later' || url !== nodes.url || !nodes.loaded,
      });
      nodes.raster.setAttrs({ ...item.bounds });
      nodes.logo.setAttrs({
        ...item.bounds,
        fontSize: Math.max(8, Math.min(item.bounds.width / 4, item.bounds.height / 2)),
        visible: item.kind === 'logo-later',
      });
      if (url === nodes.url) continue;
      nodes.request += 1;
      const request = nodes.request;
      if (nodes.image) {
        nodes.image.onload = null;
        nodes.image.onerror = null;
      }
      nodes.image = undefined;
      nodes.url = url;
      nodes.loaded = false;
      nodes.raster.visible(false);
      nodes.raster.image(undefined);
      if (!url || !safeRasterUrl(url)) continue;
      const target = nodes;
      const candidate = options.imageFactory?.() ?? new globalThis.Image();
      target.image = candidate;
      candidate.onload = () => {
        if (destroyed || request !== target.request || artworkNodes.get(item.placementId) !== target) return;
        target.loaded = true;
        target.raster.image(candidate);
        target.raster.visible(true);
        target.frame.visible(false);
        draw();
      };
      candidate.onerror = () => {
        if (destroyed || request !== target.request || artworkNodes.get(item.placementId) !== target) return;
        target.loaded = false;
        target.raster.visible(false);
        target.frame.visible(true);
        draw();
        options.onStatus('image-error');
      };
      candidate.src = url;
    }
  }

  function render(scene: RenderScene): void {
    if (destroyed) return;
    current = scene;
    const content = scene.contentRect;
    fillViewport();
    if (content) image.setAttrs({ x: content.x, y: content.y, width: content.width, height: content.height });
    loadBackground(scene);
    const legacyArtwork = scene.artworks === undefined ? scene.artwork : undefined;
    loadArtwork({ ...scene, artwork: legacyArtwork });
    renderPlacementArtworks(scene.artworks ?? []);
    if (scene.status !== 'ready') options.onStatus(scene.status);
    if (legacyArtwork) {
      artwork.setAttrs({
        ...legacyArtwork.bounds,
        fill: legacyArtwork.kind === 'logo-later' ? '#d4d7dc' : '#a9b7ca',
        stroke: '#52616f',
        dash: legacyArtwork.kind === 'logo-later' ? [6, 4] : [],
        visible: legacyArtwork.kind === 'logo-later' || !artworkLoaded,
      });
      artworkRaster.setAttrs({ ...legacyArtwork.bounds });
      logoLater.setAttrs({
        ...legacyArtwork.bounds,
        fontSize: Math.max(8, Math.min(legacyArtwork.bounds.width / 4, legacyArtwork.bounds.height / 2)),
        visible: legacyArtwork.kind === 'logo-later',
      });
    } else artwork.visible(false);
    if (!legacyArtwork) logoLater.visible(false);
    message.setAttrs({
      text:
        scene.status === 'missing-geometry'
          ? 'Placement geometry unavailable'
          : scene.status === 'missing-image' || !scene.image?.url
            ? 'Product image unavailable'
            : '',
      x: 12,
      y: 12,
    });

    const visible = new Set<string>();
    let selected: Node | undefined;
    for (const placement of scene.placements) {
      visible.add(placement.id);
      let node = placementNodes.get(placement.id);
      if (!node) {
        const created = new konva.Rect({ name: placement.id });
        node = created;
        placementNodes.set(placement.id, node);
        affordance.add(node);
        const id = placement.id;
        created.on('mousedown touchstart', () => {
          if (mode === 'edit-placement' && current && !current.placements.find((item) => item.id === id)?.selected)
            options.onCommand({ kind: 'select-placement', baseVersion: current.version, placementId: id });
        });
        created.on('click tap', () => {
          try {
            if (mode === 'edit-placement' && current)
              options.onCommand({ kind: 'select-placement', baseVersion: current.version, placementId: id });
          } finally {
            restore();
          }
        });
        created.on('dragstart transformstart', () => setPlacementInteraction(true));
        created.on('dragend transformend', () => {
          try {
            emitRect(id, created);
          } finally {
            setPlacementInteraction(false);
          }
        });
      }
      const appearance = options.placementAppearance?.(placement.id);
      node.setAttrs({
        ...placement.bounds,
        stroke: appearance?.stroke ?? (placement.selected ? '#1769aa' : '#68717a'),
        fill: appearance?.fill ?? 'transparent',
        strokeScaleEnabled: false,
        strokeWidth: placement.selected ? 2 : 1,
        dash: placement.selected ? [] : [5, 4],
        draggable: mode === 'edit-placement',
        listening: mode === 'edit-placement',
        visible: true,
      });
      if (placement.selected) selected = node;
    }
    for (const [id, node] of placementNodes) {
      if (!visible.has(id)) {
        node.destroy();
        placementNodes.delete(id);
      }
    }
    if (mode === 'edit-placement') {
      // Overlapping areas must not intercept the selected area's drag or its resize handles.
      selected?.moveToTop();
      transformer.moveToTop();
    }
    transformer.nodes(mode === 'edit-placement' && selected ? [selected] : []);
    draw();
  }

  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (options.element.clientWidth > 0 && options.element.clientHeight > 0)
            api.resize({
              width: options.element.clientWidth,
              height: options.element.clientHeight,
              pixelRatio: Math.max(1, globalThis.devicePixelRatio || 1),
            });
        });
  const api: Visualizer = {
    update(scene) {
      source = scene;
      render(projectedForViewport(scene));
    },
    resize(next) {
      containFit({ width: 1, height: 1 }, next);
      viewport = next;
      stage.width(next.width);
      stage.height(next.height);
      restore();
    },
    setCamera(camera) {
      if (
        !Number.isFinite(camera.scale) ||
        camera.scale <= 0 ||
        !Number.isFinite(camera.x) ||
        !Number.isFinite(camera.y)
      )
        throw new Error('invalid visualizer camera');
      cameraScale = camera.scale;
      cameraX = camera.x;
      cameraY = camera.y;
      fillViewport();
      const attrs = { x: camera.x, y: camera.y, scaleX: camera.scale, scaleY: camera.scale };
      background.setAttrs(attrs);
      artworkLayer.setAttrs(attrs);
      affordance.setAttrs(attrs);
      transformer.setAttrs({ anchorSize: 10 / camera.scale, borderStrokeWidth: 1 / camera.scale });
      draw();
    },
    cancelInteraction() {
      const previousMode = mode;
      mode = 'preview';
      try {
        for (const node of placementNodes.values()) node.stopDrag();
        transformer.stopTransform();
      } finally {
        for (const node of placementNodes.values()) node.scale({ x: 1, y: 1 });
        mode = previousMode;
        try {
          setPlacementInteraction(false);
        } finally {
          restore();
        }
      }
    },
    setMode(next) {
      mode = next;
      restore();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      imageRequest += 1;
      if (browserImage) {
        browserImage.onload = null;
        browserImage.onerror = null;
      }
      artworkRequest += 1;
      if (browserArtwork) {
        browserArtwork.onload = null;
        browserArtwork.onerror = null;
      }
      for (const nodes of artworkNodes.values()) releasePlacementArtwork(nodes);
      artworkNodes.clear();
      observer?.disconnect();
      stage.destroy();
      placementNodes.clear();
      if (placementInteractionActive) setPlacementInteraction(false);
    },
  };
  observer?.observe(options.element);
  return api;
}
