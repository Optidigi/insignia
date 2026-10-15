import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';

/** Editor selector names are local to geometry; cart/order variant IDs stay numeric. */
export function buyerGeometry(value: GeometryV1): GeometryV1 {
  const geometry = validateGeometry(value);
  const variant = (id: string) => /^variant_([1-9][0-9]{0,19})$/.exec(id)?.[1] ?? id;
  return validateGeometry({
    ...geometry,
    views: geometry.views.map((view) => ({
      ...view,
      variantImages: view.variantImages.map((item) => ({ ...item, variantId: variant(item.variantId) })),
      placements: view.placements.map((placement) => ({
        ...placement,
        ...(placement.variantOverrides
          ? {
              variantOverrides: placement.variantOverrides.map((item) => ({
                ...item,
                variantId: variant(item.variantId),
              })),
            }
          : {}),
      })),
    })),
  });
}
