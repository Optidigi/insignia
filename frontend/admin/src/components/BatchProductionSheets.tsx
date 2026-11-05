import type { PurchaseView } from '@insignia/contracts';
import { adminMessage } from '@insignia/ui-localization/admin';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { orderDetailHref } from '../shared/orders-return-path';
import {
  initialPreparedExportState,
  type PreparedExportEvent,
  type PreparedExportState,
  preparedExportReducer,
} from '../shared/prepared-export-state';
import { type ExportMessage, ProductionSheetError } from '../shared/production-sheet';
import type { ProductionBatch } from '../shared/production-sheet-batch';
import AdminActionChip from './AdminActionChip';
import ProductionSheetPreview from './ProductionSheetPreview';

export default function BatchProductionSheets({
  purchases,
  disabled,
  deny,
  compact = false,
}: {
  purchases: PurchaseView[];
  disabled: boolean;
  deny(error: unknown): void;
  compact?: boolean;
}) {
  const id = useId();
  const localization = useAdminLocale();
  const { t: translateUi } = localization;
  const [batch, setBatch] = useState<ProductionBatch | null>(null);
  const [flow, dispatch] = useReducer<
    PreparedExportState<ExportMessage>,
    PreparedExportEvent<ExportMessage>,
    undefined
  >(preparedExportReducer, undefined, () => initialPreparedExportState<ExportMessage>());
  const busy = flow.phase === 'preparing' || flow.phase === 'downloading';
  const { message } = flow;
  const phase = flow.progress;
  const attempt = useRef(0);
  const busyClaim = useRef(false);
  const [pageIndex, setPageIndex] = useState(0);
  const request = useRef<AbortController | null>(null);
  const retained = useRef<ProductionBatch | null>(null);
  const selection = purchases.map((purchase) => purchase.purchaseId).join(',');
  const activeSelection = useRef(selection);
  activeSelection.current = selection;
  function clear(message?: ExportMessage) {
    request.current?.abort();
    request.current = null;
    retained.current?.dispose();
    retained.current = null;
    setBatch(null);
    busyClaim.current = false;
    dispatch({ type: 'invalidated', attempt: ++attempt.current, ...(message ? { message } : {}) });
  }
  useLayoutEffect(() => {
    clear();
    return clear;
  }, [selection]);
  useEffect(() => {
    if (!batch || !Number.isFinite(batch.expiresAt)) return;
    const timer = setTimeout(
      () => {
        if (retained.current !== batch) return;
        clear(adminMessage('exports:batch.errors.artworkExpired'));
      },
      Math.max(0, Math.min(batch.expiresAt - Date.now(), 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [batch]);
  async function prepare() {
    if (busyClaim.current) return;
    clear();
    busyClaim.current = true;
    const currentAttempt = attempt.current;
    dispatch({
      type: 'preparation-started',
      attempt: currentAttempt,
      label: adminMessage('exports:batch.preparing'),
    });
    setPageIndex(0);
    const controller = new AbortController();
    request.current = controller;
    const requested = selection;
    try {
      const { prepareProductionBatch } = await import('../shared/production-sheet-batch');
      controller.signal.throwIfAborted();
      const outputLocale = localization;
      const result = await prepareProductionBatch(
        purchases,
        controller.signal,
        (count, _total, label) => {
          if (!controller.signal.aborted && request.current === controller)
            dispatch({
              type: 'preparation-progress',
              attempt: currentAttempt,
              completed: count,
              label: label ?? adminMessage('exports:batch.checkingOrders'),
            });
        },
        outputLocale,
      );
      if (controller.signal.aborted || requested !== activeSelection.current) {
        result.dispose();
        return;
      }
      retained.current = result;
      setBatch(result);
      dispatch({ type: 'prepared', attempt: currentAttempt });
    } catch (error) {
      if (!controller.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ProductionSheetError
            ? error.displayMessage
            : adminMessage('exports:batch.errors.prepareFailed'),
        );
        deny(error);
      }
    } finally {
      if (request.current === controller) {
        busyClaim.current = false;
        dispatch({ type: 'download-finished', attempt: currentAttempt });
      }
    }
  }
  async function download() {
    const prepared = retained.current;
    const controller = request.current;
    if (!prepared || !controller || busyClaim.current) return;
    busyClaim.current = true;
    const currentAttempt = attempt.current;
    dispatch({
      type: 'download-started',
      attempt: currentAttempt,
      label: adminMessage('exports:batch.checkingOrders'),
    });
    try {
      const { productionBatchPdf } = await import('../shared/production-sheet-batch');
      const bytes = await productionBatchPdf(prepared, controller.signal);
      if (controller.signal.aborted || retained.current !== prepared) return;
      const count = prepared.entries.filter((entry) => entry.status === 'ready').length;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `production-sheets-${count}-orders.pdf`;
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ProductionSheetError
            ? error.displayMessage
            : adminMessage('exports:batch.errors.downloadUnavailable'),
        );
        deny(error);
      }
    } finally {
      if (request.current === controller) {
        busyClaim.current = false;
        dispatch({ type: 'download-finished', attempt: currentAttempt });
      }
    }
  }
  const ready = batch?.entries.filter((entry) => entry.status === 'ready') ?? [];
  const held = ready.filter((entry) => entry.sheet.hold);
  const failed = batch?.entries.filter((entry) => entry.status === 'error') ?? [];
  const pluralParams = (value: number) => {
    const count = formatExactCount(BigInt(value), localization.formatLocale);
    if (count.kind !== 'plural') throw new RangeError('Batch counts remain within safe integer range');
    return { count: count.count, formattedCount: count.formatted };
  };
  const notIncludedSummary = localization.t('exports:batch.notIncluded', pluralParams(failed.length));
  const worksheetSummary = localization.t('exports:batch.worksheetCount', pluralParams(ready.length));
  const heldSummary = localization.t('exports:batch.holdCount', pluralParams(held.length));
  const downloadSummary = localization.t('exports:batch.downloadSelected', {
    formattedReadyCount: new Intl.NumberFormat(localization.formatLocale).format(ready.length),
    formattedTotalCount: new Intl.NumberFormat(localization.formatLocale).format(purchases.length),
  });
  const pages = ready.flatMap((entry) =>
    entry.sheet.pages.map((page) => ({
      ...page,
      selectorLabel: localization.t('exports:batch.pageLabel', {
        orderName: localization.message(entry.label),
        pageName: page.label,
      }),
    })),
  );
  const pageSummary = localization.t('exports:batch.pageCount', pluralParams(pages.length));
  return (
    <>
      {compact ? (
        <AdminActionChip
          accessibilityLabel={translateUi('exports:batchProductionSheets.productionSheets')}
          commandFor={id}
          command="--show"
          disabled={disabled}
        >
          {translateUi('exports:batchProductionSheets.productionSheets')}
        </AdminActionChip>
      ) : (
        <s-button icon="print" commandFor={id} command="--show" disabled={disabled}>
          {translateUi('exports:batchProductionSheets.productionSheets')}
        </s-button>
      )}
      <s-modal
        id={id}
        heading={translateUi('exports:batchProductionSheets.productionSheets')}
        size="large"
        onShow={() => void prepare()}
        onHide={() => {
          clear();
        }}
      >
        <div class="admin-record-id">
          <s-stack gap="base">
            <s-paragraph>
              {translateUi(
                'exports:batchProductionSheets.reviewTheWorksheetsThenDownloadOnePDFUseOriginalArtworkFilesForProduction',
              )}
            </s-paragraph>
            {busy && !batch && (
              <div role="status">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-spinner
                    accessibilityLabel={translateUi('exports:batchProductionSheets.preparingProductionSheets')}
                  />
                  <s-text>{localization.message(phase ?? adminMessage('exports:batch.preparing'))}</s-text>
                </s-stack>
              </div>
            )}
            {busy && batch && (
              <div role="status">
                <s-text>{translateUi('exports:batchProductionSheets.checkingOrdersBeforeDownload')}</s-text>
              </div>
            )}
            {message && (
              <s-banner tone="critical">
                <div role="status">{localization.message(message)}</div>
              </s-banner>
            )}
            {failed.length > 0 && <s-banner tone="warning">{notIncludedSummary}</s-banner>}
            {batch && (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">
                  {localization.t('exports:batch.preparedSummary', {
                    worksheetSummary,
                    pageSummary,
                  })}
                </s-text>
                {held.length > 0 && (
                  <s-badge tone="caution" icon="incomplete">
                    {heldSummary}
                  </s-badge>
                )}
              </s-stack>
            )}
            {batch && (
              <s-query-container>
                <s-grid
                  gridTemplateColumns={
                    pages.length
                      ? "@container (inline-size > 760px) 'minmax(0, 1.15fr) minmax(0, 0.85fr)', '1fr'"
                      : '1fr'
                  }
                  gap="base"
                  alignItems="start"
                >
                  {pages.length > 0 && (
                    <s-section heading={translateUi('exports:batchProductionSheets.pDFPreview')}>
                      <ProductionSheetPreview pages={pages} pageIndex={pageIndex} onPageChange={setPageIndex} />
                    </s-section>
                  )}
                  <s-stack gap="base">
                    <s-section
                      heading={translateUi(failed.length ? 'exports:batch.inThisPdf' : 'exports:batch.ordersInThisPdf')}
                    >
                      <s-stack gap="small">
                        {ready.map((entry) => (
                          <div class="production-sheet-order-summary" key={entry.purchaseId}>
                            <s-grid gridTemplateColumns="minmax(0, 1fr) auto" alignItems="center" gap="small">
                              <s-link
                                href={orderDetailHref(entry.purchaseId)}
                                interestFor={`${id}-${entry.purchaseId}`}
                              >
                                <div class="order-record-name">{localization.message(entry.label)}</div>
                              </s-link>
                              <s-text color="subdued">
                                {localization.t('exports:batch.pageCount', pluralParams(entry.sheet.pages.length))}
                              </s-text>
                            </s-grid>
                            <s-tooltip id={`${id}-${entry.purchaseId}`}>{localization.message(entry.label)}</s-tooltip>
                            {(entry.sheet.hold ||
                              entry.sheet.warnings.some((warning) => warning.code === 'testOrder')) && (
                              <s-stack direction="inline" gap="small-200">
                                {entry.sheet.hold && (
                                  <s-badge tone="caution" icon="incomplete">
                                    {translateUi('exports:batchProductionSheets.onHold')}
                                  </s-badge>
                                )}
                                {entry.sheet.warnings.some((warning) => warning.code === 'testOrder') && (
                                  <s-badge>{translateUi('exports:batchProductionSheets.test')}</s-badge>
                                )}
                              </s-stack>
                            )}
                            {entry.sheet.warnings
                              .filter((warning) => warning.code !== 'testOrder')
                              .map((warning) => (
                                <s-text key={warning.code} tone="caution">
                                  {localization.message(warning.message)}
                                </s-text>
                              ))}
                          </div>
                        ))}
                      </s-stack>
                    </s-section>
                    {failed.length > 0 && (
                      <s-section heading={translateUi('exports:batchProductionSheets.notIncluded')}>
                        <s-stack gap="small">
                          {failed.map((entry) => (
                            <div class="production-sheet-order-summary" key={entry.purchaseId}>
                              <s-link
                                href={orderDetailHref(entry.purchaseId)}
                                interestFor={`${id}-${entry.purchaseId}`}
                              >
                                <div class="order-record-name">{localization.message(entry.label)}</div>
                              </s-link>
                              <s-tooltip id={`${id}-${entry.purchaseId}`}>
                                {localization.message(entry.label)}
                              </s-tooltip>
                              <s-text tone="critical">{localization.message(entry.message)}</s-text>
                            </div>
                          ))}
                        </s-stack>
                      </s-section>
                    )}
                  </s-stack>
                </s-grid>
              </s-query-container>
            )}
            {!busy && !batch && message && (
              <s-button onClick={() => void prepare()}>
                {translateUi('exports:batchProductionSheets.tryAgain')}
              </s-button>
            )}
            {!busy && batch && failed.length > 0 && (
              <s-button onClick={() => void prepare()}>
                {translateUi('exports:batchProductionSheets.prepareAllSelectedOrdersAgain')}
              </s-button>
            )}
          </s-stack>
        </div>
        {ready.length > 0 && (
          <s-button
            slot="primary-action"
            variant="primary"
            icon="download"
            loading={busy}
            disabled={busy}
            onClick={() => void download()}
          >
            {failed.length ? downloadSummary : translateUi('exports:batch.downloadPdf')}
          </s-button>
        )}
        <s-button slot="secondary-actions" commandFor={id} command="--hide">
          {translateUi('exports:batchProductionSheets.close')}
        </s-button>
      </s-modal>
    </>
  );
}
