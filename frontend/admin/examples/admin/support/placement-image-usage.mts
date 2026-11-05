import { getVariantPhotoGroups } from './placement-variant-photos.mts';
import type { EditorView, PlacementProduct } from './placement-workflow-model.mts';

/** Library usage reflects saved view/assignment records, never image names or inferred appearance. */
export function getProductImageUsage(product: PlacementProduct): Record<string, string> {
  const usage = new Map<string, Map<string, Map<string, string>>>();
  const add = (id: string, view: EditorView, group?: { key: string; label: string }) => {
    if (!product.images.some((image) => image.id === id)) return;
    const views = usage.get(id) ?? new Map<string, Map<string, string>>();
    const groups = views.get(view.id) ?? new Map<string, string>();
    if (group) groups.set(group.key, `${group.label} · ${view.name}`);
    views.set(view.id, groups);
    usage.set(id, views);
  };
  const addShared = (view: EditorView, group?: { key: string; label: string }) => {
    if (!view.imageUrl) return;
    for (const image of product.images) if (image.url === view.imageUrl) add(image.id, view, group);
  };
  for (const view of product.views) addShared(view);
  const groups = new Map(getVariantPhotoGroups(product).map((group) => [group.key, group]));
  for (const assignment of product.variantPhotos?.assignments ?? []) {
    const group = groups.get(assignment.groupKey);
    const view = product.views.find((view) => view.id === assignment.viewId);
    if (!group || !view) continue;
    if (assignment.imageId) add(assignment.imageId, view, group);
    else if (assignment.useShared === true) addShared(view, group);
  }
  return Object.fromEntries(
    [...usage].map(([id, views]) => [
      id,
      product.views
        .flatMap((view) => {
          const groups = views.get(view.id);
          return groups ? (groups.size ? [...groups.values()] : [view.name]) : [];
        })
        .join(', '),
    ]),
  );
}
