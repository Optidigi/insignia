import type { CustomerArtworkSlot } from '@insignia/application';
import { CustomerCanonicalProductSchema, type MerchantPresentation } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import { scopeCustomerArtworkGeometry } from './presentation.ts';
/** Frozen accepted facts only. Identity labels are explicit identifiers when historical text was never captured. */
export function canonicalCustomerArtworkPresentation(input: {
  productId: string;
  presentation: MerchantPresentation;
  geometry: GeometryV1;
  group: Parameters<typeof scopeCustomerArtworkGeometry>[1];
  slots: readonly CustomerArtworkSlot[];
  imageUrls: Readonly<Record<string, string>>;
}) {
  const scoped = scopeCustomerArtworkGeometry(input.geometry, input.group, input.slots),
    stepBindings: { placementId: string; sizeId: string; stepId: string }[] = [];
  const images = new Map<string, { id: string; url: string; width: number; height: number; alt: string }>();
  for (const view of scoped.geometry.views)
    for (const ref of [...(view.image ? [view.image] : []), ...view.variantImages.map((variant) => variant.image)]) {
      const url = input.imageUrls[ref.revisionId];
      if (url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
          throw Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
        images.set(ref.revisionId, { id: ref.revisionId, url, width: ref.width, height: ref.height, alt: '' });
      }
    }
  const label = (kind: keyof MerchantPresentation['labels'], id: string) => {
    const value = input.presentation.labels[kind]?.[id];
    return typeof value === 'string' ? value : id;
  };
  const readProduct = CustomerCanonicalProductSchema.parse({
    id: input.productId,
    title: input.productId,
    images: [...images.values()],
    methods: [...new Set(input.slots.map((slot) => slot.methodId))].map((id) => ({
      id,
      name: label('methods', id),
      pricing: 'fixed',
      amount: '0',
    })),
    views: scoped.geometry.views.map((view) => ({
      id: view.id,
      name: view.id,
      imageUrl: view.image ? (images.get(view.image.revisionId)?.url ?? '') : '',
      ...(view.image ? { imageWidth: view.image.width, imageHeight: view.image.height } : {}),
      placements: view.placements.map((area) => {
        const slot = input.slots.find((slot) => slot.placementId === area.id);
        const accepted = input.group.design.placements.find((placement) => placement.placementId === area.id);
        if (!slot || accepted?.methodId !== slot.methodId || accepted.stepId !== slot.stepId)
          throw Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
        const step = scoped.geometry.steps.find((step) => step.id === slot.stepId);
        if (!step?.physicalMm) throw Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
        stepBindings.push({ placementId: area.id, sizeId: slot.stepId, stepId: slot.stepId });
        return {
          id: area.id,
          name: label('placements', area.id),
          rect: area.rect,
          widthCm: '',
          heightCm: '',
          methodIds: [slot.methodId],
          sizes: [
            {
              id: slot.stepId,
              name: label('steps', slot.stepId),
              widthPercent: String(step.widthFraction * 100),
              heightPercent: String(step.heightFraction * 100),
              prices: {},
            },
          ],
          logoLaterAllowed: false,
          customPlacementAllowed: false,
        };
      }),
    })),
    variantPhotos: {
      options: [
        { id: 'accepted-variant', name: 'Variant', values: scoped.variantIds.map((id) => ({ id, label: id })) },
      ],
      variants: scoped.variantIds.map((id) => ({
        id: `gid://shopify/ProductVariant/${id}`,
        label: id,
        optionValues: { 'accepted-variant': id },
      })),
      groupingOptionIds: ['accepted-variant'],
      assignments: [],
    },
  });
  return { ...scoped, readProduct, stepBindings };
}
