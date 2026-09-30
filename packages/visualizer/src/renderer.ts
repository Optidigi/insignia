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
  on(events: string, handler: () => void): void;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  scaleX(): number;
  scaleY(): number;
  scale(values: { x: number; y: number }): void;
  visible(value: boolean): void;
  image(value: HTMLImageElement | undefined): void;
  destroy(): void;
};
type Container = { add(node: Node): void; destroy(): void; batchDraw(): void };
type Stage = Container & { width(value: number): void; height(value: number): void };
type Transformer = Node & { nodes(value: Node[]): void };
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
  setMode(mode: 'preview' | 'edit-placement'): void;
  destroy(): void;
}

export interface VisualizerOptions {
  element: HTMLElement;
  onCommand(command: GeometryCommand): void;
  onStatus(status: RenderStatus): void;
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
  let imageRequest = 0;
  let imageUrl: string | undefined;
  let browserImage: HTMLImageElement | undefined;
  let artworkRequest = 0;
  let artworkUrl: string | undefined;
  let browserArtwork: HTMLImageElement | undefined;
  let destroyed = false;
  const stage = new konva.Stage({ container: options.element, width: viewport.width, height: viewport.height });
  const background = new konva.Layer();
  const artworkLayer = new konva.Layer();
  const affordance = new konva.Layer();
  stage.add(background as unknown as Node);
  stage.add(artworkLayer as unknown as Node);
  stage.add(affordance as unknown as Node);
  const fallback = new konva.Rect({ fill: '#f1f2f4', listening: false });
  const image = new konva.Image({ listening: false, visible: false });
  const artwork = new konva.Rect({ listening: false, visible: false });
  const artworkRaster = new konva.Image({ listening: false, visible: false });
  const message = new konva.Text({ text: '', fill: '#5b6470', fontSize: 14, listening: false });
  background.add(fallback);
  background.add(image);
  artworkLayer.add(artwork);
  artworkLayer.add(artworkRaster);
  artworkLayer.add(message);
  const transformer = new konva.Transformer({
    rotateEnabled: false,
    flipEnabled: false,
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  });
  affordance.add(transformer);
  const placementNodes = new Map<string, Node>();

  function draw(): void {
    background.batchDraw();
    artworkLayer.batchDraw();
    affordance.batchDraw();
  }

  function projectedForViewport(scene: RenderScene): RenderScene {
    if (!scene.image || !scene.contentRect) return scene;
    const contentRect = containFit(scene.image, viewport);
    const from = scene.contentRect;
    return {
      ...scene,
      contentRect,
      placements: scene.placements.map((item) => ({ ...item, bounds: mapRect(item.bounds, from, contentRect) })),
      artwork: scene.artwork
        ? { ...scene.artwork, bounds: mapRect(scene.artwork.bounds, from, contentRect) }
        : undefined,
    };
  }

  function restore(): void {
    if (source) render(projectedForViewport(source));
  }

  function emitRect(id: string, node: Node): void {
    if (!current?.contentRect || !current.viewId || mode !== 'edit-placement') return;
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
    const candidate = new globalThis.Image();
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
    artworkRaster.visible(false);
    artworkRaster.image(undefined);
    if (!url || !safeRasterUrl(url)) return;
    const candidate = new globalThis.Image();
    browserArtwork = candidate;
    candidate.onload = () => {
      if (destroyed || request !== artworkRequest) return;
      artworkRaster.image(candidate);
      artworkRaster.visible(true);
      draw();
    };
    candidate.onerror = () => {
      if (destroyed || request !== artworkRequest) return;
      artworkRaster.visible(false);
      draw();
      options.onStatus('image-error');
    };
    candidate.src = url;
  }

  function render(scene: RenderScene): void {
    if (destroyed) return;
    current = scene;
    const content = scene.contentRect;
    fallback.setAttrs({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    if (content) image.setAttrs({ x: content.x, y: content.y, width: content.width, height: content.height });
    loadBackground(scene);
    loadArtwork(scene);
    if (scene.status !== 'ready') options.onStatus(scene.status);
    if (scene.artwork) {
      artwork.setAttrs({
        ...scene.artwork.bounds,
        fill: scene.artwork.kind === 'logo-later' ? '#d4d7dc' : '#a9b7ca',
        stroke: '#52616f',
        dash: scene.artwork.kind === 'logo-later' ? [6, 4] : [],
        visible: true,
      });
      artworkRaster.setAttrs({ ...scene.artwork.bounds });
    } else artwork.visible(false);
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
        created.on('click tap', () => {
          try {
            if (mode === 'edit-placement' && current)
              options.onCommand({ kind: 'select-placement', baseVersion: current.version, placementId: id });
          } finally {
            restore();
          }
        });
        created.on('dragend transformend', () => emitRect(id, created));
      }
      node.setAttrs({
        ...placement.bounds,
        stroke: placement.selected ? '#1769aa' : '#68717a',
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
      observer?.disconnect();
      stage.destroy();
      placementNodes.clear();
    },
  };
  observer?.observe(options.element);
  return api;
}
