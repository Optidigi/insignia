import {
  type PurchaseGroup,
  PurchaseListViewSchema,
  PurchasePrivateUrlSchema,
  type PurchaseView,
  PurchaseViewSchema,
} from '@insignia/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
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
    <span>
      {' '}
      <s-button type="button" disabled={busy} onClick={() => void download()}>
        Get original uploaded file
      </s-button>
      {link && Date.parse(link.expiresAt) > Date.now() && (
        <a href={link.url} target="_blank" rel="noopener noreferrer">
          Download historical original
        </a>
      )}
      <span role="status">{message}</span>
    </span>
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
    <section class="purchase-placement" aria-label={`Artwork ${label}`}>
      <h4>
        {label} · {group.presentation?.labels.methods?.[placement.methodId] ?? placement.methodId} ·{' '}
        {group.presentation?.labels.steps?.[placement.stepId] ?? placement.stepId}
      </h4>
      <p>
        Purchased artwork:{' '}
        {placement.originalArtwork.kind === 'deferred' ? 'Logo later' : 'Original file supplied at purchase'}
      </p>
      {placement.originalArtwork.kind === 'revision' &&
        placement.originalArtwork.revisionId !== placement.currentAssetId && (
          <HistoricalOriginal
            purchaseId={purchase.purchaseId}
            assetId={placement.originalArtwork.revisionId}
            deny={deny}
          />
        )}
      {placement.currentExpiresAt && (
        <p>
          Artwork available until:{' '}
          <time dateTime={placement.currentExpiresAt}>{recordDate(placement.currentExpiresAt)}</time>.{' '}
          {retentionExpired
            ? 'Artwork expired.'
            : Date.parse(placement.currentExpiresAt) - Date.now() <= 30 * 86400000
              ? Date.parse(placement.currentExpiresAt) - Date.now() <= 7 * 86400000
                ? 'Deletion within 7 days. Download before deletion.'
                : 'Retention expiry within 30 days. Download before deletion.'
              : ''}
        </p>
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
        <img src={preview.url} alt={`Verified PNG ${label}`} style={{ maxWidth: '200px' }} />
      )}
      {assetUsable && link?.identity === identity && Date.parse(link.expiresAt) > Date.now() && (
        <a href={link.url} target="_blank" rel="noopener noreferrer">
          Download verified original
        </a>
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
      <p role="status">{message}</p>
    </section>
  );
}
export default function PurchaseArtwork({ purchaseId }: { purchaseId?: string }) {
  const [items, setItems] = useState<PurchaseView[]>([]);
  const [artworkFilter, setArtworkFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseView | null>(null);
  const [message, setMessage] = useState('Loading orders…');
  const [busy, setBusy] = useState(true);
  const [denied, setDenied] = useState(false);
  const current = useRef(0);
  function deny(error: unknown) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
      current.current++;
      setDenied(true);
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
  return (
    <s-page heading="Orders and artwork">
      {purchaseId && (
        <s-link slot="breadcrumb-actions" href="/admin/orders">
          Orders
        </s-link>
      )}
      {message && (
        <s-banner tone="info">
          <p role="status" aria-live="polite">
            {message}
          </p>
        </s-banner>
      )}
      {!denied && (
        <s-button type="button" disabled={busy} onClick={() => void load()}>
          {purchaseId ? 'Refresh purchase' : 'Refresh orders'}
        </s-button>
      )}
      {!purchaseId && !denied && (
        <s-section heading="Customized orders">
          {busy && items.length === 0 && <AdminSkeleton label="Loading orders" />}
          {items.length === 0 && !busy && <p>No customized orders recorded.</p>}
          {nextCursor && (
            <s-button type="button" disabled={busy} onClick={() => void load(nextCursor)}>
              Load older orders
            </s-button>
          )}
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
          {items.length > 0 && (
            <s-table loading={busy}>
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
                          Order {item.orderId.replace('gid://shopify/Order/', '')}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <time dateTime={item.orderCreatedAt}>{recordDate(item.orderCreatedAt)}</time>
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
        </s-section>
      )}
      {purchaseId && !purchase && busy && (
        <s-section>
          <AdminSkeleton label="Loading order and artwork" rows={4} />
        </s-section>
      )}
      {purchase && (
        <>
          <s-section heading="Order summary">
            <s-heading>Order {purchase.orderId.replace('gid://shopify/Order/', '')}</s-heading>
            <p>
              Order created: <time dateTime={purchase.orderCreatedAt}>{recordDate(purchase.orderCreatedAt)}</time>
            </p>
            <p>
              {purchase.isTest === true
                ? 'Test order.'
                : purchase.isTest === null
                  ? 'Test status unavailable.'
                  : 'Non-test order.'}
            </p>
            <p>{exactPurchaseMoney(purchase.originalTotalMinor, purchase.exponent, purchase.currency)}</p>
            <p>
              Shopify payment status: {purchase.financialStatus}. First fully paid:{' '}
              {purchase.firstPaidAt ? (
                <time dateTime={purchase.firstPaidAt}>{recordDate(purchase.firstPaidAt)}</time>
              ) : (
                'Not recorded'
              )}
              .
            </p>
            {purchase.cancelledAt && (
              <p>
                Shopify cancellation: <time dateTime={purchase.cancelledAt}>{recordDate(purchase.cancelledAt)}</time>
              </p>
            )}
            <p>Shopify owns payment, fulfillment, refunds, returns and restock.</p>
            {purchase.exceptions.map((exception, index) => (
              <p role="alert" key={index}>
                Reconciliation exception: {exception}
              </p>
            ))}
            <s-button type="button" disabled={busy} onClick={() => void command('reconcile')}>
              Check order updates in Shopify
            </s-button>
          </s-section>
          <s-section heading="Purchased variants">
            {purchase.lines.map((line) => (
              <p key={line.orderLineId}>
                {line.productId} / {line.variantId}: {line.quantity} ×{' '}
                {exactPurchaseMoney(line.unitPriceMinor, purchase.exponent, purchase.currency)}
              </p>
            ))}
          </s-section>
          <s-section heading="Artwork and customization">
            {purchase.lines.length > 0 && <p>Artwork status: {artworkLabel(purchase.artworkState)}</p>}
            {purchase.lines.length === 0 ? (
              <p>
                Order customization needs verification. Do not begin production until its details have been checked.
              </p>
            ) : purchase.artworkState === 'ERASED' &&
              !purchase.groups.some((group) => Date.parse(group.payloadExpiresAt) > Date.now()) ? (
              <p>Production detail erased. Historical economics remain.</p>
            ) : (
              <>
                {purchase.artworkState === 'ERASED' && purchase.groups.length > 0 && (
                  <p>
                    {purchase.artworkEvents.some((event) => event.kind === 'LOCK')
                      ? 'Selected artwork unavailable. Artwork lock remains in force.'
                      : 'Selected artwork unavailable; explicitly replace within remaining detail retention.'}
                  </p>
                )}
                {purchase.groups.map((group) => (
                  <section key={group.index} class="purchase-customization">
                    <h3>Customization {group.index + 1}</h3>
                    <details>
                      <summary>Saved production reference</summary>
                      <p>Historical revision: {group.configRevisionId}</p>
                    </details>
                    <p>
                      Design retention deadline:{' '}
                      <time dateTime={group.payloadExpiresAt}>{recordDate(group.payloadExpiresAt)}</time>
                    </p>
                    <PurchaseHistoricalPreview purchaseId={purchase.purchaseId} group={group} deny={deny} />
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
          </s-section>
          <s-section heading="Attachment history">
            {purchase.artworkEvents.map((event) => (
              <p key={event.eventId}>
                Version {event.version}: {event.kind}{' '}
                {event.erasedAt ? '— artwork detail erased' : (event.assetId ?? '')}
                {event.expiresAt && (
                  <>
                    {' '}
                    · original deadline <time dateTime={event.expiresAt}>{recordDate(event.expiresAt)}</time>
                  </>
                )}
                {event.kind === 'ATTACH' &&
                  event.assetId &&
                  !event.erasedAt &&
                  event.expiresAt &&
                  Date.parse(event.expiresAt) > Date.now() && (
                    <HistoricalOriginal purchaseId={purchase.purchaseId} assetId={event.assetId} deny={deny} />
                  )}
              </p>
            ))}
            {purchase.artworkEvents.length === 0 && <p>No artwork replacements or locks recorded.</p>}
          </s-section>
          <s-section heading="Shopify refund records">
            <p>Refund records do not prove that money has settled. Shopify remains the payment authority.</p>
            {purchase.refunds.length === 0 && <p>No refunds recorded.</p>}
            {purchase.refunds.map((refund) => (
              <p key={refund.refundId}>
                {refund.refundId}: {exactPurchaseMoney(refund.amountMinor, purchase.exponent, refund.currency)} ·{' '}
                <time dateTime={refund.occurredAt}>{recordDate(refund.occurredAt)}</time>
                {refund.lines.map((line) => (
                  <span key={line.lineId}>
                    {' '}
                    · {line.lineId}: {line.quantity} recorded for refund,{' '}
                    {exactPurchaseMoney(line.amountMinor, purchase.exponent, refund.currency)}
                  </span>
                ))}
              </p>
            ))}
          </s-section>
        </>
      )}
    </s-page>
  );
}
