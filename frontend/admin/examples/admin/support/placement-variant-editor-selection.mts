/** Session-only editor selection. It never contains product configuration or draft data. */
import { z } from 'zod';

const selectionSchema = z
  .object({
    version: z.literal(1),
    viewId: z.string().min(1).max(1000),
    placementId: z.string().min(1).max(1000).nullable(),
    appearanceKey: z.string().min(1).max(8192).nullable(),
  })
  .strict();

export type PlacementVariantEditorSelection = {
  viewId: string;
  placementId: string | null;
  appearanceKey: string | null;
};

export type PlacementVariantEditorSelectionView = {
  id: string;
  placementIds: readonly string[];
};

type ResolvePlacementVariantEditorSelectionInput = {
  views: readonly PlacementVariantEditorSelectionView[];
  appearanceKeys: readonly string[];
  saved: PlacementVariantEditorSelection | null;
  requestedViewId?: string | null;
  requestedPlacementId?: string | null;
  hasExplicitViewOrPlacement?: boolean;
  clearPlacement?: boolean;
};

const editorSelectionPrefix = 'insignia-placement-editor-selection-v1:';

export function placementVariantEditorSelectionKey(example: string, productId: string): string {
  return `${editorSelectionPrefix}${example}:${productId}`;
}

export function parsePlacementVariantEditorSelection(
  serialized: string | null,
): PlacementVariantEditorSelection | null {
  if (serialized === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const parsed = selectionSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    viewId: parsed.data.viewId,
    placementId: parsed.data.placementId,
    appearanceKey: parsed.data.appearanceKey,
  };
}

export function serializePlacementVariantEditorSelection(selection: PlacementVariantEditorSelection): string {
  return JSON.stringify({ version: 1, ...selection });
}

export function resolvePlacementVariantEditorSelection({
  views,
  appearanceKeys,
  saved,
  requestedViewId = null,
  requestedPlacementId = null,
  hasExplicitViewOrPlacement = false,
  clearPlacement = false,
}: ResolvePlacementVariantEditorSelectionInput): PlacementVariantEditorSelection {
  const defaultView = views[0];
  const defaultPlacement = (view: PlacementVariantEditorSelectionView | undefined) => view?.placementIds[0] ?? null;
  const requestedView = requestedViewId === null ? undefined : views.find((view) => view.id === requestedViewId);
  const placementOwner =
    requestedViewId === null && requestedPlacementId !== null
      ? views.find((view) => view.placementIds.includes(requestedPlacementId))
      : undefined;
  const savedView = saved ? views.find((view) => view.id === saved.viewId) : undefined;
  const canRestoreView = appearanceKeys.length > 0;

  let view = defaultView;
  if (hasExplicitViewOrPlacement) {
    view = requestedView ?? placementOwner ?? defaultView;
  } else if (canRestoreView && savedView) {
    view = savedView;
  }

  let placementId = defaultPlacement(view);
  if (hasExplicitViewOrPlacement) {
    if (clearPlacement) {
      placementId = null;
    } else if (requestedPlacementId !== null) {
      placementId = view?.placementIds.includes(requestedPlacementId) ? requestedPlacementId : defaultPlacement(view);
    }
  } else if (canRestoreView && savedView?.id === view?.id) {
    placementId =
      saved?.placementId === null
        ? null
        : saved?.placementId && view?.placementIds.includes(saved.placementId)
          ? saved.placementId
          : defaultPlacement(view);
  }

  const appearanceKey =
    appearanceKeys.length === 0
      ? null
      : saved?.appearanceKey === null
        ? null
        : saved?.appearanceKey && appearanceKeys.includes(saved.appearanceKey)
          ? saved.appearanceKey
          : (appearanceKeys[0] ?? null);

  return {
    viewId: view?.id ?? '',
    placementId,
    appearanceKey,
  };
}
