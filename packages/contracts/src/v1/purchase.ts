import { z } from 'zod';
import { MerchantPresentationSchema } from './merchant-draft.js';

const id = z.string().min(1).max(128);
const date = z.iso.datetime({ offset: true });
const minor = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(20);
const line = z.strictObject({
  orderLineId: id,
  title: z.string().min(1).max(512).nullable().optional(),
  variantTitle: z.string().min(1).max(512).nullable().optional(),
  productId: id,
  variantId: id,
  quantity: z.number().int().positive(),
  unitPriceMinor: minor,
});
export const PurchasePlacementSchema = z.strictObject({
  id,
  methodId: id,
  stepId: id,
  position: z
    .strictObject({ xMicros: z.number().int().min(0).max(1000000), yMicros: z.number().int().min(0).max(1000000) })
    .optional(),
  originalArtwork: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('revision'), revisionId: id }),
    z.strictObject({ kind: z.literal('deferred'), intentId: id }),
  ]),
  currentAssetId: id.nullable(),
  currentExpiresAt: date.nullable(),
  expired: z.boolean(),
});
export const PurchaseGroupSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  productId: id,
  configRevisionId: id,
  variants: z.array(z.strictObject({ variantId: id, quantity: z.number().int().positive() })).max(32),
  placements: z.array(PurchasePlacementSchema).max(32),
  geometry: z.unknown().nullable(),
  presentation: MerchantPresentationSchema.nullable(),
  imageUrls: z
    .record(
      id,
      z.url().refine((value) => value.startsWith('https://')),
    )
    .default({}),
  payloadExpiresAt: date,
});
export const PurchaseViewSchema = z.strictObject({
  version: z.literal('m8-purchase-v1'),
  purchaseId: z.string().uuid(),
  orderId: id,
  orderName: z.string().min(1).max(512).nullable().optional(),
  orderCreatedAt: date,
  isTest: z.boolean().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exponent: z.number().int().min(0).max(3),
  originalTotalMinor: minor,
  firstPaidAt: date.nullable(),
  financialStatus: z.string().max(80),
  cancelledAt: date.nullable(),
  exceptions: z.array(z.string().max(160)).max(128),
  canUploadArtwork: z.boolean().optional(),
  canShareCustomerArtwork: z.boolean().optional(),
  artworkVersion: z.number().int().nonnegative(),
  artworkState: z.enum(['PENDING_ARTWORK', 'READY', 'ARTWORK_LOCKED', 'ERASED']),
  refunds: z
    .array(
      z.strictObject({
        refundId: id,
        occurredAt: date,
        currency: z.string().regex(/^[A-Z]{3}$/),
        amountMinor: minor,
        lines: z
          .array(z.strictObject({ lineId: id, quantity: z.number().int().nonnegative(), amountMinor: minor }))
          .max(250),
      }),
    )
    .max(250),
  lines: z.array(line).max(250),
  groups: z.array(PurchaseGroupSchema).max(128),
  artworkEvents: z
    .array(
      z.strictObject({
        eventId: id,
        version: z.number().int().positive(),
        kind: z.enum(['ATTACH', 'LOCK']),
        groupIndex: z.number().int().nonnegative().nullable(),
        placementId: id.nullable(),
        assetId: id.nullable(),
        expiresAt: date.nullable(),
        erasedAt: date.nullable(),
      }),
    )
    .max(1000),
});
export const PurchaseListSchema = z.strictObject({
  version: z.literal('m8-purchase-list-v1'),
  items: z.array(PurchaseViewSchema).max(100),
  nextCursor: z.string().uuid().nullable(),
  timeZone: z
    .string()
    .min(1)
    .max(128)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});
export const PurchaseAttachmentSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  groupIndex: z.number().int().nonnegative(),
  placementId: id,
  assetId: z.string().uuid(),
});
export const PurchaseLockSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative() });
export const PurchasePrivateUrlSchema = z.strictObject({
  url: z.url().refine((value) => value.startsWith('https://')),
  expiresAt: date,
  aspectRatio: z.number().finite().positive().optional(),
});
export type PurchaseView = z.infer<typeof PurchaseViewSchema>;
export type PurchaseGroup = z.infer<typeof PurchaseGroupSchema>;
export const PurchaseListViewSchema = PurchaseListSchema;
export const PurchaseReconcileSchema = z.strictObject({});

export const PurchaseOriginalDownloadSchema = PurchasePrivateUrlSchema.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
});
export const PurchaseListQuerySchema = z
  .object({
    before: z.string().uuid().nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
    sort: z.enum(['date-asc', 'date-desc']).optional(),
    q: z.string().max(128).optional(),
    artwork: z.enum(['all', 'needed', 'complete']).optional(),
    createdFrom: date.optional(),
    createdBefore: date.optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.createdFrom || !input.createdBefore || Date.parse(input.createdFrom) <= Date.parse(input.createdBefore),
    'Invalid date range',
  );
export type PurchaseListQuery = z.infer<typeof PurchaseListQuerySchema>;
export const PurchaseStatisticsSchema = z
  .object({
    version: z.literal('purchase-statistics-v1'),
    timeZone: z.string().min(1).max(128),
    periodDays: z.literal(30),
    observedAt: date,
    available: z.boolean(),
    series: z
      .array(
        z
          .object({
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            orders: minor,
            items: minor,
            productIds: z.array(id),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
export type PurchaseStatistics = z.infer<typeof PurchaseStatisticsSchema>;
