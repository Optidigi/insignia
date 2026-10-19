import {
  type PurchaseGroup,
  PurchaseListViewSchema,
  PurchasePrivateUrlSchema,
  type PurchaseView,
  PurchaseViewSchema,
} from '@insignia/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import AdminSkeleton from '../components/AdminSkeleton';
import PrivatePreviewImage from '../components/PrivatePreviewImage';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { exactPurchaseMoney } from '../shared/purchase-view';
import ArtworkUpload from './ArtworkUpload';
import PurchaseHistoricalPreview from './PurchaseHistoricalPreview';

function recordDate(value: string) {
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}
const artworkLabel = (state: PurchaseView['artworkState']): string =>
  ({
    PENDING_ARTWORK: 'Artwork needed',
    READY: 'Artwork complete',
    ARTWORK_LOCKED: 'Artwork locked',
    ERASED: 'Artwork no longer retained',
  })[state];
const endpoint = (id: string) => `/api/purchases/v1/${encodeURIComponent(id)}`;
function HistoricalOriginal({
  purchaseId,
  assetId,
  deny,
}: {
  purchaseId: string;
  assetId: string;
  deny: (error: unknown) => void;
}) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setLink(null), Math.max(0, Date.parse(link.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [link]);
  async function download() {
    setBusy(true);
    try {
      const result = PurchasePrivateUrlSchema.parse(
        await authenticatedJson(`${endpoint(purchaseId)}/artwork/${encodeURIComponent(assetId)}/download`),
      );
      if (!active.current) return;
      if (Date.parse(result.expiresAt) <= Date.now()) throw new Error('Artwork link expired');
      setLink(result);
    } catch (e) {
      if (active.current) {
        setLink(null);
        setMessage(e instanceof Error ? e.message : 'Original unavailable');
        deny(e);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <s-text>
      {' '}
      <s-button type="button" disabled={busy} onClick={() => void download()}>
        Get original uploaded file
      </s-button>
      {link && Date.parse(link.expiresAt) > Date.now() && (
        <s-link href={link.url} target="_blank">
          Download historical original
        </s-link>
      )}
      <div role="status">
        <s-text>{message}</s-text>
      </div>
    </s-text>
  );
}
function Placement({
  purchase,
  group,
  placement,
  changed,
  deny,
  disabled,
}: {
  purchase: PurchaseView;
  group: PurchaseGroup;
  placement: PurchaseGroup['placements'][number];
  changed: (view: PurchaseView) => void;
  deny: (error: unknown) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retentionExpired, setRetentionExpired] = useState(placement.expired);
  const [link, setLink] = useState<{ url: string; expiresAt: string; identity: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; expiresAt: string; identity: string } | null>(null);
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
    setSelected(null);
    setBusy(false);
    setLink(null);
    setPreview(null);
    setRetentionExpired(
      placement.expired || (!!placement.currentExpiresAt && Date.parse(placement.currentExpiresAt) <= Date.now()),
    );
    setMessage('');
    return () => {
      generation.current++;
    };
  }, [
    purchase.purchaseId,
    purchase.artworkVersion,
    placement.currentAssetId,
    placement.currentExpiresAt,
    placement.expired,
  ]);
  useEffect(() => {
    const next = [link?.expiresAt, preview?.expiresAt, placement.currentExpiresAt]
      .filter(Boolean)
      .map((x) => Date.parse(x!));
    if (!next.length) return;
    const timer = setTimeout(
      () => {
        setLink(null);
        setPreview(null);
        if (placement.currentExpiresAt && Date.parse(placement.currentExpiresAt) <= Date.now())
          setRetentionExpired(true);
      },
      Math.max(0, Math.min(...next) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [link, preview, placement.currentExpiresAt]);
  async function access(kind: 'download' | 'preview') {
    if (!assetUsable) return;
    const requestedIdentity = identity;
    const current = generation.current;
    setBusy(true);
    try {
      const result = PurchasePrivateUrlSchema.parse(
        await authenticatedJson(
          `${endpoint(purchase.purchaseId)}/artwork/${encodeURIComponent(placement.currentAssetId!)}/${kind}`,
        ),
      );
      if (current !== generation.current || requestedIdentity !== latestIdentity.current) return;
      if (Date.parse(result.expiresAt) <= Date.now()) throw new Error('Artwork link expired');
      if (kind === 'download') setLink({ ...result, identity: requestedIdentity });
      else setPreview({ ...result, identity: requestedIdentity });
    } catch (e) {
      if (current === generation.current && requestedIdentity === latestIdentity.current) {
        setMessage(e instanceof Error ? e.message : 'Artwork unavailable');
        deny(e);
      }
    } finally {
      if (current === generation.current && requestedIdentity === latestIdentity.current) setBusy(false);
    }
  }
  async function attach() {
    if (!selected) return;
    const current = generation.current;
    setBusy(true);
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
        setMessage(
          (e as { status?: number }).status === 409
            ? 'Artwork changed. Refresh the purchase before continuing.'
            : e instanceof Error
              ? e.message
              : 'Attachment unavailable',
        );
        deny(e);
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const label = group.presentation?.labels.placements?.[placement.id] ?? placement.id;
  return (
    <section aria-label={`Artwork ${label}`}>
      <s-stack gap="base">
        <s-divider />
        <s-heading>{label}</s-heading>
        <s-text color="subdued">
          Method: {group.presentation?.labels.methods?.[placement.methodId] ?? placement.methodId} · Size:{' '}
          {group.presentation?.labels.steps?.[placement.stepId] ?? placement.stepId}
        </s-text>
        <s-paragraph>
          Purchased artwork:{' '}
          {placement.originalArtwork.kind === 'deferred' ? 'Logo later' : 'Original file supplied at purchase'}
        </s-paragraph>
        {placement.originalArtwork.kind === 'revision' &&
          placement.originalArtwork.revisionId !== placement.currentAssetId && (
            <HistoricalOriginal
              purchaseId={purchase.purchaseId}
              assetId={placement.originalArtwork.revisionId}
              deny={deny}
            />
          )}
        {placement.currentExpiresAt && (
          <s-paragraph>
            Artwork available until:{' '}
            <s-text data-date-time={placement.currentExpiresAt}>{recordDate(placement.currentExpiresAt)}</s-text>.{' '}
            {retentionExpired
              ? 'Artwork expired.'
              : Date.parse(placement.currentExpiresAt) - Date.now() <= 30 * 86400000
                ? Date.parse(placement.currentExpiresAt) - Date.now() <= 7 * 86400000
                  ? 'Deletion within 7 days. Download before deletion.'
                  : 'Retention expiry within 30 days. Download before deletion.'
                : ''}
          </s-paragraph>
        )}
        {assetUsable && !retentionExpired && (
          <>
            <s-button type="button" disabled={busy || disabled} onClick={() => void access('preview')}>
              Preview artwork
            </s-button>
            <s-button type="button" disabled={busy || disabled} onClick={() => void access('download')}>
              Prepare original download
            </s-button>
          </>
        )}
        {assetUsable && preview?.identity === identity && Date.parse(preview.expiresAt) > Date.now() && (
          <PrivatePreviewImage src={preview.url} alt={`Verified PNG ${label}`} maxWidth={200} maxHeight={200} />
        )}
        {assetUsable && link?.identity === identity && Date.parse(link.expiresAt) > Date.now() && (
          <s-link href={link.url} target="_blank">
            Download verified original
          </s-link>
        )}
        {purchase.lines.length > 0 &&
          purchase.artworkState !== 'ARTWORK_LOCKED' &&
          !purchase.artworkEvents.some((event) => event.kind === 'LOCK') &&
          Date.parse(group.payloadExpiresAt) > Date.now() && (
            <>
              <ArtworkUpload
                onPreview={() => {}}
                onAssetChange={(asset) => setSelected(asset?.assetId ?? null)}
                onAuthenticationDenied={deny}
                disabled={disabled || busy}
                allowOriginalDownload={false}
              />
              <s-button type="button" disabled={!selected || disabled || busy} onClick={() => void attach()}>
                {placement.currentAssetId || purchase.artworkState === 'ERASED' ? 'Replace artwork' : 'Attach artwork'}
              </s-button>
            </>
          )}
        <div role="status">
          <s-paragraph>{message}</s-paragraph>
        </div>
      </s-stack>
    </section>
  );
}
export default function PurchaseArtwork({ purchaseId }: { purchaseId?: string }) {
  const [items, setItems] = useState<PurchaseView[]>([]);
  const [artworkFilter, setArtworkFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  useAdminPageReady(!busy);
  const [denied, setDenied] = useState(false);
  const current = useRef(0);
  function deny(error: unknown) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
      current.current++;
      setDenied(true);
      setBusy(false);
      setPurchase(null);
      setItems([]);
      setMessage('Your Shopify identity or permission could not be verified. Reopen from Shopify Admin.');
    }
  }
  async function load(before?: string) {
    const generation = ++current.current;
    setBusy(true);
    try {
      if (purchaseId) {
        const result = PurchaseViewSchema.parse(await authenticatedJson(endpoint(purchaseId)));
        if (generation === current.current) setPurchase(result);
      } else {
        const result = PurchaseListViewSchema.parse(
          await authenticatedJson('/api/purchases/v1' + (before ? '?before=' + encodeURIComponent(before) : '')),
        );
        if (generation === current.current) {
          setItems((items) => (before ? [...items, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        }
      }
      if (generation === current.current) setMessage('');
    } catch (e) {
      if (generation === current.current) {
        setMessage(e instanceof Error ? e.message : 'Purchase unavailable');
        deny(e);
      }
    } finally {
      if (generation === current.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      current.current++;
    };
  }, [purchaseId]);
  async function command(kind: 'lock' | 'reconcile') {
    if (!purchase || busy) return;
    const generation = current.current;
    setBusy(true);
    try {
      const result = PurchaseViewSchema.parse(
        await authenticatedJson(`${endpoint(purchase.purchaseId)}/${kind}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kind === 'lock' ? { expectedVersion: purchase.artworkVersion } : {}),
        }),
      );
      if (generation === current.current) {
        setPurchase(result);
        setMessage(
          kind === 'lock'
            ? 'Artwork locked.'
            : 'Reconciliation requested. Refresh later for independently read Shopify facts.',
        );
      }
    } catch (e) {
      if (generation === current.current) {
        setMessage(
          (e as { status?: number }).status === 409
            ? 'Artwork changed. Refresh the purchase before continuing.'
            : e instanceof Error
              ? e.message
              : 'Action unavailable',
        );
        deny(e);
      }
    } finally {
      if (generation === current.current) setBusy(false);
    }
  }
  const orderFilters = (
    <s-box padding="base">
      <s-stack gap="small">
        <s-select
          label="Artwork status"
          value={artworkFilter}
          onChange={(event) => setArtworkFilter(event.currentTarget.value)}
        >
          <s-option value="all">All artwork statuses</s-option>
          <s-option value="PENDING_ARTWORK">Artwork needed</s-option>
          <s-option value="READY">Artwork complete</s-option>
          <s-option value="ARTWORK_LOCKED">Artwork locked</s-option>
          <s-option value="ERASED">Artwork no longer retained</s-option>
        </s-select>
        <s-paragraph>Filters apply to loaded orders. Load older orders to include them.</s-paragraph>
        <s-paragraph>
          {items.filter((item) => artworkFilter === 'all' || item.artworkState === artworkFilter).length} of{' '}
          {items.length} loaded orders
        </s-paragraph>
      </s-stack>
    </s-box>
  );
  return (
    <s-page inlineSize="base" heading={purchaseId ? (purchase?.orderName ?? 'Order details') : 'Orders and artwork'}>
      {purchaseId && (
        <s-link slot="breadcrumb-actions" href="/admin/orders">
          Orders
        </s-link>
      )}
      {message && (
        <s-banner tone="info">
          <div role="status" aria-live="polite">
            <s-paragraph>{message}</s-paragraph>
          </div>
        </s-banner>
      )}
      {!denied && (
        <s-button type="button" disabled={busy} onClick={() => void load()}>
          {purchaseId ? 'Refresh purchase' : 'Refresh orders'}
        </s-button>
      )}
      {!purchaseId && !denied && (
        <s-section accessibilityLabel="Customized orders" padding="none">
          <s-stack gap="base">
            {busy && items.length === 0 && <AdminSkeleton label="Loading orders" />}
            {items.length === 0 && !busy && (
              <s-empty-state heading="No customized orders yet">
                <s-paragraph slot="subheading">No customized orders recorded.</s-paragraph>
                <s-button slot="primary-action" variant="primary" href="/admin/products">
                  Configure products
                </s-button>
              </s-empty-state>
            )}
            {nextCursor && (
              <s-button type="button" disabled={busy} onClick={() => void load(nextCursor)}>
                Load older orders
              </s-button>
            )}
            {items.length > 0 && (
              <s-table loading={busy}>
                <s-box slot="filters">{orderFilters}</s-box>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header listSlot="secondary">Created</s-table-header>
                  <s-table-header listSlot="inline">Artwork</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Total
                  </s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {items
                    .filter((item) => artworkFilter === 'all' || item.artworkState === artworkFilter)
                    .map((item) => (
                      <s-table-row key={item.purchaseId}>
                        <s-table-cell>
                          <s-link href={`/admin/orders/${item.purchaseId}`}>
                            {item.orderName ?? 'Order name unavailable'}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>
                          <s-text data-date-time={item.orderCreatedAt}>{recordDate(item.orderCreatedAt)}</s-text>
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={item.artworkState === 'PENDING_ARTWORK' ? 'warning' : 'neutral'}>
                            {item.lines.length
                              ? artworkLabel(item.artworkState)
                              : 'Order customization needs verification'}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          {exactPurchaseMoney(item.originalTotalMinor, item.exponent, item.currency)}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                </s-table-body>
              </s-table>
            )}
            {items.length > 0 &&
              !items.some((item) => artworkFilter === 'all' || item.artworkState === artworkFilter) && (
                <s-paragraph>No loaded orders match this artwork status.</s-paragraph>
              )}
          </s-stack>
        </s-section>
      )}
      {purchaseId && !purchase && busy && (
        <s-section>
          <s-stack gap="base">
            <AdminSkeleton label="Loading order and artwork" rows={4} />
          </s-stack>
        </s-section>
      )}
      {purchase && (
        <>
          <s-section slot="aside" heading="Order summary">
            <s-stack gap="base">
              <s-heading>{purchase.orderName ?? 'Order name unavailable'}</s-heading>
              <s-paragraph>
                Order created:{' '}
                <s-text data-date-time={purchase.orderCreatedAt}>{recordDate(purchase.orderCreatedAt)}</s-text>
              </s-paragraph>
              <s-paragraph>
                {purchase.isTest === true
                  ? 'Test order.'
                  : purchase.isTest === null
                    ? 'Test status unavailable.'
                    : 'Non-test order.'}
              </s-paragraph>
              <s-paragraph>
                {exactPurchaseMoney(purchase.originalTotalMinor, purchase.exponent, purchase.currency)}
              </s-paragraph>
              <s-paragraph>
                Shopify payment status: {purchase.financialStatus.toLowerCase().replaceAll('_', ' ')}. First fully paid:{' '}
                {purchase.firstPaidAt ? (
                  <s-text data-date-time={purchase.firstPaidAt}>{recordDate(purchase.firstPaidAt)}</s-text>
                ) : (
                  'Not recorded'
                )}
                .
              </s-paragraph>
              {purchase.cancelledAt && (
                <s-paragraph>
                  Shopify cancellation:{' '}
                  <s-text data-date-time={purchase.cancelledAt}>{recordDate(purchase.cancelledAt)}</s-text>
                </s-paragraph>
              )}
              <s-paragraph>Shopify owns payment, fulfillment, refunds, returns and restock.</s-paragraph>
              {purchase.exceptions.map((exception, index) => (
                <div role="alert" key={index}>
                  <s-paragraph>Reconciliation exception: {exception}</s-paragraph>
                </div>
              ))}

              <AdminDisclosure label="Show order and variant references">
                <s-paragraph>{purchase.orderId}</s-paragraph>
                {purchase.lines.map((line) => (
                  <s-paragraph key={line.orderLineId}>
                    {line.productId} / {line.variantId}
                  </s-paragraph>
                ))}
              </AdminDisclosure>

              <s-button type="button" disabled={busy} onClick={() => void command('reconcile')}>
                Check order updates in Shopify
              </s-button>
            </s-stack>
          </s-section>
          <s-section heading="Artwork and customization">
            <s-stack gap="base">
              {purchase.lines.length > 0 && (
                <s-paragraph>Artwork status: {artworkLabel(purchase.artworkState)}</s-paragraph>
              )}
              {purchase.lines.length === 0 ? (
                <s-paragraph>
                  Order customization needs verification. Do not begin production until its details have been checked.
                </s-paragraph>
              ) : purchase.artworkState === 'ERASED' &&
                !purchase.groups.some((group) => Date.parse(group.payloadExpiresAt) > Date.now()) ? (
                <s-paragraph>Production detail erased. Historical economics remain.</s-paragraph>
              ) : (
                <>
                  {purchase.artworkState === 'ERASED' && purchase.groups.length > 0 && (
                    <s-paragraph>
                      {purchase.artworkEvents.some((event) => event.kind === 'LOCK')
                        ? 'Selected artwork unavailable. Artwork lock remains in force.'
                        : 'Selected artwork unavailable; explicitly replace within remaining detail retention.'}
                    </s-paragraph>
                  )}
                  {purchase.groups.map((group) => (
                    <section key={group.index}>
                      <s-stack gap="base">
                        <s-divider />
                        <s-heading>Customization {group.index + 1}</s-heading>
                        <AdminDisclosure label="Saved production reference">
                          <s-paragraph>Historical revision: {group.configRevisionId}</s-paragraph>
                        </AdminDisclosure>
                        <s-paragraph>
                          Design retention deadline:{' '}
                          <s-text data-date-time={group.payloadExpiresAt}>{recordDate(group.payloadExpiresAt)}</s-text>
                        </s-paragraph>
                        <PurchaseHistoricalPreview
                          purchaseId={purchase.purchaseId}
                          group={group}
                          lines={purchase.lines}
                          deny={deny}
                        />
                        {group.placements.map((placement) => (
                          <Placement
                            key={placement.id}
                            purchase={purchase}
                            group={group}
                            placement={placement}
                            changed={setPurchase}
                            deny={deny}
                            disabled={busy || denied}
                          />
                        ))}
                      </s-stack>
                    </section>
                  ))}
                  <s-button
                    type="button"
                    disabled={
                      busy ||
                      purchase.artworkState !== 'READY' ||
                      purchase.artworkEvents.some((event) => event.kind === 'LOCK') ||
                      purchase.groups.length === 0 ||
                      purchase.groups.some((group) => Date.parse(group.payloadExpiresAt) <= Date.now())
                    }
                    onClick={() => void command('lock')}
                  >
                    Lock artwork
                  </s-button>
                </>
              )}
            </s-stack>
          </s-section>
          <s-section heading="Purchased variants">
            <s-stack gap="base">
              {purchase.lines.map((line) => (
                <s-paragraph key={line.orderLineId}>
                  {line.title ?? 'Purchased item name unavailable'}
                  {line.variantTitle ? ` · ${line.variantTitle}` : ''}: {line.quantity} ×{' '}
                  {exactPurchaseMoney(line.unitPriceMinor, purchase.exponent, purchase.currency)}
                </s-paragraph>
              ))}
            </s-stack>
          </s-section>
          <s-section heading="Attachment history">
            <s-stack gap="base">
              {purchase.artworkEvents.map((event) => (
                <s-paragraph key={event.eventId}>
                  Version {event.version}: {event.kind}{' '}
                  {event.erasedAt ? '— artwork detail erased' : (event.assetId ?? '')}
                  {event.expiresAt && (
                    <>
                      {' '}
                      · original deadline{' '}
                      <s-text data-date-time={event.expiresAt}>{recordDate(event.expiresAt)}</s-text>
                    </>
                  )}
                  {event.kind === 'ATTACH' &&
                    event.assetId &&
                    !event.erasedAt &&
                    event.expiresAt &&
                    Date.parse(event.expiresAt) > Date.now() && (
                      <HistoricalOriginal purchaseId={purchase.purchaseId} assetId={event.assetId} deny={deny} />
                    )}
                </s-paragraph>
              ))}
              {purchase.artworkEvents.length === 0 && (
                <s-paragraph>No artwork replacements or locks recorded.</s-paragraph>
              )}
            </s-stack>
          </s-section>
          <s-section heading="Shopify refund records">
            <s-stack gap="base">
              <s-paragraph>
                Refund records do not prove that money has settled. Shopify remains the payment authority.
              </s-paragraph>
              {purchase.refunds.length === 0 && <s-paragraph>No refunds recorded.</s-paragraph>}
              {purchase.refunds.map((refund) => (
                <s-paragraph key={refund.refundId}>
                  {refund.refundId}: {exactPurchaseMoney(refund.amountMinor, purchase.exponent, refund.currency)} ·{' '}
                  <s-text data-date-time={refund.occurredAt}>{recordDate(refund.occurredAt)}</s-text>
                  {refund.lines.map((line) => (
                    <s-text key={line.lineId}>
                      {' '}
                      · {line.lineId}: {line.quantity} recorded for refund,{' '}
                      {exactPurchaseMoney(line.amountMinor, purchase.exponent, refund.currency)}
                    </s-text>
                  ))}
                </s-paragraph>
              ))}
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}
