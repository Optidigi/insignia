import { placementProductSchema as selectedAuthoringProductSchema, variantPhotoSetupSchema } from '@insignia/contracts';
import { createAdminTranslator } from '@insignia/ui-localization/admin';
import { z } from 'zod';
import { configSchema, type ProductConfig } from './config';
import { designerAlias, designerMethod } from './live-config';

const previewRectSchema = z
  .strictObject({
    centerX: z.number().finite().min(0).max(1),
    centerY: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    ({ centerX, centerY, width, height }) =>
      centerX - width / 2 >= 0 && centerX + width / 2 <= 1 && centerY - height / 2 >= 0 && centerY + height / 2 <= 1,
    'preview-area-outside-image',
  );
const pointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const calibrationSchema = z.strictObject({
  imageUrl: z.string().url(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  a: pointSchema,
  b: pointSchema,
  distanceCm: z.number().finite().positive(),
});
const placementSizeSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  widthPercent: z.string(),
  heightPercent: z.string().optional(),
  prices: z.record(z.string(), z.string()),
});
const placementSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  rect: previewRectSchema,
  widthCm: z.string(),
  heightCm: z.string(),
  methodIds: z.array(z.string()),
  sizes: z.array(placementSizeSchema),
  logoLaterAllowed: z.boolean(),
  customPlacementAllowed: z.boolean().optional(),
  movementRect: previewRectSchema.optional(),
});
const viewSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  imageUrl: z.union([z.string().url(), z.literal('')]),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  placements: z.array(placementSchema),
  needsAlignmentReview: z.boolean().optional(),
  calibration: calibrationSchema.optional(),
});
const productImageSchema = z.strictObject({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string(),
});
const methodSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  explanation: z.string().optional(),
  translations: z
    .record(z.string(), z.strictObject({ name: z.string().optional(), explanation: z.string().optional() }))
    .optional(),
  pricing: z.enum(['fixed', 'product']),
  amount: z.string(),
});
const placementProductSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  variantPhotos: variantPhotoSetupSchema.optional(),
  images: z.array(productImageSchema),
  views: z.array(viewSchema),
  methods: z.array(methodSchema),
  productionChoices: selectedAuthoringProductSchema.shape.productionChoices,
});
export const nonceSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-f0-9-]+$/i);
const dataMessageSchema = z.strictObject({
  type: z.literal('insignia:customer-preview:data'),
  nonce: nonceSchema,
  product: placementProductSchema,
  currency: z.enum(['USD', 'EUR']).optional(),
});
export const cacheSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  product: placementProductSchema,
});

export type PlacementProductSnapshot = z.infer<typeof placementProductSchema>;
export type AdminPreviewFailureReason =
  | 'reopen-from-editor'
  | 'expired'
  | 'draft-did-not-arrive'
  | 'draft-could-not-be-previewed'
  | 'unrepresentable-draft-data'
  | 'empty-product-name'
  | 'no-product-views'
  | 'missing-image-for-placed-view'
  | 'no-product-image'
  | 'unnamed-product-view'
  | 'unmappable-product-view'
  | 'no-valid-artwork-placements'
  | 'too-many-artwork-placements'
  | 'unrepresentable-artwork-setup'
  | 'invalid-image-source';

export class AdminPreviewBuildError extends Error {
  constructor(readonly reason: AdminPreviewFailureReason) {
    super(reason);
    this.name = 'AdminPreviewBuildError';
  }
}

type ArtworkPreviewMessage =
  | { status: 'ignored' }
  | { status: 'error'; reason: 'unrepresentable-draft-data' }
  | { status: 'ready'; product: PlacementProductSnapshot; currency?: 'USD' | 'EUR' };

/** Call only after checking the opener source and origin. */
export function readArtworkPreviewMessage(input: unknown, nonce: string): ArtworkPreviewMessage {
  if (
    !input ||
    typeof input !== 'object' ||
    !('type' in input) ||
    input.type !== 'insignia:customer-preview:data' ||
    !('nonce' in input) ||
    input.nonce !== nonce
  )
    return { status: 'ignored' };
  const parsed = dataMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', reason: 'unrepresentable-draft-data' };
  }
  return {
    status: 'ready',
    product: parsed.data.product,
    ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
  };
}
function cents(value: string): number | null {
  const match = /^(0|[1-9]\d{0,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return amount <= 9_999_999n ? Number(amount) : null;
}

function imageUrlForCustomer(url: string, adminOrigin: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== 'insignia-order-demo.invalid') return parsed.toString();
  const filename = parsed.pathname.split('/').at(-1);
  if (!filename) throw new AdminPreviewBuildError('invalid-image-source');
  return new URL(`/__preview/demo/files/${encodeURIComponent(decodeURIComponent(filename))}`, adminOrigin).toString();
}

function movementContainsPlacement(
  movement: z.infer<typeof previewRectSchema>,
  placement: z.infer<typeof previewRectSchema>,
): boolean {
  return (
    movement.centerX - movement.width / 2 <= placement.centerX - placement.width / 2 &&
    movement.centerX + movement.width / 2 >= placement.centerX + placement.width / 2 &&
    movement.centerY - movement.height / 2 <= placement.centerY - placement.height / 2 &&
    movement.centerY + movement.height / 2 >= placement.centerY + placement.height / 2
  );
}

/** Adapt an actual editor snapshot into the existing customer designer's option model. */
export function buildCustomerPreviewConfig(
  input: PlacementProductSnapshot,
  adminOrigin: string,
  productImageLabel = createAdminTranslator().t('admin-preview:preview.productImage'),
  currency: 'USD' | 'EUR' = 'EUR',
): ProductConfig {
  const product = placementProductSchema.parse(input);
  if (!product.title.trim()) throw new AdminPreviewBuildError('empty-product-name');
  if (!product.views.length) throw new AdminPreviewBuildError('no-product-views');
  if (product.views.some((view) => view.placements.length && !view.imageUrl)) {
    throw new AdminPreviewBuildError('missing-image-for-placed-view');
  }
  const imageViews = product.views.filter((view) => view.imageUrl);
  if (!imageViews.length) throw new AdminPreviewBuildError('no-product-image');
  if (imageViews.some((view) => !view.name.trim())) throw new AdminPreviewBuildError('unnamed-product-view');

  const viewIds = new Map(imageViews.map((view) => [view.id, designerAlias(view.id)]));
  const methodIds = new Map(product.methods.map((method) => [method.id, designerAlias(method.id)]));
  const views = imageViews.map((view) => ({
    id: designerAlias(view.id),
    label: view.name.trim(),
    illustration: 'front' as const,
  }));
  const images = Object.fromEntries(
    imageViews.map((view) => [designerAlias(view.id), imageUrlForCustomer(view.imageUrl, adminOrigin)]),
  );
  const methodsById = new Map(product.methods.map((method) => [method.id, method]));
  const positions: ProductConfig['positions'] = [];

  for (const view of imageViews) {
    const viewId = viewIds.get(view.id);
    if (!viewId) throw new AdminPreviewBuildError('unmappable-product-view');
    for (const placement of view.placements) {
      if (!placement.name.trim() || !placement.rect.width || !placement.rect.height) continue;
      if (
        placement.customPlacementAllowed &&
        (!placement.movementRect || !movementContainsPlacement(placement.movementRect, placement.rect))
      )
        continue;
      if (!placement.sizes.length) continue;
      const widthFactors = placement.sizes.map((size) => Number(size.widthPercent));
      const heightFactors = placement.sizes.map((size) => Number(size.heightPercent ?? size.widthPercent));
      const sizeNames = placement.sizes.map((size) => size.name.trim().toLowerCase());
      if (
        placement.sizes.some((size) => !size.name.trim()) ||
        new Set(sizeNames).size !== sizeNames.length ||
        widthFactors.some((factor) => !Number.isFinite(factor) || factor <= 0 || factor > 100) ||
        heightFactors.some((factor) => !Number.isFinite(factor) || factor <= 0 || factor > 100) ||
        new Set(widthFactors.map((width, index) => JSON.stringify([width, heightFactors[index]]))).size !==
          widthFactors.length
      )
        continue;

      const methodSizePrices: Record<string, (number | null)[]> = {};
      const eligibleMethodIds: string[] = [];
      for (const sourceMethodId of placement.methodIds) {
        const method = methodsById.get(sourceMethodId);
        const previewMethodId = methodIds.get(sourceMethodId);
        if (!method || !previewMethodId || !method.name.trim()) continue;
        const prices = placement.sizes.map((size) =>
          cents(method.pricing === 'fixed' ? method.amount : (size.prices[sourceMethodId] ?? '')),
        );
        if (!prices.some((price) => price !== null)) continue;
        // Amounts have no known shop currency here. Retain only option availability.
        methodSizePrices[previewMethodId] = prices.map((price) => (price === null ? null : 0));
        eligibleMethodIds.push(previewMethodId);
      }
      if (!eligibleMethodIds.length) continue;
      const firstFactor = widthFactors[0];
      if (firstFactor === undefined) continue;
      const movementArea =
        placement.customPlacementAllowed && placement.movementRect
          ? {
              x: placement.movementRect.centerX * 100,
              y: placement.movementRect.centerY * 100,
              width: placement.movementRect.width * 100,
              height: placement.movementRect.height * 100,
            }
          : undefined;
      positions.push({
        id: designerAlias(placement.id),
        name: placement.name.trim(),
        view: viewId,
        x: placement.rect.centerX * 100,
        y: placement.rect.centerY * 100,
        width: placement.rect.width * firstFactor,
        maximumHeight: placement.rect.height * (heightFactors[0] ?? firstFactor),
        sizeBounds: widthFactors.map((width, index) => ({
          width: placement.rect.width * width,
          maximumHeight: placement.rect.height * (heightFactors[index] ?? width),
        })),
        ...(movementArea ? { movementArea } : {}),
        sizeLabels: placement.sizes.map((size) => size.name.trim()),
        price: 0,
        dimensions: widthFactors,
        sizePrices: widthFactors.map(() => 0),
        methodSizePrices,
        methodIds: eligibleMethodIds,
        artworkLater: placement.logoLaterAllowed,
      });
    }
  }

  if (!positions.length) {
    throw new AdminPreviewBuildError('no-valid-artwork-placements');
  }
  if (positions.length > 100) {
    throw new AdminPreviewBuildError('too-many-artwork-placements');
  }
  const usedMethods = new Set(positions.flatMap((position) => position.methodIds));
  const config = {
    id: 'admin-current-draft',
    name: product.title.trim(),
    description: 'Preview of the current product setup.',
    storeName: 'Preview',
    productName: product.title.trim(),
    productDescription: 'Current product draft',
    artworkOnly: true,
    // Required internal model placeholders. Artwork-only rendering must never show
    // these as shop currency, a base price, a variant size or purchasable quantity.
    basePrice: 0,
    currency,
    locale: 'en-GB',
    preview: 'photo' as const,
    maxQuantity: 1,
    artworkLater: false,
    sizes: [{ id: 'preview-size', label: 'Artwork preview' }],
    colors: [
      {
        id: 'product-image',
        name: productImageLabel,
        nameSource: 'admin-preview-product-image',
        availableSizeIds: ['preview-size'],
        images,
      },
    ],
    views,
    positions,
    methods: product.methods.map(designerMethod).filter((method) => usedMethods.has(method.id)),
  };
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new AdminPreviewBuildError('unrepresentable-artwork-setup');
  return parsed.data;
}
