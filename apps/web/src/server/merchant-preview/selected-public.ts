import { CustomerSelectedSetupSchema, getVariantPhotoGroups, type SelectedProductSetup } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
/** Only configured presentation and captured preview URLs cross the customer boundary. Frozen authoring stays private. */
export function publicSelectedSetup(
  selected: SelectedProductSetup,
  geometry: GeometryV1,
  imageUrls: Readonly<Record<string, string>>,
): SelectedProductSetup {
  validateGeometry(geometry);
  const unavailable = (): never => {
    throw new Error('Published preview unavailable');
  };
  const conflicting = new Set<string>();
  const references = new Map<string, NonNullable<GeometryV1['views'][number]['image']>>();
  for (const view of geometry.views)
    for (const reference of [
      ...(view.image ? [view.image] : []),
      ...view.variantImages.map((variant) => variant.image),
    ]) {
      const previous = references.get(reference.revisionId);
      if (previous && (previous.width !== reference.width || previous.height !== reference.height))
        conflicting.add(reference.revisionId);
      references.set(reference.revisionId, reference);
    }
  const available = new Map<string, string>();
  for (const id of references.keys()) {
    if (conflicting.has(id)) continue;
    const url = imageUrls[id];
    if (typeof url !== 'string' || !url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) available.set(id, url);
    } catch {
      /* An optional delivery URL is unavailable; source/admin URLs never replace it. */
    }
  }
  const images = [...references.values()].flatMap((reference) => {
    const url = available.get(reference.revisionId);
    if (!url) return [];
    const source = selected.product.images.find((image) => image.id === reference.revisionId);
    return [
      { id: reference.revisionId, url, width: reference.width, height: reference.height, alt: source?.alt ?? '' },
    ];
  });
  const methodById = new Map(selected.product.methods.map((method) => [method.id, method]));
  const views = geometry.views.map((geometryView) => {
    const source = selected.product.views.find((view) => view.id === geometryView.id);
    if (!source) return unavailable();
    const imageUrl = geometryView.image ? (available.get(geometryView.image.revisionId) ?? '') : '';
    const { calibration, ...base } = source;
    return {
      ...base,
      imageUrl,
      imageWidth: geometryView.image?.width ?? source.imageWidth,
      imageHeight: geometryView.image?.height ?? source.imageHeight,
      ...(imageUrl &&
      geometryView.image &&
      calibration &&
      calibration.imageWidth === geometryView.image.width &&
      calibration.imageHeight === geometryView.image.height
        ? { calibration: { ...calibration, imageUrl } }
        : {}),
      placements: geometryView.placements.map((area) => {
        const placement = source.placements.find((placement) => placement.id === area.id);
        if (!placement) return unavailable();
        return {
          ...placement,
          sizes: placement.sizes.map((size) => ({
            ...size,
            prices: Object.fromEntries(
              Object.entries(size.prices).filter(
                ([methodId]) =>
                  placement.methodIds.includes(methodId) && methodById.get(methodId)?.pricing === 'product',
              ),
            ),
          })),
        };
      }),
    };
  });
  const usedMethods = new Set(views.flatMap((view) => view.placements.flatMap((placement) => placement.methodIds)));
  for (const id of usedMethods)
    if (selected.product.methods.filter((method) => method.id === id).length !== 1) unavailable();
  const activeGroups = new Set(getVariantPhotoGroups(selected.product).map((group) => group.key));
  const assignments = selected.product.variantPhotos?.assignments
    .filter(
      (assignment) => activeGroups.has(assignment.groupKey) && views.some((view) => view.id === assignment.viewId),
    )
    .map((assignment) => {
      const view = views.find((view) => view.id === assignment.viewId);
      const { imageId, useShared, placementRects, ...base } = assignment;
      const assigned = imageId && available.has(imageId) ? imageId : undefined;
      return {
        ...base,
        ...(assigned ? { imageId: assigned } : {}),
        ...(!imageId && useShared && view?.imageUrl ? { useShared: true } : {}),
        ...(placementRects
          ? {
              placementRects: Object.fromEntries(
                Object.entries(placementRects).filter(([id]) =>
                  view?.placements.some((placement) => placement.id === id),
                ),
              ),
            }
          : {}),
      };
    });
  return CustomerSelectedSetupSchema.parse({
    ...selected,
    methodBindings: {},
    product: {
      ...selected.product,
      ...(selected.product.variantPhotos ? { variantPhotos: { ...selected.product.variantPhotos, assignments } } : {}),
      methods: selected.product.methods
        .filter((method) => usedMethods.has(method.id))
        .map((method) => (method.pricing === 'product' ? { ...method, amount: '' } : method)),
      images,
      views,
    },
  });
}
