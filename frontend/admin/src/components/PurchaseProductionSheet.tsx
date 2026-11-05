import { type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import { adminMessage } from '@insignia/ui-localization/admin';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request';
import {
  initialPreparedExportState,
  type PreparedExportEvent,
  type PreparedExportState,
  preparedExportReducer,
} from '../shared/prepared-export-state';
import {
  assertProductionSheetAvailable,
  type ExportMessage,
  ProductionSheetError,
  productionOrderMessage,
  productionOrderName,
  productionSheetIdentity,
} from '../shared/production-sheet';
import type { ProductionSheetResult } from '../shared/production-sheet-render';
import AdminSkeleton from './AdminSkeleton';
import ProductionSheetPreview from './ProductionSheetPreview';

export default function PurchaseProductionSheet({
  purchase,
  disabled,
  deny,
  triggerSlot,
}: {
  purchase: PurchaseView;
  disabled: boolean;
  deny(error: unknown): void;
  triggerSlot?: 'secondary-actions' | 'primary-action';
}) {
  const id = useId();
  const localization = useAdminLocale();
  const [sheet, setSheet] = useState<ProductionSheetResult | null>(null);
  const [flow, dispatch] = useReducer<
    PreparedExportState<ExportMessage>,
    PreparedExportEvent<ExportMessage>,
    undefined
  >(preparedExportReducer, undefined, () => initialPreparedExportState<ExportMessage>());
  const message = flow.message;
  const phase = flow.progress;
  const busy = flow.phase === 'preparing' || flow.phase === 'downloading';
  const attempt = useRef(0);
  const busyClaim = useRef(false);
  const [open, setOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const retained = useRef<ProductionSheetResult | null>(null);
  const snapshot = useRef<PurchaseView | null>(null);
  const identity = productionSheetIdentity(purchase);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  function clear(message?: ExportMessage) {
    controller.current?.abort();
    controller.current = null;
    retained.current?.dispose();
    retained.current = null;
    snapshot.current = null;
    setSheet(null);
    busyClaim.current = false;
    dispatch({ type: 'invalidated', attempt: ++attempt.current, ...(message ? { message } : {}) });
  }
  useLayoutEffect(() => {
    clear(open ? adminMessage('exports:productionSheet.errors.orderChanged') : undefined);
    return clear;
  }, [identity]);
  useEffect(() => {
    if (!sheet) return;
    const timer = setTimeout(
      () => {
        if (retained.current !== sheet) return;
        clear(adminMessage('exports:productionSheet.errors.artworkExpiredRetry'));
      },
      Math.max(0, Math.min(sheet.expiresAt - Date.now(), 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [sheet]);
  async function prepare() {
    if (busyClaim.current) return;
    clear();
    busyClaim.current = true;
    const outputLocale = localization;
    const currentAttempt = attempt.current;
    dispatch({
      type: 'preparation-started',
      attempt: currentAttempt,
      label: adminMessage('exports:productionSheet.progress.readingOrder'),
    });
    setPageIndex(0);
    const request = new AbortController();
    controller.current = request;
    const requestedIdentity = identity;
    let result: ProductionSheetResult | undefined;
    try {
      const fresh = PurchaseViewSchema.parse(
        await authenticatedJson(`/api/purchases/v1/${encodeURIComponent(purchase.purchaseId)}`, {
          signal: request.signal,
        }),
      );
      assertProductionSheetAvailable(fresh);
      const { renderProductionSheet } = await import('../shared/production-sheet-render');
      result = await renderProductionSheet(
        fresh,
        request.signal,
        (progress) => {
          if (controller.current === request && !request.signal.aborted)
            dispatch({ type: 'preparation-progress', attempt: currentAttempt, label: progress.label });
        },
        undefined,
        outputLocale,
      );
      if (request.signal.aborted || requestedIdentity !== currentIdentity.current) {
        result.dispose();
        return;
      }
      if (Date.now() >= result.expiresAt)
        throw new ProductionSheetError(
          'artworkExpiredRetry',
          adminMessage('exports:productionSheet.errors.artworkExpiredRetry'),
        );
      retained.current = result;
      snapshot.current = fresh;
      setSheet(result);
      dispatch({ type: 'prepared', attempt: currentAttempt });
    } catch (error) {
      result?.dispose();
      if (!request.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ProductionSheetError
            ? error.displayMessage
            : adminMessage('exports:productionSheet.errors.prepareFailed'),
        );
        deny(error);
      }
    } finally {
      if (controller.current === request) {
        busyClaim.current = false;
        dispatch({ type: 'download-finished', attempt: currentAttempt });
      }
    }
  }
  async function download() {
    const prepared = retained.current,
      source = snapshot.current,
      request = controller.current;
    if (!prepared || !source || !request || busyClaim.current) return;
    busyClaim.current = true;
    const currentAttempt = attempt.current;
    dispatch({
      type: 'download-started',
      attempt: currentAttempt,
      label: adminMessage('exports:productionSheet.progress.checkingOrder'),
    });
    try {
      const fresh = PurchaseViewSchema.parse(
        await authenticatedJson(`/api/purchases/v1/${encodeURIComponent(purchase.purchaseId)}`, {
          signal: request.signal,
        }),
      );
      assertProductionSheetAvailable(fresh);
      if (productionSheetIdentity(fresh) !== productionSheetIdentity(source))
        throw new ProductionSheetError('orderChanged', adminMessage('exports:productionSheet.errors.orderChanged'));
      if (Date.now() >= prepared.expiresAt)
        throw new ProductionSheetError(
          'artworkExpiredRetry',
          adminMessage('exports:productionSheet.errors.artworkExpiredRetry'),
        );
      dispatch({
        type: 'preparation-progress',
        attempt: currentAttempt,
        label: adminMessage('exports:productionSheet.progress.preparingPdf'),
      });
      const { productionSheetPdf } = await import('../shared/production-sheet-render');
      const bytes = await productionSheetPdf(prepared, productionOrderName(source), request.signal);
      if (request.signal.aborted || retained.current !== prepared) return;
      if (Date.now() >= prepared.expiresAt)
        throw new ProductionSheetError(
          'artworkExpiredRetry',
          adminMessage('exports:productionSheet.errors.artworkExpiredRetry'),
        );
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      const name =
        productionOrderName(source)
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 70) || source.purchaseId;
      anchor.download = `production-sheet-${name}.pdf`;
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!request.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ProductionSheetError
            ? error.displayMessage
            : adminMessage('exports:productionSheet.errors.downloadUnavailable'),
        );
        deny(error);
      }
    } finally {
      if (controller.current === request) {
        busyClaim.current = false;
        dispatch({ type: 'download-finished', attempt: currentAttempt });
      }
    }
  }
  const source = snapshot.current ?? purchase;
  const quantity = source.groups.reduce(
    (total, group) => total + group.variants.reduce((sum, variant) => sum + BigInt(variant.quantity), 0n),
    0n,
  );
  const formattedQuantity = formatExactCount(quantity, localization.formatLocale);
  const itemSummary =
    formattedQuantity.kind === 'plural'
      ? localization.t('common:counts.items', { count: formattedQuantity.count })
      : localization.t('common:counts.exactTotal', { formattedCount: formattedQuantity.formatted });
  const orderContext = localization.message(productionOrderMessage(source));
  return (
    <>
      <s-button
        slot={triggerSlot}
        variant={triggerSlot === 'primary-action' ? 'primary' : 'secondary'}
        icon="print"
        commandFor={id}
        command="--show"
        disabled={disabled}
      >
        {localization.t('exports:productionSheet.action')}
      </s-button>
      <s-modal
        id={id}
        heading={localization.t('exports:productionSheet.heading')}
        size="large"
        onShow={() => {
          setOpen(true);
          void prepare();
        }}
        onHide={() => {
          setOpen(false);
          clear();
        }}
      >
        <div class="production-sheet-dialog-layout admin-record-id">
          <aside class="production-sheet-details" aria-label={localization.t('exports:productionSheet.detailsLabel')}>
            <div class="production-sheet-order-heading">
              <s-heading fontSize="large">{orderContext}</s-heading>
            </div>
            <dl class="production-sheet-facts">
              <div>
                <dt>{localization.t('exports:productionSheet.itemsLabel')}</dt>
                <dd>
                  <s-text>{itemSummary}</s-text>
                </dd>
              </div>
              <div>
                <dt>{localization.t('exports:productionSheet.designsLabel')}</dt>
                <dd>
                  <s-text>{new Intl.NumberFormat(localization.formatLocale).format(source.groups.length)}</s-text>
                </dd>
              </div>
              <div>
                <dt>{localization.t('exports:productionSheet.formatLabel')}</dt>
                <dd>
                  <s-text>{localization.t('exports:productionSheet.formatA4Pdf')}</s-text>
                </dd>
              </div>
            </dl>
            {sheet?.warnings.length ? (
              <div class="production-sheet-status">
                {sheet.warnings.some((warning) => warning.code === 'testOrder') && (
                  <>
                    <s-badge>{localization.t('exports:productionSheet.testOrderBadge')}</s-badge>
                    <s-text color="subdued">{localization.t('exports:productionSheet.testOnly')}</s-text>
                  </>
                )}
                {sheet.warnings
                  .filter((warning) => warning.code !== 'testOrder')
                  .map((warning) => (
                    <s-banner key={warning.code} tone={warning.tone === 'caution' ? 'warning' : 'auto'}>
                      {localization.message(warning.message)}
                    </s-banner>
                  ))}
              </div>
            ) : null}
            <s-paragraph color="subdued">
              {localization.t('exports:productionSheet.originalArtworkGuidance')}
            </s-paragraph>
          </aside>
          <div class="production-sheet-document">
            {busy && phase && (
              <div role="status">
                <s-text color="subdued">{localization.message(phase)}</s-text>
              </div>
            )}
            {busy && !sheet && (
              <AdminSkeleton variant="preview" rows={1} label={localization.t('exports:productionSheet.preparing')} />
            )}
            {message && (
              <s-banner tone="critical">
                <div role="status">{localization.message(message)}</div>
              </s-banner>
            )}
            {sheet && <ProductionSheetPreview pages={sheet.pages} pageIndex={pageIndex} onPageChange={setPageIndex} />}
          </div>
        </div>
        {message && !sheet && !busy && (
          <s-button slot="primary-action" variant="primary" disabled={disabled} onClick={() => void prepare()}>
            {localization.t('exports:productionSheet.tryAgain')}
          </s-button>
        )}
        {sheet && (
          <s-button
            slot="primary-action"
            variant="primary"
            loading={busy}
            disabled={busy}
            icon="download"
            onClick={() => void download()}
          >
            {localization.t('exports:productionSheet.downloadPdf')}
          </s-button>
        )}
        <s-button slot="secondary-actions" commandFor={id} command="--hide">
          {localization.t('exports:productionSheet.close')}
        </s-button>
      </s-modal>
    </>
  );
}
