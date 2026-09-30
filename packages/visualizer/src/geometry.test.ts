import { describe, expect, it } from 'vitest';
import {
  applyGeometryCommand,
  containFit,
  type EditorState,
  normalizedToRendered,
  projectScene,
  renderedToNormalized,
  validateGeometry,
  validateGeometryBridge,
} from './geometry.js';

const chest = { id: 'chest', rect: { centerX: 0.5, centerY: 0.4, width: 0.4, height: 0.3 } };
const front = {
  id: 'front',
  image: { revisionId: 'front-blue', width: 800, height: 1000 },
  variantImages: [{ variantId: 'red', image: { revisionId: 'front-red', width: 800, height: 1000 } }],
  placements: [chest],
};
const geometry = {
  version: 'm5-geometry-v1' as const,
  views: [
    front,
    {
      id: 'back',
      image: { revisionId: 'back-blue', width: 800, height: 1000 },
      variantImages: [],
      placements: [{ id: 'back-print', rect: { centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.4 } }],
    },
  ],
  steps: [
    { id: 'small', widthFraction: 0.5, heightFraction: 0.5 },
    { id: 'large', widthFraction: 1, heightFraction: 1 },
  ],
};

const state: EditorState = {
  version: 1,
  geometry,
  viewId: 'front',
  selectedPlacementId: 'chest',
  selectedStepId: 'small',
  artwork: { kind: 'logo-later' },
};

describe('geometry boundary', () => {
  it('maps through the contained image, including letterbox, independent of DPR', () => {
    const content = containFit({ width: 800, height: 1000 }, { width: 500, height: 300, pixelRatio: 3 });
    expect(content).toEqual({ x: 130, y: 0, width: 240, height: 300 });
    const normalized = { centerX: 0.5, centerY: 0.4, width: 0.4, height: 0.3 };
    expect(normalizedToRendered(normalized, content)).toEqual({ x: 202, y: 75, width: 96, height: 90 });
    expect(renderedToNormalized(normalizedToRendered(normalized, content), content)).toEqual(normalized);
    expect(containFit({ width: 800, height: 1000 }, { width: 300, height: 500, pixelRatio: 1 })).toEqual({
      x: 0,
      y: 62.5,
      width: 300,
      height: 375,
    });
  });

  it('rejects extents outside the image and malformed versioned input', () => {
    expect(() =>
      validateGeometry({
        ...geometry,
        views: [
          {
            ...front,
            placements: [{ id: 'chest', rect: { centerX: 0.9, centerY: 0.5, width: 0.4, height: 0.3 } }],
          },
        ],
      }),
    ).toThrow();
    expect(() => validateGeometry({ ...geometry, version: 'future' })).toThrow();
    expect(() => validateGeometry({ ...geometry, views: [] })).toThrow();
    expect(() =>
      validateGeometry({ ...geometry, steps: [{ id: 'small', widthFraction: Number.NaN, heightFraction: 1 }] }),
    ).toThrow();
  });

  it('rejects stored URL/markup fields and accepts one placement projected in two views', () => {
    expect(() => validateGeometry({ ...geometry, artworkSvg: '<svg />' } as typeof geometry)).toThrow();
    expect(() =>
      validateGeometry({
        ...geometry,
        views: [{ ...front, image: { ...front.image, url: 'https://outside.example/art' } }],
      } as typeof geometry),
    ).toThrow();
    const twoViews = {
      ...geometry,
      views: [
        front,
        {
          ...geometry.views[1]!,
          placements: [{ ...chest, rect: { ...chest.rect, centerY: 0.6 } }],
        },
      ],
    };
    expect(() =>
      validateGeometryBridge(twoViews, {
        version: 'm2-published-config-v1',
        placements: [{ id: 'chest', allowedStepIds: ['small'] }],
      }),
    ).not.toThrow();
  });

  it('bridges every M2 placement and permitted step to geometry without changing M2', () => {
    expect(() =>
      validateGeometryBridge(geometry, {
        version: 'm2-published-config-v1',
        placements: [
          { id: 'chest', allowedStepIds: ['small', 'large'] },
          { id: 'back-print', allowedStepIds: ['small'] },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validateGeometryBridge(geometry, {
        version: 'm2-published-config-v1',
        placements: [
          { id: 'chest', allowedStepIds: ['unknown'] },
          { id: 'back-print', allowedStepIds: [] },
        ],
      }),
    ).toThrow('missing decoration step geometry');
    expect(() =>
      validateGeometryBridge(geometry, {
        version: 'm2-published-config-v1',
        placements: [{ id: 'chest', allowedStepIds: [] }],
      }),
    ).toThrow('geometry placement IDs');
  });

  it('projects step, selected region, placeholder, and variant image deterministically', () => {
    const first = projectScene(state, { width: 500, height: 300, pixelRatio: 2 });
    expect(first.status).toBe('ready');
    expect(first.placements[0]).toMatchObject({
      id: 'chest',
      selected: true,
      bounds: { x: 202, y: 75, width: 96, height: 90 },
    });
    expect(first.artwork).toMatchObject({ kind: 'logo-later', bounds: { x: 226, y: 97.5, width: 48, height: 45 } });
    expect(projectScene(state, { width: 500, height: 300, pixelRatio: 2 })).toEqual(first);
    const red = projectScene({ ...state, variantId: 'red' }, { width: 500, height: 300, pixelRatio: 1 });
    expect(red.image?.revisionId).toBe('front-red');
    expect(red.placements[0]?.bounds).toEqual(first.placements[0]?.bounds);
    expect(
      projectScene(
        { ...state, viewId: 'back', selectedPlacementId: 'back-print' },
        { width: 500, height: 300, pixelRatio: 1 },
      ).placements[0]?.id,
    ).toBe('back-print');
  });

  it('distinguishes missing image and geometry from a valid empty placement view', () => {
    const viewport = { width: 300, height: 400, pixelRatio: 1 };
    expect(projectScene({ ...state, viewId: 'unknown' }, viewport).status).toBe('missing-geometry');
    expect(projectScene({ ...state, selectedPlacementId: 'unknown' }, viewport).status).toBe('missing-geometry');
    const withoutImage = { ...geometry, views: [{ ...front, image: undefined }] };
    expect(projectScene({ ...state, geometry: withoutImage }, viewport).status).toBe('missing-image');
    const empty = { ...geometry, views: [{ ...front, placements: [] }] };
    expect(projectScene({ ...state, geometry: empty, selectedPlacementId: undefined }, viewport)).toMatchObject({
      status: 'ready',
      placements: [],
    });
  });

  it('fits raster aspect within the selected step and uses explicit variant geometry', () => {
    const changed = {
      ...geometry,
      views: [
        {
          ...front,
          placements: [
            {
              ...chest,
              variantOverrides: [{ variantId: 'red', rect: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.3 } }],
            },
          ],
        },
      ],
    };
    const scene = projectScene(
      {
        ...state,
        geometry: changed,
        variantId: 'red',
        artwork: { kind: 'raster', url: 'https://example.invalid/safe.png', aspectRatio: 2 },
      },
      { width: 500, height: 300, pixelRatio: 1 },
    );
    expect(scene.placements[0]?.bounds).toEqual({ x: 202, y: 75, width: 48, height: 90 });
    expect(scene.artwork?.bounds).toEqual({ x: 214, y: 114, width: 24, height: 12 });
  });

  it('keeps all canvas and control edits in the owner state, with stale edits rejected', () => {
    const selected = applyGeometryCommand(state, { kind: 'select-step', baseVersion: 1, stepId: 'large' });
    expect(projectScene(selected, { width: 500, height: 300, pixelRatio: 1 }).artwork?.bounds).toEqual({
      x: 202,
      y: 75,
      width: 96,
      height: 90,
    });
    const moved = applyGeometryCommand(selected, {
      kind: 'set-placement-rect',
      baseVersion: 2,
      viewId: 'front',
      placementId: 'chest',
      rect: { centerX: 0.25, centerY: 0.4, width: 0.3, height: 0.3 },
    });
    expect(projectScene(moved, { width: 500, height: 300, pixelRatio: 1 }).placements[0]?.bounds).toEqual({
      x: 154,
      y: 75,
      width: 72,
      height: 90,
    });
    expect(state.geometry.views[0]?.placements[0]?.rect.centerX).toBe(0.5);
    expect(() => applyGeometryCommand(moved, { kind: 'select-step', baseVersion: 1, stepId: 'small' })).toThrow();
  });
});
