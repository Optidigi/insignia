import { describe, expect, it } from 'vitest';
import { applyGeometryCommand, type EditorState, type GeometryCommand, projectScene } from './geometry.js';
import { createVisualizerWithKonva } from './renderer.js';

class FakeNode {
  attrs: Record<string, unknown> = {};
  handlers = new Map<string, () => void>();
  children: FakeNode[] = [];
  parent?: FakeNode;
  constructor(attrs: Record<string, unknown> = {}) {
    this.attrs = { ...attrs };
  }
  setAttrs(attrs: Record<string, unknown>) {
    Object.assign(this.attrs, attrs);
  }
  on(events: string, handler: () => void) {
    for (const event of events.split(' ')) this.handlers.set(event, handler);
  }
  fire(event: string) {
    if (event === 'dragstart') this.attrs.dragging = true;
    if (event === 'dragend') this.attrs.dragging = false;
    if (event === 'transformstart') this.attrs.transforming = true;
    if (event === 'transformend') this.attrs.transforming = false;
    this.handlers.get(event)?.();
  }
  stopDrag() {
    this.attrs.stopDragCalls = Number(this.attrs.stopDragCalls ?? 0) + 1;
    if (this.attrs.dragging) this.fire('dragend');
  }
  stopTransform() {
    this.attrs.stopTransformCalls = Number(this.attrs.stopTransformCalls ?? 0) + 1;
    const nodes = (this.attrs.nodes as FakeNode[] | undefined) ?? [];
    for (const node of nodes) {
      if (node.attrs.transforming) node.fire('transformend');
    }
  }
  add(node: FakeNode) {
    node.parent = this;
    this.children.push(node);
  }
  moveToTop() {
    const siblings = this.parent?.children;
    if (!siblings || siblings.at(-1) === this) return false;
    const index = siblings.indexOf(this);
    if (index < 0) return false;
    siblings.splice(index, 1);
    siblings.push(this);
    return true;
  }
  destroy() {
    this.attrs.destroyed = true;
  }
  batchDraw() {}
  x() {
    return Number(this.attrs.x ?? 0);
  }
  y() {
    return Number(this.attrs.y ?? 0);
  }
  width(value?: number) {
    if (value !== undefined) this.attrs.width = value;
    return Number(this.attrs.width ?? 0);
  }
  height(value?: number) {
    if (value !== undefined) this.attrs.height = value;
    return Number(this.attrs.height ?? 0);
  }
  scaleX() {
    return Number(this.attrs.scaleX ?? 1);
  }
  scaleY() {
    return Number(this.attrs.scaleY ?? 1);
  }
  scale(value: { x: number; y: number }) {
    this.attrs.scaleX = value.x;
    this.attrs.scaleY = value.y;
  }
  visible(value: boolean) {
    this.attrs.visible = value;
  }
  image(value: unknown) {
    this.attrs.image = value;
  }
  nodes(value: FakeNode[]) {
    this.attrs.nodes = value;
  }
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture');
  return value;
}

const konva = {
  Stage: FakeNode,
  Layer: FakeNode,
  Rect: FakeNode,
  Image: FakeNode,
  Text: FakeNode,
  Transformer: FakeNode,
};

describe('imperative renderer boundary', () => {
  it.each([
    [undefined, '#f1f2f4'],
    ['transparent', 'transparent'],
  ] as const)('lets the host supply a backdrop without changing the default (%s)', (background, expected) => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture provides the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        background,
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const backdrop = required(required(required(stage).children[0]).children[0]);
    expect(backdrop.attrs.fill).toBe(expected);
    expect(backdrop.attrs.listening).toBe(false);
    renderer.setCamera({ scale: 2, x: -30, y: 10 });
    renderer.resize({ width: 600, height: 400, pixelRatio: 1 });
    expect(backdrop.attrs.fill).toBe(expected);
    renderer.destroy();
  });

  it('selects an unselected area on pointer down before dragging, only in edit mode', () => {
    let stage: FakeNode | undefined;
    const commands: GeometryCommand[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture provides the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: (command) => commands.push(command),
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.update({
      version: 3,
      status: 'ready',
      placements: [{ id: 'chest', selected: false, bounds: { x: 40, y: 50, width: 100, height: 80 } }],
    });
    const area = required(required(required(stage).children[2]).children.find((node) => node.attrs.name === 'chest'));
    area.fire('mousedown');
    expect(commands).toEqual([]);
    renderer.setMode('edit-placement');
    area.fire('mousedown');
    expect(commands).toEqual([{ kind: 'select-placement', baseVersion: 3, placementId: 'chest' }]);
    renderer.destroy();
  });
  it('uses placement appearances while keeping the selected outline and default appearance clear', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
        placementAppearance: (id) =>
          id === 'chest' ? { stroke: '#b42318', fill: '#fee4e2' } : { stroke: '#027a48', fill: '#d1fadf' },
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 1,
      status: 'ready',
      placements: [
        { id: 'chest', selected: true, bounds: { x: 20, y: 30, width: 80, height: 60 } },
        { id: 'back', selected: false, bounds: { x: 120, y: 30, width: 100, height: 80 } },
      ],
    });
    const layer = required(required(stage).children[2]);
    const chest = required(layer.children.find((node) => node.attrs.name === 'chest'));
    const back = required(layer.children.find((node) => node.attrs.name === 'back'));
    expect(chest.attrs).toMatchObject({ stroke: '#b42318', fill: '#fee4e2', strokeWidth: 2 });
    expect(back.attrs).toMatchObject({ stroke: '#027a48', fill: '#d1fadf', strokeWidth: 1 });
    expect(layer.children.at(-1)?.attrs.nodes).toEqual([chest]);
    renderer.destroy();

    let defaultsStage: FakeNode | undefined;
    const defaults = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            defaultsStage = this;
          }
        },
      },
    );
    defaults.update({
      version: 1,
      status: 'ready',
      placements: [
        { id: 'selected', selected: true, bounds: { x: 20, y: 30, width: 80, height: 60 } },
        { id: 'unselected', selected: false, bounds: { x: 120, y: 30, width: 100, height: 80 } },
      ],
    });
    const defaultLayer = required(required(defaultsStage).children[2]);
    expect(defaultLayer.children.find((node) => node.attrs.name === 'selected')?.attrs).toMatchObject({
      stroke: '#1769aa',
      fill: 'transparent',
      strokeWidth: 2,
    });
    expect(defaultLayer.children.find((node) => node.attrs.name === 'unselected')?.attrs).toMatchObject({
      stroke: '#68717a',
      fill: 'transparent',
      strokeWidth: 1,
    });
    defaults.destroy();
  });
  it('supports independent placement resizing from edge and corner handles with a positive pixel minimum', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 1,
      status: 'ready',
      placements: [{ id: 'chest', selected: true, bounds: { x: 20, y: 30, width: 80, height: 60 } }],
    });
    const layer = required(required(stage).children[2]);
    const transformer = required(layer.children.find((node) => Array.isArray(node.attrs.enabledAnchors)));
    expect(transformer.attrs.keepRatio).toBe(false);
    expect(transformer.attrs.enabledAnchors).toEqual([
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]);
    type Bounds = { x: number; y: number; width: number; height: number };
    const boundBoxFunc = transformer.attrs.boundBoxFunc as ((oldBox: Bounds, newBox: Bounds) => Bounds) | undefined;
    if (!boundBoxFunc) throw new Error('Missing transformer bounds guard');
    const oldBox = { x: 20, y: 30, width: 80, height: 60 };
    expect(boundBoxFunc(oldBox, { ...oldBox, width: 0 })).toBe(oldBox);
    const narrower = { ...oldBox, width: 24 };
    expect(boundBoxFunc(oldBox, narrower)).toBe(narrower);
    renderer.destroy();
  });
  it('keeps resize handles and their hit targets screen-sized at any camera zoom', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 1,
      status: 'ready',
      placements: [{ id: 'chest', selected: true, bounds: { x: 20, y: 30, width: 80, height: 60 } }],
    });
    const transformer = required(
      required(required(stage).children[2]).children.find((node) => Array.isArray(node.attrs.enabledAnchors)),
    );
    const styleAnchor = transformer.attrs.anchorStyleFunc as ((anchor: FakeNode) => void) | undefined;
    if (!styleAnchor) throw new Error('Missing transformer anchor hit-area styling');
    const rightEdge = new FakeNode({ name: 'middle-right _anchor' });
    styleAnchor(rightEdge);
    expect(transformer.attrs.anchorSize).toBe(10);
    expect(rightEdge.attrs.hitStrokeWidth).toBe(24);

    renderer.setCamera({ scale: 2, x: -10, y: -20 });
    expect(transformer.attrs.anchorSize).toBe(5);
    const zoomedCorner = new FakeNode({ name: 'bottom-right _anchor' });
    styleAnchor(zoomedCorner);
    expect(zoomedCorner.attrs.hitStrokeWidth).toBe(12);
    renderer.destroy();
  });
  it('applies camera changes to layers without resizing the stage, reloading images, or changing normalized edits', () => {
    let stage: FakeNode | undefined;
    const images: HTMLImageElement[] = [];
    const commands: GeometryCommand[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: (command) => commands.push(command),
        onStatus: () => {},
        imageFactory: () => {
          // @ts-expect-error Deterministic image transport omits unrelated DOM methods.
          const candidate: HTMLImageElement = { onload: null, onerror: null, src: '' };
          images.push(candidate);
          return candidate;
        },
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 4,
      status: 'ready',
      viewId: 'front',
      contentRect: { x: 100, y: 0, width: 300, height: 300 },
      image: { revisionId: 'product', width: 100, height: 100, url: 'https://assets.test/product.png' },
      placements: [{ id: 'chest', selected: true, bounds: { x: 160, y: 90, width: 120, height: 90 } }],
    });
    const root = required(stage);
    const background = required(root.children[0]);
    const artwork = required(root.children[1]);
    const affordance = required(root.children[2]);
    const placement = required(affordance.children.find((node) => node.attrs.name === 'chest'));
    expect(images).toHaveLength(1);
    renderer.setCamera({ scale: 2, x: -10, y: -20 });
    for (const layer of [background, artwork, affordance]) {
      expect(layer.attrs).toMatchObject({ x: -10, y: -20, scaleX: 2, scaleY: 2 });
    }
    const backdrop = required(background.children[0]);
    expect(backdrop.attrs).toMatchObject({ x: 5, y: 10, width: 250, height: 150 });
    expect(root.attrs).toMatchObject({ width: 500, height: 300 });
    expect(images).toHaveLength(1);
    expect(placement.attrs).toMatchObject({ x: 160, y: 90, width: 120, height: 90 });
    expect(required(affordance.children.at(-1)).attrs).toMatchObject({ anchorSize: 5, borderStrokeWidth: 0.5 });

    placement.attrs.x = 180;
    placement.attrs.y = 100;
    placement.attrs.width = 150;
    placement.fire('dragend');
    expect(commands.at(-1)).toMatchObject({
      kind: 'set-placement-rect',
      baseVersion: 4,
      rect: { centerX: 155 / 300, centerY: 145 / 300, width: 0.5, height: 0.3 },
    });
    expect(images).toHaveLength(1);
    expect(backdrop.attrs).toMatchObject({ x: 5, y: 10, width: 250, height: 150 });
    renderer.resize({ width: 800, height: 600, pixelRatio: 1 });
    expect(backdrop.attrs).toMatchObject({ x: 5, y: 10, width: 400, height: 300 });
    expect(() => renderer.setCamera({ scale: 0, x: 0, y: 0 })).toThrow();
    expect(() => renderer.setCamera({ scale: Number.NaN, x: 0, y: 0 })).toThrow();
    expect(() => renderer.setCamera({ scale: 1, x: Number.POSITIVE_INFINITY, y: 0 })).toThrow();
    expect(background.attrs.scaleX).toBe(2);
    renderer.destroy();
  });
  it('reports placement interaction start and end for move, resize, and destroy', () => {
    let stage: FakeNode | undefined;
    const interactions: boolean[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {
          throw new Error('Rejected edit');
        },
        onStatus: () => {},
        onPlacementInteraction: (active) => interactions.push(active),
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 1,
      status: 'ready',
      placements: [{ id: 'chest', selected: true, bounds: { x: 20, y: 30, width: 80, height: 60 } }],
    });
    const chest = required(required(required(stage).children[2]).children.find((node) => node.attrs.name === 'chest'));
    chest.fire('dragstart');
    expect(interactions).toEqual([true]);
    chest.attrs.x = 24;
    chest.fire('dragend');
    expect(interactions).toEqual([true, false]);

    chest.fire('transformstart');
    expect(interactions).toEqual([true, false, true]);
    chest.attrs.scaleX = 1.1;
    chest.fire('transformend');
    expect(interactions).toEqual([true, false, true, false]);

    chest.fire('dragstart');
    expect(interactions).toEqual([true, false, true, false, true]);
    renderer.destroy();
    expect(interactions).toEqual([true, false, true, false, true, false]);
  });
  it('cancels interrupted placement edits without committing and restores the authoritative rectangle', () => {
    let stage: FakeNode | undefined;
    const commands: GeometryCommand[] = [];
    const interactions: boolean[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: (command) => commands.push(command),
        onStatus: () => {},
        onPlacementInteraction: (active) => interactions.push(active),
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update({
      version: 1,
      status: 'ready',
      viewId: 'front',
      contentRect: { x: 0, y: 0, width: 100, height: 100 },
      placements: [{ id: 'chest', selected: true, bounds: { x: 20, y: 30, width: 40, height: 30 } }],
    });
    const layer = required(required(stage).children[2]);
    const chest = required(layer.children.find((node) => node.attrs.name === 'chest'));
    const transformer = required(layer.children.find((node) => Array.isArray(node.attrs.enabledAnchors)));

    chest.fire('dragstart');
    chest.attrs.x = 35;
    renderer.cancelInteraction();
    expect(commands).toEqual([]);
    expect(interactions).toEqual([true, false]);
    expect(chest.attrs).toMatchObject({ x: 20, y: 30, width: 40, height: 30, scaleX: 1, scaleY: 1 });
    expect(chest.attrs.stopDragCalls).toBe(1);
    expect(transformer.attrs.stopTransformCalls).toBe(1);

    chest.fire('transformstart');
    chest.attrs.x = 25;
    chest.attrs.scaleX = 1.5;
    chest.attrs.scaleY = 1.25;
    renderer.cancelInteraction();
    expect(commands).toEqual([]);
    expect(interactions).toEqual([true, false, true, false]);
    expect(chest.attrs).toMatchObject({ x: 20, y: 30, width: 40, height: 30, scaleX: 1, scaleY: 1 });
    expect(transformer.attrs.stopTransformCalls).toBe(2);
    renderer.destroy();
  });
  it('renders two independently bounded LOGO placeholders and an empty array hides the legacy artwork', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the element dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const left = { x: 40, y: 50, width: 120, height: 80 };
    const right = { x: 230, y: 70, width: 90, height: 60 };
    renderer.update({
      version: 1,
      status: 'ready',
      placements: [],
      artwork: { kind: 'logo-later', bounds: left },
      artworks: [
        { placementId: 'chest', kind: 'logo-later', bounds: left },
        { placementId: 'sleeve', kind: 'logo-later', bounds: right },
      ],
    });
    const logos = required(required(stage).children[1]).children.filter(
      (node) => node.attrs.text === 'LOGO' && node.attrs.visible,
    );
    expect(logos).toHaveLength(2);
    expect(required(logos[0]).attrs).toMatchObject({
      ...left,
      visible: true,
      fontStyle: 'bold',
      align: 'center',
      verticalAlign: 'middle',
    });
    expect(required(logos[1]).attrs).toMatchObject({
      ...right,
      visible: true,
      fontStyle: 'bold',
      align: 'center',
      verticalAlign: 'middle',
    });
    renderer.update({
      version: 2,
      status: 'ready',
      placements: [],
      artwork: { kind: 'logo-later', bounds: left },
      artworks: [],
    });
    expect(logos.every((node) => node.attrs.destroyed)).toBe(true);
    expect(
      required(required(stage).children[1]).children.filter(
        (node) => node.attrs.text === 'LOGO' && node.attrs.visible && !node.attrs.destroyed,
      ),
    ).toHaveLength(0);
    renderer.destroy();
  });
  it('loads mixed placement rasters independently, ignores stale completion and disposes removed nodes', () => {
    let stage: FakeNode | undefined;
    const images: HTMLImageElement[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies only the renderer's measured dimensions.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
        imageFactory: () => {
          // @ts-expect-error This deterministic image transport double deliberately omits unrelated DOM methods.
          const candidate: HTMLImageElement = { onload: null, onerror: null, src: '' };
          images.push(candidate);
          return candidate;
        },
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const bounds = { x: 40, y: 50, width: 120, height: 80 };
    const logo = { placementId: 'logo', kind: 'logo-later' as const, bounds };
    const left = { placementId: 'left', kind: 'raster' as const, bounds, url: 'https://assets.test/left-old.png' };
    const right = {
      placementId: 'right',
      kind: 'raster' as const,
      bounds: { ...bounds, x: 230 },
      url: 'https://assets.test/right.png',
    };
    renderer.update({ version: 1, status: 'ready', placements: [], artworks: [logo, left, right] });
    expect(images).toHaveLength(2);
    const staleLoad = required(required(images[0]).onload);
    const leftNode = required(
      required(required(stage).children[1]).children.find((node) => node.attrs.name === 'artwork-image:left'),
    );
    const rightNode = required(
      required(required(stage).children[1]).children.find((node) => node.attrs.name === 'artwork-image:right'),
    );
    const rightFrame = required(
      required(required(stage).children[1]).children.find((node) => node.attrs.name === 'artwork-frame:right'),
    );
    expect(rightFrame.attrs.visible).toBe(true);

    renderer.update({
      version: 2,
      status: 'ready',
      placements: [],
      artworks: [logo, { ...left, url: 'https://assets.test/left-new.png' }, right],
    });
    expect(images).toHaveLength(3);
    expect(required(images[0]).onload).toBeNull();
    staleLoad.call(required(images[0]), new Event('load'));
    expect(leftNode.attrs.visible).toBe(false);
    required(required(images[1]).onload).call(required(images[1]), new Event('load'));
    expect(rightNode.attrs).toMatchObject({ visible: true, image: images[1] });
    expect(rightFrame.attrs.visible).toBe(false);
    renderer.resize({ width: 300, height: 200, pixelRatio: 1 });
    expect(rightFrame.attrs.visible).toBe(false);

    const removedLoad = required(required(images[2]).onload);
    required(required(images[2]).onload).call(required(images[2]), new Event('load'));
    expect(leftNode.attrs).toMatchObject({ visible: true, image: images[2] });
    renderer.update({ version: 3, status: 'ready', placements: [], artworks: [logo, right] });
    expect(required(images[2]).onload).toBeNull();
    expect(required(images[2]).onerror).toBeNull();
    expect(
      required(required(stage).children[1])
        .children.filter((node) => String(node.attrs.name).endsWith(':left'))
        .every((node) => node.attrs.destroyed),
    ).toBe(true);
    removedLoad.call(required(images[2]), new Event('load'));
    expect(leftNode.attrs.visible).toBe(false);
    expect(leftNode.attrs.image).toBeUndefined();
    expect(rightNode.attrs).toMatchObject({ visible: true, image: images[1] });
    const failed = { ...right, url: 'https://assets.test/right-failed.png' };
    renderer.update({ version: 4, status: 'ready', placements: [], artworks: [failed] });
    expect(rightFrame.attrs.visible).toBe(true);
    required(required(images[3]).onerror).call(required(images[3]), new Event('error'));
    expect(rightFrame.attrs.visible).toBe(true);
    renderer.update({ version: 5, status: 'ready', placements: [], artworks: [failed] });
    expect(rightFrame.attrs.visible).toBe(true);
    renderer.destroy();
    expect(required(images[1]).onload).toBeNull();
    expect(required(images[1]).onerror).toBeNull();
    expect(rightNode.attrs.destroyed).toBe(true);
  });

  it('shows the single-artwork placeholder only while raster artwork is unavailable', () => {
    let stage: FakeNode | undefined;
    const images: HTMLImageElement[] = [];
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies only measured renderer dimensions.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
        imageFactory: () => {
          // @ts-expect-error Deterministic image transport omits unrelated DOM methods.
          const candidate: HTMLImageElement = { onload: null, onerror: null, src: '' };
          images.push(candidate);
          return candidate;
        },
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const scene = {
      version: 1,
      status: 'ready' as const,
      placements: [],
      artwork: {
        kind: 'raster' as const,
        url: 'https://assets.test/logo.png',
        bounds: { x: 40, y: 50, width: 120, height: 80 },
      },
    };
    renderer.update(scene);
    const frame = required(required(required(stage).children[1]).children[0]);
    expect(frame.attrs.visible).toBe(true);
    required(required(images[0]).onload).call(required(images[0]), new Event('load'));
    expect(frame.attrs.visible).toBe(false);
    renderer.resize({ width: 300, height: 200, pixelRatio: 1 });
    expect(frame.attrs.visible).toBe(false);
    renderer.update({ ...scene, version: 2 });
    expect(frame.attrs.visible).toBe(false);
    const replacement = {
      ...scene,
      version: 3,
      artwork: { ...scene.artwork, url: 'https://assets.test/replacement.png' },
    };
    renderer.update(replacement);
    expect(frame.attrs.visible).toBe(true);
    required(required(images[1]).onerror).call(required(images[1]), new Event('error'));
    expect(frame.attrs.visible).toBe(true);
    renderer.update({ ...replacement, version: 4 });
    expect(frame.attrs.visible).toBe(true);
    renderer.update({ ...scene, version: 5, artwork: { ...scene.artwork, url: 'https://assets.test/final.png' } });
    required(required(images[2]).onload).call(required(images[2]), new Event('load'));
    expect(frame.attrs.visible).toBe(false);
    renderer.update({ ...scene, version: 6, artwork: { kind: 'logo-later', bounds: scene.artwork.bounds } });
    expect(frame.attrs.visible).toBe(true);
    renderer.destroy();
  });

  it('resizes every placement from original bounds without mutating the scene', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the element dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const scene = {
      version: 1,
      status: 'ready' as const,
      placements: [],
      image: { revisionId: 'image', width: 100, height: 100 },
      contentRect: { x: 100, y: 0, width: 300, height: 300 },
      artworks: [
        { placementId: 'left', kind: 'logo-later' as const, bounds: { x: 130, y: 30, width: 60, height: 60 } },
        { placementId: 'right', kind: 'logo-later' as const, bounds: { x: 280, y: 180, width: 90, height: 60 } },
      ],
    };
    const original = structuredClone(scene);
    renderer.update(scene);
    renderer.resize({ width: 200, height: 200, pixelRatio: 1 });
    const logos = required(required(stage).children[1]).children.filter(
      (node) => node.attrs.text === 'LOGO' && node.attrs.visible,
    );
    expect(required(logos[0]).attrs).toMatchObject({ x: 20, y: 20, width: 40, height: 40 });
    expect(required(logos[1]).attrs).toMatchObject({ x: 120, y: 120, width: 60, height: 40 });
    expect(scene).toEqual(original);
    renderer.destroy();
  });

  it('shows bounded LOGO text for logo-later and removes it when the artwork choice changes', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies the element dimensions consumed by the renderer.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const bounds = { x: 40, y: 50, width: 120, height: 80 };
    renderer.update({ version: 1, status: 'ready', placements: [], artwork: { kind: 'logo-later', bounds } });
    const logo = stage?.children[1]?.children.find((node) => node.attrs.text === 'LOGO');
    expect(logo?.attrs).toMatchObject({
      ...bounds,
      visible: true,
      align: 'center',
      verticalAlign: 'middle',
      fontStyle: 'bold',
    });
    renderer.update({ version: 2, status: 'ready', placements: [] });
    expect(logo?.attrs.visible).toBe(false);
    renderer.destroy();
  });
  it('keeps the selected area and resize handles above overlapping areas without enabling preview interactions', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies only measured renderer dimensions.
        element: { clientWidth: 300, clientHeight: 300 },
        onCommand: () => {},
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      },
    );
    const bounds = { x: 90, y: 90, width: 90, height: 90 };
    const areas = [
      { id: 'chest', bounds, selected: true },
      { id: 'belly', bounds: { x: 60, y: 60, width: 180, height: 180 }, selected: false },
    ];
    renderer.setMode('edit-placement');
    renderer.update({ version: 1, status: 'ready', placements: areas });
    const layer = required(required(stage).children[2]);
    expect(layer.children.at(-2)?.attrs.name).toBe('chest');
    expect(layer.children.at(-1)?.attrs.nodes).toEqual([layer.children.at(-2)]);
    renderer.update({
      version: 2,
      status: 'ready',
      placements: areas.map((area) => ({ ...area, selected: area.id === 'belly' })),
    });
    expect(layer.children.at(-2)?.attrs.name).toBe('belly');
    renderer.setMode('preview');
    expect(
      layer.children.filter((node) => node.attrs.name).every((node) => !node.attrs.listening && !node.attrs.draggable),
    ).toBe(true);
    expect(layer.children.at(-1)?.attrs.nodes).toEqual([]);
    renderer.destroy();
  });
  it('emits normalized edits and redraws from the owner scene after rerender', () => {
    const state: EditorState = {
      version: 7,
      geometry: {
        version: 'm5-geometry-v1',
        views: [
          {
            id: 'front',
            image: { revisionId: 'shirt', width: 800, height: 1000 },
            variantImages: [],
            placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 } }],
          },
        ],
        steps: [],
      },
      viewId: 'front',
      selectedPlacementId: 'chest',
      artwork: { kind: 'none' },
    };
    const commands: GeometryCommand[] = [];
    const stage = new FakeNode();
    let actualStage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      {
        // @ts-expect-error Node-only fixture supplies only the renderer's measured dimensions.
        element: { clientWidth: 500, clientHeight: 300 },
        onCommand: (command) => commands.push(command),
        onStatus: () => {},
      },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            actualStage = this;
            stage.children = this.children;
          }
        },
      },
    );
    renderer.setMode('edit-placement');
    renderer.update(projectScene(state, { width: 500, height: 300, pixelRatio: 1 }));
    const layer = stage.children[2];
    if (!layer) throw new Error('missing affordance layer');
    const placement = layer.children.find((node) => node.attrs.name === 'chest');
    if (!placement) throw new Error('missing placement node');
    placement.attrs.x = 154;
    placement.fire('dragend');
    expect(commands[0]).toMatchObject({
      kind: 'set-placement-rect',
      baseVersion: 7,
      placementId: 'chest',
      rect: { centerX: 0.3, centerY: 0.5, width: 0.4, height: 0.3 },
    });
    expect(placement.attrs.x).toBe(202);
    const command = commands[0];
    if (!command) throw new Error('missing geometry command');
    const owner = applyGeometryCommand(state, command);
    renderer.update(projectScene(owner, { width: 500, height: 300, pixelRatio: 1 }));
    expect(placement.attrs.x).toBe(154);
    placement.attrs.scaleX = 1.5;
    placement.attrs.scaleY = 0.5;
    placement.fire('transformend');
    expect(commands[1]).toMatchObject({
      kind: 'set-placement-rect',
      baseVersion: 8,
      rect: { centerX: 0.4, centerY: 0.425, width: 0.6, height: 0.15 },
    });
    expect(placement.attrs.width).toBe(96);
    renderer.resize({ width: 300, height: 500, pixelRatio: 3 });
    expect(placement.attrs.x).toBe(30);
    renderer.update(projectScene(state, { width: 500, height: 300, pixelRatio: 1 }));
    expect(placement.attrs.x).toBe(90);
    placement.fire('click');
    expect(commands[2]).toMatchObject({ kind: 'select-placement', baseVersion: 7, placementId: 'chest' });
    renderer.destroy();
    expect(actualStage?.attrs.destroyed).toBe(true);
  });
});
