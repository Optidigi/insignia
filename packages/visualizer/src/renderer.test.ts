import { describe, expect, it } from 'vitest';
import { applyGeometryCommand, type EditorState, type GeometryCommand, projectScene } from './geometry.js';
import { createVisualizerWithKonva } from './renderer.js';

class FakeNode {
  attrs: Record<string, unknown> = {};
  handlers = new Map<string, () => void>();
  children: FakeNode[] = [];
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
    this.handlers.get(event)?.();
  }
  add(node: FakeNode) {
    this.children.push(node);
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
  it('renders two independently bounded LOGO placeholders and an empty array hides the legacy artwork', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      { element: { clientWidth: 500, clientHeight: 300 } as HTMLElement, onCommand: () => {}, onStatus: () => {} },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      } as never,
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
        element: { clientWidth: 500, clientHeight: 300 } as HTMLElement,
        onCommand: () => {},
        onStatus: () => {},
        imageFactory: () => {
          const candidate = { onload: null, onerror: null, src: '' } as unknown as HTMLImageElement;
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
      } as never,
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
    renderer.destroy();
    expect(required(images[1]).onload).toBeNull();
    expect(required(images[1]).onerror).toBeNull();
    expect(rightNode.attrs.destroyed).toBe(true);
  });

  it('resizes every placement from original bounds without mutating the scene', () => {
    let stage: FakeNode | undefined;
    const renderer = createVisualizerWithKonva(
      { element: { clientWidth: 500, clientHeight: 300 } as HTMLElement, onCommand: () => {}, onStatus: () => {} },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      } as never,
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
      { element: { clientWidth: 500, clientHeight: 300 } as HTMLElement, onCommand: () => {}, onStatus: () => {} },
      {
        ...konva,
        Stage: class extends FakeNode {
          constructor(attrs: Record<string, unknown>) {
            super(attrs);
            stage = this;
          }
        },
      } as never,
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
        element: { clientWidth: 500, clientHeight: 300 } as HTMLElement,
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
      } as never,
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
