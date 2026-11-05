import type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
import { type AdminMessage, adminMessage, createAdminTranslator } from '@insignia/ui-localization/admin';

const english = createAdminTranslator('en');

export type ExportMessage = Extract<AdminMessage, { key: `exports:${string}` }>;

export type ProductionSheetErrorCode =
  | 'orderDetailsUnverified'
  | 'designDetailsExpired'
  | 'quantitiesUnverified'
  | 'budgetInvalid'
  | 'geometryMissing'
  | 'placementDetailsMissing'
  | 'artworkExpired'
  | 'imageUnavailable'
  | 'imageDataTooLarge'
  | 'imageDimensionsUnsupported'
  | 'imageCountExceeded'
  | 'renderUnavailable'
  | 'pageBudgetExceeded'
  | 'imageEncodeFailed'
  | 'imageBudgetExceeded'
  | 'artworkLoadFailed'
  | 'garmentImageUnavailable'
  | 'garmentImageLoadFailed'
  | 'placementPreviewUnavailable'
  | 'orderChanged'
  | 'artworkExpiredRetry'
  | 'prepareFailed'
  | 'downloadUnavailable'
  | 'returnedOrderUnverified'
  | 'selectionRange'
  | 'batchFull'
  | 'orderExceedsBatch'
  | 'batchExpiredDuringPreparation'
  | 'noReadyOrders'
  | 'orderChangedSupplied'
  | 'orderChangedGenerated';

export class ProductionSheetError extends Error {
  readonly code: ProductionSheetErrorCode;
  readonly displayMessage: ExportMessage;
  readonly retryable: boolean;

  constructor(code: ProductionSheetErrorCode, displayMessage: ExportMessage, options: { retryable?: boolean } = {}) {
    super(english.message(displayMessage));
    this.name = 'ProductionSheetError';
    this.code = code;
    this.displayMessage = displayMessage;
    this.retryable = options.retryable ?? false;
  }
}

export type ProductionOrderReference =
  | { readonly kind: 'merchant-name'; readonly name: string }
  | { readonly kind: 'shopify-number'; readonly name: string }
  | { readonly kind: 'generated'; readonly orderNumber: string };

/** Keeps supplied Shopify names distinct from our translated fallback label. */
export function productionOrderReference(
  purchase: Pick<PurchaseView, 'orderName' | 'orderId' | 'purchaseId'>,
): ProductionOrderReference {
  if (purchase.orderName !== null && purchase.orderName !== undefined) {
    return purchase.orderName.startsWith('#')
      ? { kind: 'shopify-number', name: purchase.orderName }
      : { kind: 'merchant-name', name: purchase.orderName };
  }
  return {
    kind: 'generated',
    orderNumber: purchase.orderId.match(/^gid:\/\/shopify\/Order\/(\d+)$/)?.[1] ?? purchase.purchaseId,
  };
}

export function productionOrderMessage(
  purchase: Pick<PurchaseView, 'orderName' | 'orderId' | 'purchaseId'>,
): ExportMessage {
  const reference = productionOrderReference(purchase);
  switch (reference.kind) {
    case 'merchant-name':
      return adminMessage('exports:orders.suppliedName', { orderName: reference.name });
    case 'shopify-number':
      return adminMessage('exports:orders.suppliedNumberContext', { orderName: reference.name });
    case 'generated':
      return adminMessage('exports:orders.generatedName', { orderNumber: reference.orderNumber });
  }
}

/** Production paperwork keeps supplied Shopify order names verbatim. */
export function productionSheetOrderMessage(
  purchase: Pick<PurchaseView, 'orderName' | 'orderId' | 'purchaseId'>,
): ExportMessage {
  const reference = productionOrderReference(purchase);
  if (reference.kind === 'shopify-number')
    return adminMessage('exports:orders.suppliedName', { orderName: reference.name });
  return productionOrderMessage(purchase);
}

/** Keep supplied names intact in machine paths; generated references retain their stable English fallback. */
export function productionOrderName(purchase: Pick<PurchaseView, 'orderName' | 'orderId' | 'purchaseId'>): string {
  const reference = productionOrderReference(purchase);
  if (reference.kind === 'generated') return `Order ${reference.orderNumber}`;
  return reference.name;
}

export function productionSheetIdentity(purchase: PurchaseView): string {
  // Signed delivery URLs rotate on reads; their durable revision IDs live in geometry.
  return JSON.stringify({ ...purchase, groups: purchase.groups.map(({ imageUrls: _urls, ...group }) => group) });
}

/** Design vectors are authoritative; line matching is only a completeness check, never a design join. */
export function assertProductionSheetAvailable(purchase: PurchaseView, now = Date.now()): void {
  if (!purchase.lines.length || !purchase.groups.length || purchase.exceptions.length)
    throw new ProductionSheetError(
      'orderDetailsUnverified',
      adminMessage('exports:productionSheet.errors.orderDetailsUnverified'),
    );
  if (purchase.groups.some((group) => Date.parse(group.payloadExpiresAt) <= now))
    throw new ProductionSheetError(
      'designDetailsExpired',
      adminMessage('exports:productionSheet.errors.designDetailsExpired'),
    );
  const quantities = (entries: { productId: string; variantId: string; quantity: number }[]) => {
    const result = new Map<string, bigint>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.productId, entry.variantId]);
      result.set(key, (result.get(key) ?? 0n) + BigInt(entry.quantity));
    }
    return result;
  };
  const lines = quantities(purchase.lines);
  const designs = quantities(
    purchase.groups.flatMap((group) => group.variants.map((variant) => ({ ...variant, productId: group.productId }))),
  );
  if (lines.size !== designs.size || [...lines].some(([key, quantity]) => designs.get(key) !== quantity))
    throw new ProductionSheetError(
      'quantitiesUnverified',
      adminMessage('exports:productionSheet.errors.quantitiesUnverified'),
    );
}

export function productionArtworkAvailable(
  group: PurchaseGroup,
  placement: PurchaseGroup['placements'][number],
  now = Date.now(),
): boolean {
  return (
    Date.parse(group.payloadExpiresAt) > now &&
    !!placement.currentAssetId &&
    !placement.expired &&
    !!placement.currentExpiresAt &&
    Date.parse(placement.currentExpiresAt) > now
  );
}

export type ProductionWarningCode =
  | 'orderCancelled'
  | 'paymentReview'
  | 'testOrder'
  | 'testStatusUnknown'
  | 'orderDetailsUnverified'
  | 'artworkNeeded'
  | 'placementPreviewUnavailable';

export interface ProductionWarning {
  readonly code: ProductionWarningCode;
  readonly tone: 'caution' | 'informational';
  readonly message: ExportMessage;
  readonly archiveMessage: ExportMessage | null;
}

/** Warnings carry stable reason codes; presentation never inspects translated English. */
export function productionOrderWarnings(purchase: PurchaseView, now = Date.now()): ProductionWarning[] {
  return [
    ...(purchase.cancelledAt
      ? [
          {
            code: 'orderCancelled',
            tone: 'caution',
            message: adminMessage('exports:productionSheet.warnings.orderCancelled'),
            archiveMessage: adminMessage('exports:artworkArchive.warnings.orderCancelled'),
          } satisfies ProductionWarning,
        ]
      : []),
    ...(purchase.financialStatus !== 'PAID' || !purchase.firstPaidAt || purchase.refunds.length > 0
      ? [
          {
            code: 'paymentReview',
            tone: 'caution',
            message: adminMessage('exports:productionSheet.warnings.paymentReview'),
            archiveMessage: adminMessage('exports:artworkArchive.warnings.paymentReview'),
          } satisfies ProductionWarning,
        ]
      : []),
    ...(purchase.isTest === true
      ? [
          {
            code: 'testOrder',
            tone: 'informational',
            message: adminMessage('exports:productionSheet.warnings.testOrder'),
            archiveMessage: null,
          } satisfies ProductionWarning,
        ]
      : purchase.isTest === null
        ? [
            {
              code: 'testStatusUnknown',
              tone: 'caution',
              message: adminMessage('exports:productionSheet.warnings.testStatusUnknown'),
              archiveMessage: adminMessage('exports:artworkArchive.warnings.testStatusUnknown'),
            } satisfies ProductionWarning,
          ]
        : []),
    ...(purchase.exceptions.length
      ? [
          {
            code: 'orderDetailsUnverified',
            tone: 'caution',
            message: adminMessage('exports:productionSheet.warnings.orderDetailsUnverified'),
            archiveMessage: adminMessage('exports:artworkArchive.warnings.orderDetailsUnverified'),
          } satisfies ProductionWarning,
        ]
      : []),
    ...(purchase.groups.some((group) =>
      group.placements.some((placement) => !productionArtworkAvailable(group, placement, now)),
    )
      ? [
          {
            code: 'artworkNeeded',
            tone: 'caution',
            message: adminMessage('exports:productionSheet.warnings.artworkNeeded'),
            archiveMessage: adminMessage('exports:artworkArchive.warnings.artworkNeeded'),
          } satisfies ProductionWarning,
        ]
      : []),
  ];
}
