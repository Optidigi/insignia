import { type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import { type AdminLocaleSnapshot, adminMessage, createAdminTranslator } from '@insignia/ui-localization/admin';
import { formatExactCount } from '@insignia/ui-localization/core';
import { authenticatedJson } from './admin-request';
import {
  type ExportMessage,
  ProductionSheetError,
  productionOrderMessage,
  productionOrderName,
  productionOrderReference,
  productionSheetIdentity,
} from './production-sheet';
import { type ProductionSheetResult, productionSheetPdf, renderProductionSheet } from './production-sheet-render';

type Reference = Pick<PurchaseView, 'purchaseId' | 'orderName' | 'orderId'>;
export type ProductionBatchEntry =
  | {
      name: string;
      label: ExportMessage;
      purchaseId: string;
      status: 'ready';
      purchase: PurchaseView;
      sheet: ProductionSheetResult;
    }
  | { name: string; label: ExportMessage; purchaseId: string; status: 'error'; message: ExportMessage };

export interface ProductionBatch {
  entries: ProductionBatchEntry[];
  expiresAt: number;
  documentTitle: string;
  dispose(): void;
}

const english = createAdminTranslator('en');

export function authorizationFailure(error: unknown): boolean {
  return error instanceof Error && 'status' in error && [401, 403].includes(Number(error.status));
}

async function currentPurchase(purchaseId: string, signal: AbortSignal): Promise<PurchaseView> {
  const purchase = PurchaseViewSchema.parse(
    await authenticatedJson(`/api/purchases/v1/${encodeURIComponent(purchaseId)}`, { signal }),
  );
  if (purchase.purchaseId !== purchaseId)
    throw new ProductionSheetError(
      'returnedOrderUnverified',
      adminMessage('exports:batch.errors.returnedOrderUnverified'),
    );
  return purchase;
}

/** Prepare only explicitly selected orders. A rejected order is visible, never silently omitted. */
export async function prepareProductionBatch(
  references: readonly Reference[],
  signal: AbortSignal,
  progress: (completed: number, total: number, phase?: ExportMessage) => void,
  localization: AdminLocaleSnapshot = english,
): Promise<ProductionBatch> {
  if (
    !references.length ||
    references.length > 20 ||
    new Set(references.map((item) => item.purchaseId)).size !== references.length
  )
    throw new ProductionSheetError('selectionRange', adminMessage('exports:batch.errors.selectionRange'));
  const entries: ProductionBatchEntry[] = [];
  let pages = 0;
  let bytes = 0;
  const dispose = () =>
    entries.forEach((entry) => {
      if (entry.status === 'ready') entry.sheet.dispose();
    });
  try {
    for (const [index, reference] of references.entries()) {
      signal.throwIfAborted();
      progress(
        index,
        references.length,
        adminMessage('exports:batch.preparingOrders', {
          formattedCurrent: new Intl.NumberFormat(localization.formatLocale).format(index + 1),
          formattedTotal: new Intl.NumberFormat(localization.formatLocale).format(references.length),
        }),
      );
      let sheet: ProductionSheetResult | undefined;
      const name = productionOrderName(reference);
      const label = productionOrderMessage(reference);
      try {
        const purchase = await currentPurchase(reference.purchaseId, signal);
        if (pages >= 200 || bytes >= 64 * 1024 * 1024)
          throw new ProductionSheetError('batchFull', adminMessage('exports:batch.errors.batchFull'));
        sheet = await renderProductionSheet(
          purchase,
          signal,
          (status) => progress(index, references.length, status.label),
          { maxPages: 200 - pages, maxBytes: 64 * 1024 * 1024 - bytes },
          localization,
        );
        signal.throwIfAborted();
        const size = sheet.pages.reduce((sum, page) => sum + page.png.byteLength, 0);
        if (pages + sheet.pages.length > 200 || bytes + size > 64 * 1024 * 1024)
          throw new ProductionSheetError('orderExceedsBatch', adminMessage('exports:batch.errors.orderExceedsBatch'));
        pages += sheet.pages.length;
        bytes += size;
        entries.push({
          name: productionOrderName(purchase),
          label: productionOrderMessage(purchase),
          purchaseId: purchase.purchaseId,
          status: 'ready',
          purchase,
          sheet,
        });
        sheet = undefined;
      } catch (error) {
        sheet?.dispose();
        signal.throwIfAborted();
        if (authorizationFailure(error)) throw error;
        entries.push({
          name,
          label,
          purchaseId: reference.purchaseId,
          status: 'error',
          message:
            error instanceof ProductionSheetError
              ? error.displayMessage
              : adminMessage('exports:batch.errors.prepareFailed'),
        });
      }
    }
    progress(references.length, references.length, adminMessage('exports:batch.preparing'));
    const expiresAt = Math.min(
      ...entries.flatMap((entry) => (entry.status === 'ready' ? [entry.sheet.expiresAt] : [])),
    );
    if (Date.now() >= expiresAt)
      throw new ProductionSheetError(
        'batchExpiredDuringPreparation',
        adminMessage('exports:batch.errors.batchExpiredDuringPreparation'),
      );
    const count = formatExactCount(
      BigInt(entries.filter((entry) => entry.status === 'ready').length),
      localization.formatLocale,
    );
    const documentTitle = localization.t('exports:batch.pdfTitle', {
      count: count.kind === 'plural' ? count.count : 0,
      formattedCount: count.formatted,
    });
    return { entries, expiresAt, documentTitle, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Recheck every included order immediately before creating the single download. */
export async function productionBatchPdf(
  batch: ProductionBatch,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const ready = batch.entries.filter((entry) => entry.status === 'ready');
  const first = ready[0];
  if (!first) throw new ProductionSheetError('noReadyOrders', adminMessage('exports:batch.errors.noReadyOrders'));
  for (const entry of ready) {
    signal.throwIfAborted();
    if (Date.now() >= batch.expiresAt)
      throw new ProductionSheetError('artworkExpired', adminMessage('exports:batch.errors.artworkExpired'));
    const purchase = await currentPurchase(entry.purchaseId, signal);
    if (productionSheetIdentity(purchase) !== productionSheetIdentity(entry.purchase)) {
      const reference = productionOrderReference(entry.purchase);
      if (reference.kind === 'generated')
        throw new ProductionSheetError(
          'orderChangedGenerated',
          adminMessage('exports:batch.errors.orderChangedGenerated', { orderNumber: reference.orderNumber }),
        );
      throw new ProductionSheetError(
        'orderChangedSupplied',
        adminMessage('exports:batch.errors.orderChangedSupplied', { orderName: entry.name }),
      );
    }
  }
  const bytes = await productionSheetPdf(
    {
      pages: ready.flatMap((entry) => entry.sheet.pages),
      expiresAt: batch.expiresAt,
      warnings: [],
      hold: ready.some((entry) => entry.sheet.hold),
      generatedAt: first.sheet.generatedAt,
      documentTitle: batch.documentTitle,
      dispose: () => {},
    },
    first.name,
    signal,
  );
  signal.throwIfAborted();
  if (Date.now() >= batch.expiresAt)
    throw new ProductionSheetError('artworkExpired', adminMessage('exports:batch.errors.artworkExpired'));
  return bytes;
}
