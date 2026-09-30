/** Browser-safe M5 sidecar. IDs bridge to M2 PublishedConfig; no Konva or URLs are persisted. */
export const GEOMETRY_VERSION = 'm5-geometry-v1' as const;

export interface NormalizedRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageRef {
  revisionId: string;
  width: number;
  height: number;
}

export interface GeometryV1 {
  version: typeof GEOMETRY_VERSION;
  views: {
    id: string;
    image?: ImageRef;
    variantImages: { variantId: string; image: ImageRef }[];
    placements: {
      id: string;
      rect: NormalizedRect;
      variantOverrides?: { variantId: string; rect: NormalizedRect }[];
    }[];
  }[];
  /** Fractions of the selected placement's maximum rectangle, not garment sizes. */
  steps: {
    id: string;
    widthFraction: number;
    heightFraction: number;
    physicalMm?: { width: number; height: number };
  }[];
}

export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

export type Artwork = { kind: 'none' } | { kind: 'logo-later' } | { kind: 'raster'; url: string; aspectRatio: number };

export interface EditorState {
  version: number;
  geometry: GeometryV1;
  viewId: string;
  variantId?: string;
  selectedPlacementId?: string;
  selectedStepId?: string;
  artwork: Artwork;
}

export type GeometryCommand =
  | { kind: 'select-placement'; baseVersion: number; placementId?: string }
  | { kind: 'select-step'; baseVersion: number; stepId?: string }
  | { kind: 'select-view'; baseVersion: number; viewId: string }
  | { kind: 'select-variant'; baseVersion: number; variantId?: string }
  | {
      kind: 'set-placement-rect';
      baseVersion: number;
      viewId: string;
      variantId?: string;
      placementId: string;
      rect: NormalizedRect;
    };

export type RenderStatus = 'ready' | 'missing-image' | 'missing-geometry' | 'image-error';

export interface RenderScene {
  version: number;
  status: RenderStatus;
  viewId?: string;
  variantId?: string;
  contentRect?: PixelRect;
  image?: ImageRef & { url?: string };
  placements: { id: string; selected: boolean; bounds: PixelRect }[];
  artwork?: { kind: 'logo-later' | 'raster'; url?: string; bounds: PixelRect };
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function strictKeys(value: unknown, allowed: readonly string[], label: string): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error(`invalid ${label} fields`);
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateRect(rect: NormalizedRect): void {
  strictKeys(rect, ['centerX', 'centerY', 'width', 'height'], 'rectangle');
  if (
    !rect ||
    !positive(rect.width) ||
    !positive(rect.height) ||
    !Number.isFinite(rect.centerX) ||
    !Number.isFinite(rect.centerY) ||
    rect.width > 1 ||
    rect.height > 1 ||
    rect.centerX - rect.width / 2 < 0 ||
    rect.centerX + rect.width / 2 > 1 ||
    rect.centerY - rect.height / 2 < 0 ||
    rect.centerY + rect.height / 2 > 1
  ) {
    throw new Error('placement rectangle must fit inside normalized image');
  }
}

function assertUniqueId(id: string, seen: Set<string>, label: string): void {
  if (!validId(id) || seen.has(id)) throw new Error(`invalid or duplicate ${label}`);
  seen.add(id);
}

function validateImage(image: ImageRef): void {
  strictKeys(image, ['revisionId', 'width', 'height'], 'image reference');
  if (!image || !validId(image.revisionId) || !positive(image.width) || !positive(image.height))
    throw new Error('invalid image reference');
}

/** Validate before persisting the sidecar. Invalid geometry is rejected, never clamped. */
export function validateGeometry(geometry: GeometryV1): GeometryV1 {
  strictKeys(geometry, ['version', 'views', 'steps'], 'geometry');
  if (
    !geometry ||
    geometry.version !== GEOMETRY_VERSION ||
    !Array.isArray(geometry.views) ||
    geometry.views.length === 0 ||
    !Array.isArray(geometry.steps) ||
    geometry.views.length > 16 ||
    geometry.steps.length > 64
  )
    throw new Error('unsupported geometry version');
  const views = new Set<string>();
  for (const view of geometry.views) {
    strictKeys(view, ['id', 'image', 'variantImages', 'placements'], 'view');
    assertUniqueId(view.id, views, 'view ID');
    if (view.image) validateImage(view.image);
    if (
      !Array.isArray(view.variantImages) ||
      view.variantImages.length > 100 ||
      !Array.isArray(view.placements) ||
      view.placements.length > 64
    )
      throw new Error('invalid view');
    const variants = new Set<string>();
    for (const variant of view.variantImages) {
      strictKeys(variant, ['variantId', 'image'], 'variant image');
      assertUniqueId(variant.variantId, variants, 'variant ID');
      validateImage(variant.image);
    }
    const placements = new Set<string>();
    for (const placement of view.placements) {
      strictKeys(placement, ['id', 'rect', 'variantOverrides'], 'placement');
      assertUniqueId(placement.id, placements, 'placement ID');
      validateRect(placement.rect);
      if (
        placement.variantOverrides !== undefined &&
        (!Array.isArray(placement.variantOverrides) || placement.variantOverrides.length > 100)
      )
        throw new Error('invalid variant overrides');
      const overrides = new Set<string>();
      for (const override of placement.variantOverrides ?? []) {
        strictKeys(override, ['variantId', 'rect'], 'variant override');
        assertUniqueId(override.variantId, overrides, 'override variant ID');
        validateRect(override.rect);
      }
    }
  }
  const steps = new Set<string>();
  for (const step of geometry.steps) {
    strictKeys(step, ['id', 'widthFraction', 'heightFraction', 'physicalMm'], 'step');
    assertUniqueId(step.id, steps, 'step ID');
    if (step.physicalMm) strictKeys(step.physicalMm, ['width', 'height'], 'step physical size');
    if (
      !positive(step.widthFraction) ||
      step.widthFraction > 1 ||
      !positive(step.heightFraction) ||
      step.heightFraction > 1 ||
      (step.physicalMm && (!positive(step.physicalMm.width) || !positive(step.physicalMm.height)))
    )
      throw new Error('invalid decoration step');
  }
  return geometry;
}

/** Bridge against the M2 published shape without importing domain into the browser package. */
export function validateGeometryBridge(
  geometry: GeometryV1,
  config: {
    version: 'm2-published-config-v1';
    placements: readonly { id: string; allowedStepIds: readonly string[] }[];
  },
): void {
  validateGeometry(geometry);
  if (config?.version !== 'm2-published-config-v1' || !Array.isArray(config.placements))
    throw new Error('unsupported published config bridge');
  const actualPlacements = new Set(geometry.views.flatMap((view) => view.placements.map((item) => item.id)));
  const expectedPlacements = new Set(config.placements.map((item) => item.id));
  if (
    expectedPlacements.size !== config.placements.length ||
    actualPlacements.size !== expectedPlacements.size ||
    [...actualPlacements].some((id) => !expectedPlacements.has(id))
  )
    throw new Error('geometry placement IDs do not match published config');
  const steps = new Set(geometry.steps.map((item) => item.id));
  for (const placement of config.placements) {
    if (placement.allowedStepIds.some((id: string) => !steps.has(id)))
      throw new Error('missing decoration step geometry');
  }
}

export function containFit(image: { width: number; height: number }, viewport: Viewport): PixelRect {
  if (
    !positive(image.width) ||
    !positive(image.height) ||
    !positive(viewport.width) ||
    !positive(viewport.height) ||
    !positive(viewport.pixelRatio)
  )
    throw new Error('invalid image or viewport');
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
}

export function normalizedToRendered(rect: NormalizedRect, content: PixelRect): PixelRect {
  validateRect(rect);
  if (!positive(content.width) || !positive(content.height)) throw new Error('invalid content bounds');
  return {
    x: content.x + (rect.centerX - rect.width / 2) * content.width,
    y: content.y + (rect.centerY - rect.height / 2) * content.height,
    width: rect.width * content.width,
    height: rect.height * content.height,
  };
}

export function renderedToNormalized(rect: PixelRect, content: PixelRect): NormalizedRect {
  if (!positive(content.width) || !positive(content.height) || !positive(rect.width) || !positive(rect.height))
    throw new Error('invalid rendered bounds');
  const normalized = {
    centerX: (rect.x - content.x + rect.width / 2) / content.width,
    centerY: (rect.y - content.y + rect.height / 2) / content.height,
    width: rect.width / content.width,
    height: rect.height / content.height,
  };
  validateRect(normalized);
  return normalized;
}

function fitAspect(bounds: PixelRect, aspectRatio: number): PixelRect {
  if (!positive(aspectRatio)) throw new Error('invalid artwork aspect ratio');
  const width = Math.min(bounds.width, bounds.height * aspectRatio);
  const height = width / aspectRatio;
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
}

export function projectScene(
  state: EditorState,
  viewport: Viewport,
  imageUrls: Readonly<Record<string, string>> = {},
): RenderScene {
  validateGeometry(state.geometry);
  if (!Number.isSafeInteger(state.version) || state.version < 0) throw new Error('invalid editor version');
  const view = state.geometry.views.find((item) => item.id === state.viewId);
  if (!view)
    return {
      version: state.version,
      viewId: state.viewId,
      variantId: state.variantId,
      status: 'missing-geometry',
      placements: [],
    };
  const image = view.variantImages.find((item) => item.variantId === state.variantId)?.image ?? view.image;
  if (!image)
    return {
      version: state.version,
      viewId: state.viewId,
      variantId: state.variantId,
      status: 'missing-image',
      placements: [],
    };
  const contentRect = containFit(image, viewport);
  const placements = view.placements.map((placement) => {
    const rect = placement.variantOverrides?.find((item) => item.variantId === state.variantId)?.rect ?? placement.rect;
    return {
      id: placement.id,
      selected: placement.id === state.selectedPlacementId,
      bounds: normalizedToRendered(rect, contentRect),
    };
  });
  const scene: RenderScene = {
    version: state.version,
    viewId: state.viewId,
    variantId: state.variantId,
    status: 'ready',
    image: { ...image, url: imageUrls[image.revisionId] },
    contentRect,
    placements,
  };
  if (state.selectedPlacementId) {
    const placement = placements.find((item) => item.id === state.selectedPlacementId);
    if (!placement) return { ...scene, status: 'missing-geometry' };
    const step = state.geometry.steps.find((item) => item.id === state.selectedStepId);
    if (state.selectedStepId && !step) return { ...scene, status: 'missing-geometry' };
    if (step && state.artwork.kind !== 'none') {
      const max = placement.bounds;
      const width = max.width * step.widthFraction;
      const height = max.height * step.heightFraction;
      const stepBounds = { x: max.x + (max.width - width) / 2, y: max.y + (max.height - height) / 2, width, height };
      const bounds = state.artwork.kind === 'raster' ? fitAspect(stepBounds, state.artwork.aspectRatio) : stepBounds;
      scene.artwork = {
        kind: state.artwork.kind,
        ...(state.artwork.kind === 'raster' ? { url: state.artwork.url } : {}),
        bounds,
      };
    }
  }
  return scene;
}

/** The owner store calls this for both UI and canvas commands, then passes the result to update(). */
export function applyGeometryCommand(state: EditorState, command: GeometryCommand): EditorState {
  if (command.baseVersion !== state.version) throw new Error('stale editor command');
  validateGeometry(state.geometry);
  const nextVersion = state.version + 1;
  switch (command.kind) {
    case 'select-placement':
      if (
        command.placementId &&
        !state.geometry.views
          .find((view) => view.id === state.viewId)
          ?.placements.some((placement) => placement.id === command.placementId)
      )
        throw new Error('unknown placement');
      return { ...state, version: nextVersion, selectedPlacementId: command.placementId };
    case 'select-step':
      if (command.stepId && !state.geometry.steps.some((step) => step.id === command.stepId))
        throw new Error('unknown decoration step');
      return { ...state, version: nextVersion, selectedStepId: command.stepId };
    case 'select-view':
      if (!state.geometry.views.some((view) => view.id === command.viewId)) throw new Error('unknown view');
      return { ...state, version: nextVersion, viewId: command.viewId, selectedPlacementId: undefined };
    case 'select-variant':
      return { ...state, version: nextVersion, variantId: command.variantId };
    case 'set-placement-rect': {
      validateRect(command.rect);
      let found = false;
      const views = state.geometry.views.map((view) =>
        view.id !== command.viewId
          ? view
          : {
              ...view,
              placements: view.placements.map((placement) => {
                if (placement.id !== command.placementId) return placement;
                found = true;
                if (!command.variantId) return { ...placement, rect: { ...command.rect } };
                const overrides = (placement.variantOverrides ?? []).filter(
                  (item) => item.variantId !== command.variantId,
                );
                return {
                  ...placement,
                  variantOverrides: [...overrides, { variantId: command.variantId, rect: { ...command.rect } }],
                };
              }),
            },
      );
      if (!found) throw new Error('unknown placement');
      const geometry = { ...state.geometry, views };
      validateGeometry(geometry);
      return { ...state, version: nextVersion, geometry };
    }
  }
}
