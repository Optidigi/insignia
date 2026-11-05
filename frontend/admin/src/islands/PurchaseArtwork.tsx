import {
  type PurchaseGroup,
  PurchasePrivateUrlSchema,
  type PurchaseView,
  PurchaseViewSchema,
} from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import AdminSkeleton from '../components/AdminSkeleton';
import ArtworkArchiveDownload from '../components/ArtworkArchiveDownload';
import OriginalArtworkDownload from '../components/OriginalArtworkDownload';
import PrivatePreviewImage from '../components/PrivatePreviewImage';
import PurchaseArtworkHistory from '../components/PurchaseArtworkHistory';
import PurchaseDesignPreview from '../components/PurchaseDesignPreview';
import { PurchaseDetailAsideSkeleton, PurchaseDetailSkeleton } from '../components/PurchaseDetailSkeleton';
import PurchaseItems, { PurchasedItemImage } from '../components/PurchaseItems';
import PurchaseProductionSheet from '../components/PurchaseProductionSheet';
import PurchaseVariants from '../components/PurchaseVariants';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { artworkStatus } from '../shared/artwork-status';
import { ordersReturnPath } from '../shared/orders-return-path';
import { startOriginalArtworkDownload } from '../shared/original-artwork-download';
import { localizedPurchaseMoney } from '../shared/purchase-view';
import { initialRemoteReadState, remoteReadReducer } from '../shared/remote-read-state';
import { attachmentReducer, initialAttachmentState } from './purchase-attachment-state';
import '../styles/purchase-artwork.css';
import ArtworkUpload from './ArtworkUpload';

const endpoint = (id: string) => `/api/purchases/v1/${encodeURIComponent(id)}`;
function Placement({
  purchase,
  group,
  placement,
  changed,
  deny,
  disabled,
  onJumpTarget,
}: {
  purchase: PurchaseView;
  group: PurchaseGroup;
  placement: PurchaseGroup['placements'][number];
  changed: (view: PurchaseView) => void;
  deny: (error: unknown) => void;
  disabled: boolean;
  onJumpTarget?: (target: (() => void) | null) => void;
}) {
  const { t, formatLocale } = useAdminLocale();
  const row = useRef<HTMLElement>(null);
  const attachButton = useRef<HTMLElementTagNameMap['s-button']>(null);
  const uploadControl = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    onJumpTarget?.(() => {
      row.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      (uploadControl.current ?? attachButton.current)?.focus({ preventScroll: true });
    });
    return () => onJumpTarget?.(null);
  }, [onJumpTarget]);
  const previewId = useId();
  const previewOpen = useRef(false);
  const [flow, dispatchAttachment] = useReducer(attachmentReducer, '', initialAttachmentState);
  const [assetExpired, setRetentionExpired] = useState(placement.expired);
  const retentionExpired = assetExpired || Date.parse(group.payloadExpiresAt) <= Date.now();
  const accessExpiresAt =
    placement.currentExpiresAt && Date.parse(placement.currentExpiresAt) < Date.parse(group.payloadExpiresAt)
      ? placement.currentExpiresAt
      : group.payloadExpiresAt;
  const [preview, setPreview] = useState<{
    url: string;
    expiresAt: string;
    identity: string;
    aspectRatio?: number;
  } | null>(null);
  const generation = useRef(0);
  // A render may observe erasure before passive effects run. Bind every URL to
  // the exact current selection and reject responses from an earlier selection.
  const identity = JSON.stringify([
    purchase.purchaseId,
    purchase.artworkVersion,
    placement.currentAssetId,
    placement.currentExpiresAt,
    placement.expired,
    group.payloadExpiresAt,
  ]);
  const selected = flow.identity === identity ? flow.selected : null;
  const replacing = flow.identity === identity && flow.replacing;
  const errorCode = flow.identity === identity ? flow.errorCode : null;
  const message = (() => {
    switch (errorCode) {
      case 'accessFailed':
        return t('orders:purchaseArtwork.placement.accessFailed');
      case 'artworkChanged':
        return t('orders:purchaseArtwork.placement.changed');
      case 'attachmentFailed':
        return t('orders:purchaseArtwork.placement.attachFailed');
      default:
        return '';
    }
  })();
  const busy = flow.identity === identity && flow.operation !== 'idle';
  const command = useRef<number | null>(null);
  const requestId = useRef(0);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const assetUsable =
    !!placement.currentAssetId &&
    !placement.expired &&
    !!placement.currentExpiresAt &&
    Date.parse(placement.currentExpiresAt) > Date.now() &&
    Date.parse(group.payloadExpiresAt) > Date.now();
  useEffect(() => {
    generation.current++;
    command.current = null;
    dispatchAttachment({ type: 'context-changed', identity, request: ++requestId.current });
    setPreview(null);
    setRetentionExpired(
      placement.expired || (!!placement.currentExpiresAt && Date.parse(placement.currentExpiresAt) <= Date.now()),
    );
    return () => {
      generation.current++;
      command.current = null;
    };
  }, [
    purchase.purchaseId,
    purchase.artworkVersion,
    placement.currentAssetId,
    placement.currentExpiresAt,
    placement.expired,
    group.payloadExpiresAt,
  ]);
  useEffect(() => {
    const next = [preview?.expiresAt, placement.currentExpiresAt, group.payloadExpiresAt]
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value));
    if (!next.length) return;
    const timer = setTimeout(
      () => {
        setPreview(null);
        if (Date.parse(accessExpiresAt) <= Date.now()) setRetentionExpired(true);
      },
      Math.max(0, Math.min(...next) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview, placement.currentExpiresAt, group.payloadExpiresAt, accessExpiresAt]);
  async function access(kind: 'download' | 'preview') {
    if (!assetUsable || !placement.currentAssetId || command.current !== null) return;
    const requestedIdentity = identity;
    const current = generation.current;
    const request = ++requestId.current;
    command.current = request;
    dispatchAttachment({ type: 'operation-started', identity, request, operation: kind });
    try {
      const result = PurchasePrivateUrlSchema.parse(
        await authenticatedJson(
          `${endpoint(purchase.purchaseId)}/artwork/${encodeURIComponent(placement.currentAssetId)}/${kind}`,
        ),
      );
      if (current !== generation.current || requestedIdentity !== latestIdentity.current) return;
      if (Date.parse(result.expiresAt) <= Date.now() || Date.parse(accessExpiresAt) <= Date.now())
        throw new Error('Artwork link expired');
      if (kind === 'download') startOriginalArtworkDownload(result.url);
      else if (previewOpen.current) setPreview({ ...result, identity: requestedIdentity });
    } catch (e) {
      if (current === generation.current && requestedIdentity === latestIdentity.current) {
        dispatchAttachment({
          type: 'operation-failed',
          identity: requestedIdentity,
          request,
          errorCode: 'accessFailed',
        });
        deny(e);
      }
    } finally {
      if (command.current === request) command.current = null;
      if (current === generation.current && requestedIdentity === latestIdentity.current)
        dispatchAttachment({ type: 'operation-finished', identity: requestedIdentity, request });
    }
  }
  async function attach() {
    if (!selected || command.current !== null) return;
    const current = generation.current;
    const request = ++requestId.current;
    command.current = request;
    const requestedIdentity = identity;
    dispatchAttachment({ type: 'operation-started', identity, request, operation: 'attach' });
    try {
      const result = PurchaseViewSchema.parse(
        await authenticatedJson(`${endpoint(purchase.purchaseId)}/artwork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: purchase.artworkVersion,
            groupIndex: group.index,
            placementId: placement.id,
            assetId: selected,
          }),
        }),
      );
      if (current === generation.current) changed(result);
    } catch (e) {
      if (current === generation.current) {
        dispatchAttachment({
          type: 'operation-failed',
          identity: requestedIdentity,
          request,
          errorCode: (e as { status?: number }).status === 409 ? 'artworkChanged' : 'attachmentFailed',
        });
        deny(e);
      }
    } finally {
      if (command.current === request) command.current = null;
      if (current === generation.current)
        dispatchAttachment({ type: 'operation-finished', identity: requestedIdentity, request });
    }
  }
  const label =
    group.presentation?.labels.placements?.[placement.id] ??
    t('orders:purchaseArtwork.placement.fallback', {
      formattedNumber: new Intl.NumberFormat(formatLocale).format(group.placements.indexOf(placement) + 1),
    });
  const canAttach =
    purchase.lines.length > 0 &&
    purchase.artworkState !== 'ARTWORK_LOCKED' &&
    !purchase.artworkEvents.some((event) => event.kind === 'LOCK') &&
    Date.parse(group.payloadExpiresAt) > Date.now();
  const replaced =
    assetUsable &&
    placement.originalArtwork.kind === 'revision' &&
    placement.originalArtwork.revisionId !== placement.currentAssetId;
  const uploadLabel =
    placement.currentAssetId || placement.originalArtwork.kind === 'revision'
      ? t('orders:purchaseArtwork.placement.replace')
      : t('orders:purchaseArtwork.placement.attach');
  return (
    <section
      ref={row}
      aria-label={t('orders:purchaseArtwork.placement.ariaLabel', { placementName: label })}
      class="purchase-placement"
    >
      <s-stack gap="small">
        <s-divider />
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="small" alignItems="center">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">{label}</s-text>
                <s-badge tone={assetUsable ? 'neutral' : 'caution'} icon={assetUsable ? 'enabled' : 'incomplete'}>
                  {assetUsable
                    ? replaced
                      ? t('orders:purchaseArtwork.placement.status.replaced')
                      : placement.originalArtwork.kind === 'deferred'
                        ? t('orders:purchaseArtwork.placement.status.attached')
                        : t('orders:purchaseArtwork.placement.status.provided')
                    : retentionExpired
                      ? t('orders:purchaseArtwork.placement.status.unavailable')
                      : t('orders:purchaseArtwork.placement.status.needed')}
                </s-badge>
              </s-stack>
              <s-text color="subdued">
                {group.presentation?.labels.methods?.[placement.methodId] ?? t('orders:summary.methodUnavailable')} ·{' '}
                {group.presentation?.labels.steps?.[placement.stepId] ??
                  t('orders:purchaseArtwork.placement.sizeUnavailable')}
              </s-text>
            </s-stack>
            <div class="purchase-placement-actions">
              {assetUsable && !retentionExpired && (
                <>
                  <span class="purchase-placement-action">
                    <s-button
                      variant="tertiary"
                      icon="image"
                      accessibilityLabel={t('orders:purchaseArtwork.placement.preview')}
                      interestFor={`${previewId}-hint`}
                      commandFor={previewId}
                      command="--show"
                      disabled={busy || disabled}
                      onClick={() => {
                        previewOpen.current = true;
                        void access('preview');
                      }}
                    />
                    <s-tooltip id={`${previewId}-hint`}>{t('orders:purchaseArtwork.placement.preview')}</s-tooltip>
                  </span>
                  <s-button
                    icon="download"
                    loading={busy}
                    disabled={busy || disabled}
                    onClick={() => void access('download')}
                  >
                    {t('orders:purchaseArtwork.placement.download')}
                  </s-button>
                </>
              )}
              {canAttach && !replacing && (
                <s-button
                  ref={attachButton}
                  variant={assetUsable ? 'tertiary' : 'secondary'}
                  icon={assetUsable ? 'edit' : 'upload'}
                  disabled={disabled || busy}
                  onClick={() => dispatchAttachment({ type: 'replacement-requested', identity })}
                >
                  {uploadLabel}
                </s-button>
              )}
            </div>
          </s-grid>
        </s-query-container>
        {retentionExpired && <s-text color="subdued">{t('orders:purchaseArtwork.placement.retentionEnded')}</s-text>}
        {assetUsable && !retentionExpired && Date.parse(accessExpiresAt) - Date.now() <= 7 * 86400000 && (
          <s-banner tone="warning">
            {t('orders:purchaseArtwork.placement.deleteSoon', {
              date: t('orders:artworkHistory.dateUtc', {
                date: new Intl.DateTimeFormat(formatLocale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'UTC',
                }).format(new Date(accessExpiresAt)),
              }),
            })}
          </s-banner>
        )}
        {canAttach && replacing && (
          <s-box background="subdued" padding="base" borderRadius="base">
            <s-stack gap="small">
              <ArtworkUpload
                focusRef={uploadControl}
                onPreview={() => {}}
                onAssetChange={(asset) =>
                  dispatchAttachment({ type: 'upload-selected', identity, assetId: asset?.assetId ?? null })
                }
                onAuthenticationDenied={deny}
                disabled={disabled || busy}
                allowOriginalDownload={false}
              />
              <div class="purchase-artwork-replacement-actions">
                <s-button
                  variant="primary"
                  disabled={!selected || disabled || busy}
                  loading={busy}
                  onClick={() => void attach()}
                >
                  {uploadLabel}
                </s-button>
                <s-button
                  disabled={disabled || busy}
                  onClick={() => {
                    dispatchAttachment({ type: 'replacement-cancelled', identity });
                  }}
                >
                  {t('common:actions.cancel')}
                </s-button>
              </div>
            </s-stack>
          </s-box>
        )}
        {placement.originalArtwork.kind === 'revision' &&
          placement.originalArtwork.revisionId !== placement.currentAssetId && (
            <AdminDisclosure label={t('orders:purchaseArtwork.placement.originalArtwork')}>
              <OriginalArtworkDownload
                purchaseId={purchase.purchaseId}
                assetId={placement.originalArtwork.revisionId}
                deny={deny}
              />
            </AdminDisclosure>
          )}
        {message && (
          <div role="status">
            <s-text tone="critical">{message}</s-text>
          </div>
        )}
      </s-stack>
      <s-modal
        id={previewId}
        heading={t('orders:purchaseArtwork.placement.previewHeading', { placementName: label })}
        onHide={() => {
          previewOpen.current = false;
          setPreview(null);
        }}
      >
        {assetUsable && preview?.identity === identity && Date.parse(preview.expiresAt) > Date.now() ? (
          <div class="purchase-artwork-preview-frame">
            <PrivatePreviewImage
              src={preview.url}
              alt={t('orders:purchaseArtwork.placement.previewAlt', { placementName: label })}
              aspectRatio={preview.aspectRatio}
              maxWidth={480}
              maxHeight={480}
            />
          </div>
        ) : busy ? (
          <AdminSkeleton variant="preview" label={t('orders:purchaseArtwork.placement.previewLoading')} rows={1} />
        ) : (
          <div role="status" aria-live="polite">
            <s-text>{message || t('orders:purchaseArtwork.placement.previewUnavailable')}</s-text>
          </div>
        )}
        <s-button slot="primary-action" commandFor={previewId} command="--hide">
          {t('common:actions.done')}
        </s-button>
      </s-modal>
    </section>
  );
}

function PurchaseArtwork({ purchaseId, returnTo }: { purchaseId: string; returnTo?: string }) {
  const { t, formatLocale } = useAdminLocale();
  const actionsId = useId();
  const missingTargets = useRef(new Map<string, () => void>());
  const lastMissing = useRef<string | null>(null);
  const [read, dispatchRead] = useReducer(
    remoteReadReducer<PurchaseView>,
    undefined,
    initialRemoteReadState<PurchaseView>,
  );
  const purchase = read.value;
  const message = (() => {
    switch (read.phase) {
      case 'denied':
        return t('orders:purchaseArtwork.read.accessDenied');
      case 'missing':
        return t('orders:purchaseArtwork.read.notFound');
      case 'failed':
        return t(purchase ? 'orders:purchaseArtwork.read.refreshFailed' : 'orders:purchaseArtwork.read.loadFailed');
      default:
        return '';
    }
  })();
  const recordDate = (value: string) =>
    t('orders:artworkHistory.dateUtc', {
      date: new Intl.DateTimeFormat(formatLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(value)),
    });
  const paymentLabel = (status: string) => {
    switch (status) {
      case 'PAID':
        return t('orders:payment.paid');
      case 'REFUNDED':
        return t('orders:payment.refunded');
      case 'PARTIALLY_REFUNDED':
        return t('orders:payment.partiallyRefunded');
      case 'PARTIALLY_PAID':
        return t('orders:payment.partiallyPaid');
      case 'AUTHORIZED':
        return t('orders:payment.authorized');
      case 'VOIDED':
        return t('orders:payment.voided');
      case 'PENDING':
        return t('orders:payment.pending');
      case 'EXPIRED':
        return t('orders:payment.expired');
      default:
        return t('orders:payment.unknown');
    }
  };
  const busy = read.phase === 'loading';
  const [now, setNow] = useState(Date.now);
  const retentionDeadlines =
    purchase?.groups.flatMap((group) => [
      Date.parse(group.payloadExpiresAt),
      ...group.placements.flatMap((placement) =>
        placement.currentAssetId && placement.currentExpiresAt ? [Date.parse(placement.currentExpiresAt)] : [],
      ),
    ]) ?? [];
  const nextExpiry = Math.min(...retentionDeadlines.filter((deadline) => deadline > now));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(nextExpiry - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [nextExpiry, now]);
  // Release the generic route shell once this island can paint its own detail skeleton.
  useAdminPageReady(true);
  const denied = read.phase === 'denied';
  const notFound = read.phase === 'missing';
  const current = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  function acceptArtworkChange(result: PurchaseView) {
    activeRead.current?.abort();
    dispatchRead({ type: 'observation-replaced', request: ++current.current, value: result });
  }
  function deny(error: unknown) {
    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    if (status === 401 || status === 403) {
      activeRead.current?.abort();
      dispatchRead({
        type: 'access-revoked',
        request: ++current.current,
        status,
        message: '',
      });
    }
  }
  async function load(clear = false) {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    const generation = ++current.current;
    dispatchRead({ type: 'read-started', request: generation, clear });
    try {
      const value = PurchaseViewSchema.parse(
        await authenticatedJson(endpoint(purchaseId), { signal: controller.signal }),
      );
      if (generation === current.current && !controller.signal.aborted)
        dispatchRead({ type: 'read-succeeded', request: generation, value });
    } catch (error) {
      if (generation !== current.current || controller.signal.aborted) return;
      const status =
        error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
          ? error.status
          : undefined;
      dispatchRead({ type: 'read-failed', request: generation, status, message: '' });
    }
  }
  useEffect(() => {
    lastMissing.current = null;
    void load(true);
    return () => {
      current.current++;
      activeRead.current?.abort();
    };
  }, [purchaseId]);
  const missingArtwork =
    purchase &&
    purchase.lines.length > 0 &&
    purchase.artworkState !== 'ARTWORK_LOCKED' &&
    !purchase.artworkEvents.some((event) => event.kind === 'LOCK')
      ? purchase.groups.flatMap((group) =>
          Date.parse(group.payloadExpiresAt) > Date.now()
            ? group.placements
                .filter(
                  (placement) =>
                    placement.expired ||
                    !placement.currentAssetId ||
                    !placement.currentExpiresAt ||
                    Date.parse(placement.currentExpiresAt) <= Date.now(),
                )
                .map((placement) => `${group.index}:${placement.id}`)
            : [],
        )
      : [];
  const exactMissingArtwork = formatExactCount(BigInt(missingArtwork.length), formatLocale);
  const missingArtworkLabel =
    exactMissingArtwork.kind === 'plural'
      ? t('orders:purchaseArtwork.warnings.missingArtwork', {
          count: exactMissingArtwork.count,
          formattedCount: exactMissingArtwork.formatted,
        })
      : t('orders:purchaseArtwork.warnings.missingArtworkExact', {
          formattedCount: exactMissingArtwork.formatted,
        });
  function jumpToMissingArtwork() {
    if (busy || !missingArtwork.length) return;
    const previous = lastMissing.current === null ? -1 : missingArtwork.indexOf(lastMissing.current);
    const target = missingArtwork[(previous + 1) % missingArtwork.length];
    if (!target) return;
    const jump = missingTargets.current.get(target);
    if (!jump) return;
    lastMissing.current = target;
    jump();
  }
  const shopifyOrderId = purchase?.orderId.match(/^gid:\/\/shopify\/Order\/([1-9][0-9]*)$/)?.[1];
  return (
    <s-page inlineSize="base" heading={t('orders:pageTitle')}>
      <s-link slot="breadcrumb-actions" href={ordersReturnPath(returnTo ?? null)}>
        {t('orders:pageTitle')}
      </s-link>
      {purchase && (
        <>
          <PurchaseProductionSheet
            purchase={purchase}
            disabled={busy || denied}
            deny={deny}
            triggerSlot="primary-action"
          />
          <ArtworkArchiveDownload
            purchases={[purchase]}
            disabled={busy || denied}
            deny={deny}
            triggerSlot="secondary-actions"
          />
          {shopifyOrderId && (
            <s-button
              slot="secondary-actions"
              variant="secondary"
              commandFor={actionsId}
              accessibilityLabel={t('orders:purchaseArtwork.actions.orderActions')}
            >
              {t('orders:purchaseArtwork.actions.more')}
            </s-button>
          )}
        </>
      )}
      {message && (
        <s-banner
          tone={denied || !purchase ? 'critical' : 'info'}
          heading={
            denied
              ? t('orders:purchaseArtwork.badges.accessUnavailable')
              : !purchase
                ? t('orders:purchaseArtwork.badges.orderUnavailable')
                : undefined
          }
        >
          <div role="status" aria-live="polite">
            <s-paragraph>{message}</s-paragraph>
          </div>
          {!denied && !notFound && !busy && (
            <s-button slot="secondary-actions" onClick={() => void load()}>
              {t('orders:purchaseArtwork.actions.tryAgain')}
            </s-button>
          )}
        </s-banner>
      )}
      {!purchase && busy && (
        <>
          <PurchaseDetailSkeleton />
          <div slot="aside" class="purchase-detail-support">
            <PurchaseDetailAsideSkeleton />
          </div>
        </>
      )}
      {purchase && (
        <>
          <PurchaseItems purchase={purchase} aside />
          <div class="purchase-detail-primary">
            <s-stack gap="base">
              <div class="admin-record-id">
                <s-stack gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading fontSize="large-200">
                      {purchase.orderName ??
                        t('orders:order.reference', {
                          orderNumber: purchase.orderId.slice(purchase.orderId.lastIndexOf('/') + 1),
                        })}
                    </s-heading>
                    <s-badge
                      icon={
                        ['PAID', 'REFUNDED', 'VOIDED'].includes(purchase.financialStatus) ? 'enabled' : 'incomplete'
                      }
                      tone={purchase.financialStatus === 'PENDING' ? 'caution' : 'neutral'}
                    >
                      {paymentLabel(purchase.financialStatus)}
                    </s-badge>
                    <s-badge
                      icon={artworkStatus(purchase, Math.max(now, Date.now())) === 'needed' ? 'incomplete' : 'enabled'}
                      tone={artworkStatus(purchase, Math.max(now, Date.now())) === 'needed' ? 'caution' : 'neutral'}
                    >
                      {artworkStatus(purchase, Math.max(now, Date.now())) === 'needed'
                        ? t('orders:artwork.needed')
                        : t('orders:artwork.complete')}
                    </s-badge>
                    {purchase.isTest === true && <s-badge>{t('orders:badges.test')}</s-badge>}
                    {purchase.cancelledAt && <s-badge>{t('orders:badges.cancelled')}</s-badge>}
                  </s-stack>
                  <s-text color="subdued" data-date-time={purchase.orderCreatedAt}>
                    {recordDate(purchase.orderCreatedAt)}
                  </s-text>
                </s-stack>
              </div>
              {purchase.cancelledAt && (
                <s-banner tone="warning" heading={t('orders:purchaseArtwork.warnings.orderCancelledHeading')}>
                  <s-paragraph>{t('orders:purchaseArtwork.warnings.orderCancelledBody')}</s-paragraph>
                </s-banner>
              )}
              {purchase.exceptions.length > 0 && (
                <s-banner tone="warning" heading={t('orders:purchaseArtwork.warnings.orderReviewHeading')}>
                  <s-paragraph>{t('orders:purchaseArtwork.warnings.orderReviewBody')}</s-paragraph>
                </s-banner>
              )}
              <s-stack gap="base">
                {missingArtwork.length > 0 && (
                  <s-banner tone="warning" heading={t('orders:purchaseArtwork.warnings.artworkNeededHeading')}>
                    <s-paragraph>{missingArtworkLabel}</s-paragraph>
                    <s-button slot="secondary-actions" disabled={busy} onClick={jumpToMissingArtwork}>
                      {t('orders:purchaseArtwork.actions.jumpToMissingArtwork')}
                    </s-button>
                  </s-banner>
                )}
                {shopifyOrderId && (
                  <s-menu id={actionsId} accessibilityLabel={t('orders:purchaseArtwork.actions.orderActions')}>
                    <s-button href={`shopify://admin/orders/${shopifyOrderId}`} target="_top">
                      {t('orders:purchaseArtwork.actions.viewInShopify')}
                    </s-button>
                  </s-menu>
                )}
                {purchase.lines.length === 0 || purchase.groups.length === 0 ? (
                  <s-section>
                    <s-paragraph>{t('orders:purchaseArtwork.verification.customizationUnavailable')}</s-paragraph>
                  </s-section>
                ) : purchase.artworkState === 'ERASED' &&
                  !purchase.groups.some((group) => Date.parse(group.payloadExpiresAt) > Date.now()) ? (
                  <s-section>
                    <s-paragraph>{t('orders:purchaseArtwork.verification.erasedUnavailable')}</s-paragraph>
                  </s-section>
                ) : (
                  <>
                    {purchase.artworkState === 'ERASED' && purchase.groups.length > 0 && (
                      <s-banner tone="warning">
                        {purchase.artworkEvents.some((event) => event.kind === 'LOCK')
                          ? t('orders:purchaseArtwork.artworkState.currentUnavailableLocked')
                          : t('orders:purchaseArtwork.artworkState.currentUnavailableReplace')}
                      </s-banner>
                    )}
                    {purchase.groups.map((group) => {
                      const line = purchase.lines.find(
                        (item) =>
                          item.productId === group.productId &&
                          group.variants.some((variant) => variant.variantId === item.variantId),
                      );
                      const title = line?.title ?? t('orders:purchaseArtwork.design.productUnavailable');
                      const designs = purchase.groups.filter((candidate) => candidate.productId === group.productId);
                      const design = designs.findIndex((candidate) => candidate.index === group.index) + 1;
                      const formattedDesign = new Intl.NumberFormat(formatLocale).format(design);
                      return (
                        <section
                          key={group.index}
                          aria-label={
                            designs.length > 1
                              ? t('orders:purchaseArtwork.design.ariaLabel', {
                                  productName: title,
                                  formattedNumber: formattedDesign,
                                })
                              : t('orders:purchaseArtwork.design.customization', { productName: title })
                          }
                          class="purchase-design"
                        >
                          <s-section>
                            <s-stack gap="base">
                              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small" alignItems="start">
                                {line && <PurchasedItemImage groups={[group]} line={line} />}
                                <s-query-container>
                                  <s-grid
                                    gridTemplateColumns="@container (inline-size > 420px) 1fr auto, 1fr"
                                    gap="small"
                                    alignItems="start"
                                  >
                                    <s-stack gap="small-300">
                                      <s-heading>
                                        {designs.length > 1
                                          ? t('orders:purchaseArtwork.design.heading', {
                                              productName: title,
                                              formattedNumber: formattedDesign,
                                            })
                                          : title}
                                      </s-heading>
                                      <PurchaseVariants group={group} lines={purchase.lines} />
                                    </s-stack>

                                    <PurchaseDesignPreview
                                      key={`${purchase.purchaseId}:${purchase.artworkVersion}:${group.index}`}
                                      purchaseId={purchase.purchaseId}
                                      group={group}
                                      lines={purchase.lines}
                                      deny={deny}
                                      disabled={busy || denied}
                                    />
                                  </s-grid>
                                </s-query-container>
                              </s-grid>
                              {group.placements.length === 0 && (
                                <s-banner
                                  tone="warning"
                                  heading={t('orders:purchaseArtwork.design.noPlacementsHeading')}
                                >
                                  {t('orders:purchaseArtwork.verification.placementDetailsMissing')}
                                </s-banner>
                              )}
                              {group.placements.map((placement) => (
                                <Placement
                                  key={placement.id}
                                  purchase={purchase}
                                  group={group}
                                  placement={placement}
                                  changed={acceptArtworkChange}
                                  deny={deny}
                                  disabled={busy || denied}
                                  onJumpTarget={
                                    missingArtwork.includes(`${group.index}:${placement.id}`)
                                      ? (target) => {
                                          const key = `${group.index}:${placement.id}`;
                                          if (target) missingTargets.current.set(key, target);
                                          else missingTargets.current.delete(key);
                                        }
                                      : undefined
                                  }
                                />
                              ))}
                            </s-stack>
                          </s-section>
                        </section>
                      );
                    })}
                  </>
                )}
              </s-stack>
              <PurchaseArtworkHistory purchase={purchase} deny={deny} />
            </s-stack>
          </div>
          <div slot="aside" class="purchase-detail-support">
            <s-section heading={t('orders:purchaseArtwork.payment.heading')}>
              <s-badge slot="graphic" icon="receipt" size="large" />
              <s-badge slot="supplemental">{paymentLabel(purchase.financialStatus)}</s-badge>
              <s-box padding="base">
                <div class="admin-record-id">
                  <s-stack gap="base">
                    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base">
                      <s-text type="strong">{t('orders:purchaseArtwork.payment.originalTotal')}</s-text>
                      <s-stack alignItems="end">
                        <s-text type="strong">
                          {localizedPurchaseMoney(
                            purchase.originalTotalMinor,
                            purchase.exponent,
                            purchase.currency,
                            formatLocale,
                          )}
                        </s-text>
                      </s-stack>
                    </s-grid>
                    <s-divider />
                    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base">
                      <s-text>{t('orders:purchaseArtwork.payment.firstFullyPaid')}</s-text>
                      <s-stack alignItems="end">
                        <s-text>
                          {purchase.firstPaidAt
                            ? recordDate(purchase.firstPaidAt)
                            : t('orders:purchaseArtwork.payment.notRecorded')}
                        </s-text>
                      </s-stack>
                    </s-grid>
                    {purchase.refunds.length > 0 && (
                      <>
                        <s-divider />
                        <s-heading>{t('orders:purchaseArtwork.payment.refundRecords')}</s-heading>
                        <s-paragraph color="subdued">{t('orders:purchaseArtwork.payment.settlementNote')}</s-paragraph>
                        {purchase.refunds.map((refund) => (
                          <s-stack gap="small" key={refund.refundId}>
                            <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1.5fr)" gap="base">
                              <s-text data-date-time={refund.occurredAt}>{recordDate(refund.occurredAt)}</s-text>
                              <s-text>
                                {localizedPurchaseMoney(
                                  refund.amountMinor,
                                  purchase.exponent,
                                  refund.currency,
                                  formatLocale,
                                )}
                              </s-text>
                            </s-grid>
                            <AdminDisclosure label={t('orders:purchaseArtwork.payment.refundDetails')}>
                              <s-stack gap="small">
                                {refund.lines.map((line) => (
                                  <s-text key={line.lineId}>
                                    {t('orders:purchaseArtwork.payment.refundLine', {
                                      itemName:
                                        purchase.lines.find((item) => item.orderLineId === line.lineId)?.title ??
                                        t('orders:purchaseArtwork.payment.purchasedItem'),
                                      formattedQuantity: formatExactCount(BigInt(line.quantity), formatLocale)
                                        .formatted,
                                      amount: localizedPurchaseMoney(
                                        line.amountMinor,
                                        purchase.exponent,
                                        refund.currency,
                                        formatLocale,
                                      ),
                                    })}
                                  </s-text>
                                ))}
                              </s-stack>
                            </AdminDisclosure>
                          </s-stack>
                        ))}
                      </>
                    )}
                  </s-stack>
                </div>
              </s-box>
            </s-section>
          </div>
        </>
      )}
    </s-page>
  );
}

export default withAdminLocale(PurchaseArtwork);
