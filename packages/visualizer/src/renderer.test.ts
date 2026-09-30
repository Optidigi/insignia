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

const konva = {
  Stage: FakeNode,
  Layer: FakeNode,
  Rect: FakeNode,
  Image: FakeNode,
  Text: FakeNode,
  Transformer: FakeNode,
};

describe('imperative renderer boundary', () => {
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
