import type { PurchaseView } from '@insignia/contracts';
import { adminMessage } from '@insignia/ui-localization/admin';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import type { ArtworkArchive } from '../shared/artwork-archive';
import { ArtworkArchiveError } from '../shared/artwork-archive-error';
import {
  initialPreparedExportState,
  type PreparedExportEvent,
  type PreparedExportState,
  preparedExportReducer,
} from '../shared/prepared-export-state';
import {
  type ExportMessage,
  productionOrderName,
  productionOrderWarnings,
  productionSheetIdentity,
} from '../shared/production-sheet';
import AdminActionChip from './AdminActionChip';
import '../styles/artwork-archive-download.css';

type OrderNote = { purchase: PurchaseView; holds: ReturnType<typeof productionOrderWarnings> };

/** Explicit, bounded preparation. Signed URLs and original bytes are never persisted. */
export default function ArtworkArchiveDownload({
  purchases,
  disabled,
  deny,
  triggerSlot,
  compact = false,
}: {
  purchases: PurchaseView[];
  disabled: boolean;
  deny(error: unknown): void;
  triggerSlot?: 'secondary-actions';
  compact?: boolean;
}) {
  const id = useId();
  const localization = useAdminLocale();
  const { t: translateUi } = localization;
  const [result, setResult] = useState<ArtworkArchive | null>(null);
  const [flow, dispatch] = useReducer<
    PreparedExportState<ExportMessage>,
    PreparedExportEvent<ExportMessage>,
    undefined
  >(preparedExportReducer, undefined, () => initialPreparedExportState<ExportMessage>());
  const busy = flow.phase === 'preparing' || flow.phase === 'downloading';
  const { message } = flow;
  const progress = flow.progress;
  const attempt = useRef(0);
  const busyClaim = useRef(false);
  const [reportPage, setReportPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  const retained = useRef<ArtworkArchive | null>(null);
  const identity = purchases.map(productionSheetIdentity).join('\n');
  function clear(message?: ExportMessage) {
    request.current?.abort();
    request.current = null;
    retained.current?.dispose();
    retained.current = null;
    setResult(null);
    busyClaim.current = false;
    dispatch({ type: 'invalidated', attempt: ++attempt.current, ...(message ? { message } : {}) });
  }
  useLayoutEffect(() => {
    clear();
    return clear;
  }, [identity]);
  useEffect(() => {
    if (!result || !Number.isFinite(result.expiresAt)) return;
    const timer = setTimeout(
      () => {
        if (retained.current !== result) return;
        clear(adminMessage('exports:artworkArchive.errors.accessExpired'));
      },
      Math.max(0, Math.min(result.expiresAt - Date.now(), 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [result]);
  async function prepare() {
    if (busyClaim.current) return;
    clear();
    busyClaim.current = true;
    const currentAttempt = attempt.current;
    const outputLocale = localization;
    dispatch({
      type: 'preparation-started',
      attempt: currentAttempt,
      label: adminMessage('exports:artworkArchive.progress.readingOrderDetails'),
    });
    setReportPage(0);
    const controller = new AbortController();
    request.current = controller;
    try {
      const { prepareArtworkArchive } = await import('../shared/artwork-archive');
      const archive = await prepareArtworkArchive(
        purchases.map((purchase) => purchase.purchaseId),
        controller.signal,
        (label) => {
          if (!controller.signal.aborted && request.current === controller)
            dispatch({ type: 'preparation-progress', attempt: currentAttempt, label });
        },
        outputLocale,
      );
      if (controller.signal.aborted || request.current !== controller) {
        archive.dispose();
        return;
      }
      retained.current = archive;
      setResult(archive);
      dispatch({ type: 'prepared', attempt: currentAttempt });
    } catch (error) {
      if (!controller.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ArtworkArchiveError
            ? error.displayMessage
            : adminMessage('exports:artworkArchive.errors.prepareFailed'),
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
    const archive = retained.current,
      controller = request.current;
    if (!archive || !controller || busyClaim.current) return;
    busyClaim.current = true;
    const currentAttempt = attempt.current;
    const outputLocale = localization;
    dispatch({
      type: 'download-started',
      attempt: currentAttempt,
      label: adminMessage('exports:artworkArchive.progress.checkingOrder'),
    });
    try {
      const bytes = await archive.download(controller.signal, outputLocale);
      if (controller.signal.aborted || retained.current !== archive) return;
      if (Date.now() >= archive.expiresAt)
        throw new ArtworkArchiveError('accessExpired', adminMessage('exports:artworkArchive.errors.accessExpired'));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = archive.filename;
      if (Date.now() >= archive.expiresAt) {
        URL.revokeObjectURL(url);
        throw new ArtworkArchiveError('accessExpired', adminMessage('exports:artworkArchive.errors.accessExpired'));
      }
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) {
        clear(
          error instanceof Error && error instanceof ArtworkArchiveError
            ? error.displayMessage
            : adminMessage('exports:artworkArchive.errors.downloadUnavailable'),
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
  const orderNotes: OrderNote[] = (result?.purchases ?? purchases).map((purchase) => ({
    purchase,
    holds: productionOrderWarnings(purchase).filter((note) => note.tone === 'caution'),
  }));
  const holds = orderNotes.filter((item) => item.holds.length > 0);
  const omitted = result?.entries.filter((entry) => !entry.file) ?? [];
  const retryableEmptyResult = result?.files === 0 && result.entries.some((entry) => entry.retryable === true);
  const pluralParams = (value: number) => {
    const count = formatExactCount(BigInt(value), localization.formatLocale);
    if (count.kind !== 'plural') throw new RangeError('Archive counts remain within safe integer range');
    return { count: count.count, formattedCount: count.formatted };
  };
  const omittedSummary = localization.t('exports:artworkArchive.omittedSummary', pluralParams(omitted.length));
  const attentionSummary = localization.t('exports:artworkArchive.attentionSummary', pluralParams(holds.length));
  const warningSummary =
    omitted.length > 0 && holds.length > 0
      ? localization.t('exports:artworkArchive.warningBoth', { omittedSummary, attentionSummary })
      : omitted.length > 0
        ? localization.t('exports:artworkArchive.warningOmissions', { omittedSummary })
        : localization.t('exports:artworkArchive.warningAttention', { attentionSummary });
  const fileSummary = result
    ? localization.t('exports:artworkArchive.fileCount', pluralParams(result.files))
    : localization.t('exports:artworkArchive.preparing');
  const orderSelectionSummary = localization.t('exports:artworkArchive.orderSelection', pluralParams(purchases.length));
  const downloadFilesSummary = result
    ? localization.t('exports:artworkArchive.downloadFiles', pluralParams(result.files))
    : '';
  type ArchiveEntry = ArtworkArchive['entries'][number];
  type ArchiveGroup = {
    order: string;
    orderLabel: ExportMessage;
    designs: Map<string, { entry: ArchiveEntry; index: number }[]>;
  };
  const pageEntries: ArchiveEntry[] = result?.entries.slice(reportPage * 20, (reportPage + 1) * 20) ?? [];
  const groups = new Map<string, ArchiveGroup>();
  pageEntries.forEach((entry, localIndex) => {
    const group: ArchiveGroup = groups.get(entry.order) ?? {
      order: entry.order,
      orderLabel: entry.orderLabel,
      designs: new Map(),
    };
    const design = group.designs.get(entry.design) ?? [];
    design.push({ entry, index: reportPage * 20 + localIndex });
    group.designs.set(entry.design, design);
    groups.set(entry.order, group);
  });
  const firstFileIndex = new Map<string, number>();
  result?.entries.forEach((entry, index) => {
    if (entry.file && !firstFileIndex.has(entry.file)) firstFileIndex.set(entry.file, index);
  });
  const notesByOrder = new Map<string, OrderNote>(orderNotes.map((note) => [productionOrderName(note.purchase), note]));
  return (
    <>
      {compact ? (
        <AdminActionChip
          accessibilityLabel={translateUi('exports:artworkArchiveDownload.downloadArtwork')}
          disabled={disabled}
          commandFor={id}
          command="--show"
        >
          {translateUi('exports:artworkArchiveDownload.downloadArtwork')}
        </AdminActionChip>
      ) : (
        <s-button
          slot={triggerSlot}
          variant="secondary"
          icon="download"
          disabled={disabled}
          commandFor={id}
          command="--show"
        >
          {translateUi('exports:artworkArchiveDownload.downloadArtwork')}
        </s-button>
      )}
      <s-modal
        id={id}
        heading={translateUi('exports:artworkArchiveDownload.downloadArtwork')}
        size={purchases.length === 1 ? 'base' : 'large'}
        onShow={() => void prepare()}
        onHide={() => {
          clear();
        }}
      >
        <s-stack gap="base">
          <div class="artwork-archive-summary">
            <s-icon type="file" color="subdued" />
            <div>
              <s-text type="strong">{fileSummary}</s-text>
              <s-text color="subdued">{orderSelectionSummary}</s-text>
            </div>
          </div>
          {result && (holds.length > 0 || omitted.length > 0) && (
            <s-banner tone="warning" heading={translateUi('exports:artworkArchiveDownload.checkBeforeProduction')}>
              <s-paragraph>{warningSummary}</s-paragraph>
            </s-banner>
          )}
          {busy && (
            <div role="status">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-spinner accessibilityLabel={translateUi('exports:artworkArchiveDownload.preparingArtworkArchive')} />
                {progress && <s-text>{localization.message(progress)}</s-text>}
              </s-stack>
            </div>
          )}
          {message && (
            <s-banner tone="critical">
              <div role="status">
                <s-text>{localization.message(message)}</s-text>
              </div>
            </s-banner>
          )}
          {result && (
            <s-stack gap="base">
              {[...groups.values()].map((group, groupIndex) => {
                const note = notesByOrder.get(group.order);
                const missing = result.entries.filter((entry) => entry.order === group.order && !entry.file).length;
                const orderHeadingId = `${id}-order-${groupIndex}`;
                return (
                  <section class="artwork-archive-order" key={group.order} aria-labelledby={orderHeadingId}>
                    <div class="artwork-archive-order-heading">
                      <s-heading id={orderHeadingId}>{localization.message(group.orderLabel)}</s-heading>
                      <div class="artwork-archive-order-status">
                        {note?.purchase.isTest === true && (
                          <s-badge>{translateUi('exports:artworkArchiveDownload.testOrder')}</s-badge>
                        )}
                        {missing > 0 && (
                          <s-badge tone="warning">
                            {localization.t('exports:artworkArchive.missingPlacements', pluralParams(missing))}
                          </s-badge>
                        )}
                      </div>
                    </div>
                    {note &&
                      note.holds.filter((reason) => reason.code !== 'artworkNeeded' || missing === 0).length > 0 && (
                        <div class="artwork-archive-order-notes">
                          {note.holds
                            .filter((reason) => reason.code !== 'artworkNeeded' || missing === 0)
                            .map((reason) => (
                              <s-text tone="warning" key={reason.code}>
                                {reason.archiveMessage
                                  ? localization.message(reason.archiveMessage)
                                  : localization.message(reason.message)}
                              </s-text>
                            ))}
                        </div>
                      )}
                    {[...group.designs].map(([design, entries]) => {
                      const designEntry = entries[0]?.entry;
                      return (
                        <div class="artwork-archive-group" key={design}>
                          <div class="artwork-archive-design">
                            <s-text type="strong">
                              {designEntry ? localization.message(designEntry.designLabel) : design}
                            </s-text>
                          </div>
                          <ul class="artwork-archive-files">
                            {entries.map(({ entry, index }) => {
                              const tooltipId = `${id}-file-${index}`;
                              const shared = entry.file && firstFileIndex.get(entry.file) !== index;
                              return (
                                <li
                                  class="artwork-archive-entry"
                                  key={`${entry.order}-${entry.design}-${entry.placement}-${index}`}
                                >
                                  <s-icon type={entry.file ? 'file' : 'alert-circle'} color="subdued" />
                                  <div class="artwork-archive-file">
                                    <s-text
                                      type="strong"
                                      tone={entry.file ? 'auto' : 'warning'}
                                      interestFor={entry.file ? tooltipId : undefined}
                                    >
                                      {entry.file?.split('/').at(-1) ??
                                        (entry.placementLabel
                                          ? localization.message(entry.placementLabel)
                                          : entry.placement)}
                                    </s-text>
                                    <s-text
                                      color={entry.file ? 'subdued' : 'base'}
                                      tone={entry.file ? 'auto' : 'warning'}
                                    >
                                      {entry.file
                                        ? entry.placementLabel
                                          ? localization.message(entry.placementLabel)
                                          : entry.placement
                                        : localization.message(
                                            entry.reason ?? adminMessage('exports:artworkArchive.errors.prepareFailed'),
                                          )}
                                    </s-text>
                                    {entry.file && <s-tooltip id={tooltipId}>{entry.file}</s-tooltip>}
                                    {shared && (
                                      <s-text color="subdued">
                                        {translateUi('exports:artworkArchiveDownload.sameFileAsAnotherPlacement')}
                                      </s-text>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {result.entries.length > 20 && (
                <s-stack direction="inline" alignItems="center" justifyContent="space-between">
                  <s-text color="subdued">
                    {localization.t('exports:artworkArchive.pagination', {
                      first: new Intl.NumberFormat(localization.formatLocale).format(reportPage * 20 + 1),
                      last: new Intl.NumberFormat(localization.formatLocale).format(
                        Math.min((reportPage + 1) * 20, result.entries.length),
                      ),
                      total: new Intl.NumberFormat(localization.formatLocale).format(result.entries.length),
                    })}
                  </s-text>
                  <s-stack direction="inline" gap="small-200">
                    <s-button
                      variant="tertiary"
                      icon="chevron-left"
                      accessibilityLabel={translateUi('exports:artworkArchiveDownload.previousPlacements')}
                      disabled={reportPage === 0}
                      onClick={() => setReportPage((page) => Math.max(0, page - 1))}
                    />
                    <s-button
                      variant="tertiary"
                      icon="chevron-right"
                      accessibilityLabel={translateUi('exports:artworkArchiveDownload.nextPlacements')}
                      disabled={(reportPage + 1) * 20 >= result.entries.length}
                      onClick={() => setReportPage((page) => page + 1)}
                    />
                  </s-stack>
                </s-stack>
              )}
            </s-stack>
          )}
          {result && (
            <s-text color="subdued">
              {translateUi('exports:artworkArchiveDownload.includesCurrentOriginalFilesSharedFilesAreIncludedOnce')}
            </s-text>
          )}
        </s-stack>
        <s-button slot="secondary-actions" commandFor={id} command="--hide">
          {translateUi('exports:artworkArchiveDownload.close')}
        </s-button>
        {(message || retryableEmptyResult) && !busy && (
          <s-button slot="primary-action" variant="primary" onClick={() => void prepare()}>
            {translateUi('exports:artworkArchiveDownload.tryAgain')}
          </s-button>
        )}
        {result && result.files > 0 && (
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={busy}
            loading={busy}
            onClick={() => void download()}
          >
            {omitted.length ? downloadFilesSummary : translateUi('exports:artworkArchive.downloadZip')}
          </s-button>
        )}
      </s-modal>
    </>
  );
}
