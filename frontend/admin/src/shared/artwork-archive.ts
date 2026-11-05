import { type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import { type AdminLocaleSnapshot, adminMessage, createAdminTranslator } from '@insignia/ui-localization/admin';
import { strToU8, Zip, ZipPassThrough } from 'fflate';
import { authenticatedJson } from './admin-request.js';
import { type ArtworkArchiveEntryReasonCode, ArtworkArchiveError } from './artwork-archive-error.js';
import {
  type ExportMessage,
  productionArtworkAvailable,
  productionOrderMessage,
  productionOrderName,
  productionOrderReference,
  productionSheetIdentity,
  productionSheetOrderMessage,
} from './production-sheet.js';
import { PurchaseOriginalDownloadSchema } from './purchase-presentation.ts';

export { ArtworkArchiveError } from './artwork-archive-error.js';
export interface ArtworkArchiveEntry {
  order: string;
  orderLabel: ExportMessage;
  archiveOrderLabel: ExportMessage;
  design: string;
  designLabel: ExportMessage;
  placement: string;
  placementLabel: ExportMessage | null;
  file: string | null;
  reason?: ExportMessage;
  reasonCode?: ArtworkArchiveEntryReasonCode;
  retryable?: boolean;
}
export interface ArtworkArchive {
  entries: ArtworkArchiveEntry[];
  files: number;
  filename: string;
  expiresAt: number;
  purchases: PurchaseView[];
  download(signal: AbortSignal, localization?: AdminLocaleSnapshot): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}
const maxBytes = 64 * 1024 * 1024;
const maxFiles = 200;
const english = createAdminTranslator('en');
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export function archiveName(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}/\\:*?"<>|]/gu, '-')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64) || 'unnamed'
  );
}
function requireLive(expiresAt: number, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= expiresAt)
    throw new ArtworkArchiveError('accessExpired', adminMessage('exports:artworkArchive.errors.accessExpired'));
}
async function currentPurchase(id: string, signal: AbortSignal) {
  const result = PurchaseViewSchema.parse(
    await authenticatedJson(`/api/purchases/v1/${encodeURIComponent(id)}`, { signal }),
  );
  if (result.purchaseId !== id)
    throw new ArtworkArchiveError('orderUnverified', adminMessage('exports:artworkArchive.errors.orderUnverified'));
  return result;
}
async function readOriginal(url: string, size: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok || !response.body)
    throw new ArtworkArchiveError(
      'originalReadFailed',
      adminMessage('exports:artworkArchive.errors.originalReadFailed'),
      { retryable: true },
    );
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size)
        throw new ArtworkArchiveError(
          'originalSizeUnverified',
          adminMessage('exports:artworkArchive.errors.originalSizeUnverified'),
        );
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== size)
    throw new ArtworkArchiveError(
      'originalSizeUnverified',
      adminMessage('exports:artworkArchive.errors.originalSizeUnverified'),
    );
  return bytes;
}
/** Current original files only. Identical assets within an order share a file; the manifest maps every placement. */
export async function prepareArtworkArchive(
  ids: readonly string[],
  signal: AbortSignal,
  progress: (label: ExportMessage) => void,
  localization: AdminLocaleSnapshot = english,
): Promise<ArtworkArchive> {
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
    throw new ArtworkArchiveError('selectionRange', adminMessage('exports:artworkArchive.errors.selectionRange'));
  const entries: ArtworkArchiveEntry[] = [];
  const purchases: PurchaseView[] = [];
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const used = new Map<string, string>();
  let bytes = 0;
  let expiresAt = Number.POSITIVE_INFINITY;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    files.clear();
  };
  try {
    for (const [orderIndex, id] of ids.entries()) {
      signal.throwIfAborted();
      progress(
        adminMessage('exports:artworkArchive.progress.readingOrder', {
          current: new Intl.NumberFormat(localization.formatLocale).format(orderIndex + 1),
          total: new Intl.NumberFormat(localization.formatLocale).format(ids.length),
        }),
      );
      const purchase = await currentPurchase(id, signal);
      purchases.push(purchase);
      const order = productionOrderName(purchase);
      const orderLabel = productionOrderMessage(purchase);
      const archiveOrderLabel = productionSheetOrderMessage(purchase);
      const folder = `${String(orderIndex + 1).padStart(2, '0')}-${archiveName(order)}`;
      if (!purchase.groups.length) {
        entries.push({
          order,
          orderLabel,
          archiveOrderLabel,
          design: 'Order',
          designLabel: adminMessage('exports:artworkArchive.entries.orderFallback'),
          placement: 'Artwork',
          placementLabel: adminMessage('exports:artworkArchive.entries.artworkFallback'),
          file: null,
          reasonCode: 'detailsNotRetained',
          reason: adminMessage('exports:artworkArchive.entries.detailsNotRetained'),
        });
      }
      for (const [designIndex, group] of purchase.groups.entries()) {
        const productPathName = purchase.lines.find((line) => line.productId === group.productId)?.title ?? 'Product';
        const productName =
          purchase.lines.find((line) => line.productId === group.productId)?.title ??
          localization.t('exports:artworkArchive.entries.productFallback');
        const design = `Design ${designIndex + 1} · ${productPathName}`;
        const designLabel = adminMessage('exports:artworkArchive.entries.designName', {
          formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(designIndex + 1),
          productName,
        });
        const designFolder = `${folder}/${String(designIndex + 1).padStart(2, '0')}-${archiveName(productPathName)}`;
        for (const [placementIndex, placement] of group.placements.entries()) {
          const suppliedPlacementName = group.presentation?.labels.placements?.[placement.id];
          const label = suppliedPlacementName ?? `Placement ${placementIndex + 1}`;
          const placementName =
            suppliedPlacementName ??
            localization.t('exports:artworkArchive.entries.placementFallback', {
              formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(placementIndex + 1),
            });
          const placementLabel = group.presentation?.labels.placements?.[placement.id]
            ? null
            : adminMessage('exports:artworkArchive.entries.placementFallback', {
                formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(placementIndex + 1),
              });
          const entry: ArtworkArchiveEntry = {
            order,
            orderLabel,
            archiveOrderLabel,
            design,
            designLabel,
            placement: label,
            placementLabel,
            file: null,
          };
          entries.push(entry);
          if (!productionArtworkAvailable(group, placement)) {
            entry.reasonCode = 'artworkUnavailable';
            entry.reason = adminMessage('exports:artworkArchive.entries.artworkUnavailable');
            continue;
          }
          const key = `${id}/${placement.currentAssetId}`;
          const placementDeadline = Math.min(
            Date.parse(group.payloadExpiresAt),
            Date.parse(placement.currentExpiresAt ?? ''),
          );
          const existing = used.get(key);
          if (existing) {
            expiresAt = Math.min(expiresAt, placementDeadline);
            entry.file = existing;
            continue;
          }
          if (files.size >= maxFiles) {
            entry.reasonCode = 'fileLimitReached';
            entry.reason = adminMessage('exports:artworkArchive.entries.fileLimitReached');
            continue;
          }
          const reference = productionOrderReference(purchase);
          const progressLabel =
            reference.kind === 'generated'
              ? adminMessage('exports:artworkArchive.progress.readingPlacementGenerated', {
                  orderNumber: reference.orderNumber,
                  formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(designIndex + 1),
                  productName,
                  placementName,
                })
              : adminMessage('exports:artworkArchive.progress.readingPlacementSupplied', {
                  orderName: reference.name,
                  formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(designIndex + 1),
                  productName,
                  placementName,
                });
          progress(progressLabel);
          try {
            const access = PurchaseOriginalDownloadSchema.parse(
              await authenticatedJson(
                `/api/purchases/v1/${encodeURIComponent(id)}/artwork/${encodeURIComponent(placement.currentAssetId ?? '')}/download?metadata=1`,
                { signal },
              ),
            );
            const deadline = Math.min(
              Date.parse(access.expiresAt),
              Date.parse(group.payloadExpiresAt),
              Date.parse(placement.currentExpiresAt ?? ''),
            );
            requireLive(deadline, signal);
            if (bytes + access.byteLength > maxBytes)
              throw new ArtworkArchiveError(
                'archiveSizeLimit',
                adminMessage('exports:artworkArchive.errors.archiveSizeLimit'),
              );
            const original = await readOriginal(access.url, access.byteLength, signal);
            requireLive(deadline, signal);
            const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', original)), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
            if (sha256 !== access.sha256)
              throw new ArtworkArchiveError(
                'checksumUnverified',
                adminMessage('exports:artworkArchive.errors.checksumUnverified'),
              );
            const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[access.contentType];
            const path = `${designFolder}/P${placementIndex + 1}-${archiveName(label)}.${extension}`;
            files.set(path, original);
            used.set(key, path);
            entry.file = path;
            bytes += original.byteLength;
            expiresAt = Math.min(expiresAt, deadline);
          } catch (error) {
            signal.throwIfAborted();
            const status = error instanceof Error && 'status' in error ? Number(error.status) : undefined;
            if (status === 401 || status === 403) throw error;
            if (status === 410) {
              entry.reasonCode = 'originalUnavailable';
              entry.reason = adminMessage('exports:artworkArchive.entries.originalUnavailable');
              entry.retryable = false;
            } else if (error instanceof ArtworkArchiveError) {
              entry.reasonCode =
                error.code === 'archiveSizeLimit'
                  ? 'archiveSizeLimit'
                  : error.code === 'accessExpired'
                    ? 'accessExpired'
                    : error.code === 'checksumUnverified'
                      ? 'checksumUnverified'
                      : error.code === 'originalSizeUnverified'
                        ? 'originalSizeUnverified'
                        : 'originalReadFailed';
              entry.reason =
                error.code === 'archiveSizeLimit'
                  ? adminMessage('exports:artworkArchive.entries.archiveSizeLimit')
                  : error.code === 'accessExpired'
                    ? adminMessage('exports:artworkArchive.entries.accessExpired')
                    : error.code === 'checksumUnverified'
                      ? adminMessage('exports:artworkArchive.entries.checksumUnverified')
                      : error.code === 'originalSizeUnverified'
                        ? adminMessage('exports:artworkArchive.entries.originalSizeUnverified')
                        : adminMessage('exports:artworkArchive.entries.originalReadFailed');
              entry.retryable = error.retryable;
            } else if (status === undefined || status === 408 || status === 429 || status >= 500) {
              entry.reasonCode = 'originalLoadFailed';
              entry.reason = adminMessage('exports:artworkArchive.entries.originalLoadFailed');
              entry.retryable = true;
            } else {
              entry.reasonCode = 'originalUnverified';
              entry.reason = adminMessage('exports:artworkArchive.entries.originalUnverified');
              entry.retryable = false;
            }
          }
        }
      }
    }
    if (files.size) requireLive(expiresAt, signal);
    const count = files.size;
    const firstOrder = purchases[0];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const filename =
      firstOrder && purchases.length === 1
        ? `order-${archiveName(productionOrderName(firstOrder)).replace(/^#+/, '')}-artwork-v${firstOrder.artworkVersion}-${stamp}.zip`
        : `artwork-${purchases.length}-orders-${stamp}.zip`;
    return {
      entries,
      files: count,
      filename,
      expiresAt,
      purchases,
      dispose,
      async download(caller, outputLocale = english) {
        if (disposed || !files.size)
          throw new ArtworkArchiveError(
            'prepareBeforeDownload',
            adminMessage('exports:artworkArchive.errors.prepareBeforeDownload'),
          );
        requireLive(expiresAt, caller);
        for (const purchase of purchases) {
          const latest = await currentPurchase(purchase.purchaseId, caller);
          if (productionSheetIdentity(latest) !== productionSheetIdentity(purchase))
            throw new ArtworkArchiveError('orderChanged', adminMessage('exports:artworkArchive.errors.orderChanged'));
        }
        const manifest = [
          outputLocale.t('exports:artworkArchive.readme.title'),
          outputLocale.t('exports:artworkArchive.readme.prepared', { timestamp: new Date().toISOString() }),
          outputLocale.t('exports:artworkArchive.readme.originalBytes'),
          outputLocale.t('exports:artworkArchive.readme.notProductionApproval'),
          '',
          ...purchases.flatMap((purchase) => {
            const orderName = outputLocale.message(productionSheetOrderMessage(purchase));
            const testTag = purchase.isTest === true ? outputLocale.t('exports:artworkArchive.readme.testTag') : '';
            const cancelledTag = purchase.cancelledAt
              ? outputLocale.t('exports:artworkArchive.readme.cancelledTag')
              : '';
            return [
              outputLocale.t('exports:artworkArchive.readme.orderSummary', {
                orderName,
                financialStatus: purchase.financialStatus,
                testTag,
                cancelledTag,
              }),
              ...purchase.exceptions.map((exceptionCode) =>
                outputLocale.t('exports:artworkArchive.readme.orderException', { exceptionCode }),
              ),
            ];
          }),
          '',
          ...entries.map((entry) => {
            const orderName = outputLocale.message(entry.archiveOrderLabel);
            const designName = outputLocale.message(entry.designLabel);
            const placementName = entry.placementLabel ? outputLocale.message(entry.placementLabel) : entry.placement;
            const fileStatus =
              entry.file ??
              outputLocale.t('exports:artworkArchive.entries.notIncluded', {
                reason: outputLocale.message(
                  entry.reason ?? adminMessage('exports:artworkArchive.errors.prepareFailed'),
                ),
              });
            return `${outputLocale.t('exports:artworkArchive.readme.entry', {
              orderName,
              designName,
              placementName,
              fileStatus,
            })}\n`;
          }),
        ].join('\n');
        const chunks: Uint8Array[] = [];
        let archiveError: Error | null = null;
        const zip = new Zip((error, data) => {
          if (error) archiveError = error;
          else chunks.push(data);
        });
        try {
          for (const [path, data] of [...files.entries(), ['README.txt', strToU8(manifest)] as const]) {
            requireLive(expiresAt, caller);
            const file = new ZipPassThrough(path);
            zip.add(file);
            for (let offset = 0; offset < data.length; offset += 256 * 1024) {
              requireLive(expiresAt, caller);
              file.push(data.subarray(offset, offset + 256 * 1024), offset + 256 * 1024 >= data.length);
              await pause();
            }
          }
          zip.end();
          if (archiveError) throw archiveError;
          requireLive(expiresAt, caller);
          const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          requireLive(expiresAt, caller);
          return result;
        } finally {
          zip.terminate();
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
