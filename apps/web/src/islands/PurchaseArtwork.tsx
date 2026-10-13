import {
  type PurchaseGroup,
  PurchaseListViewSchema,
  PurchasePrivateUrlSchema,
  type PurchaseView,
  PurchaseViewSchema,
} from '@insignia/contracts';
import { type GeometryV1, projectScene, validateGeometry } from '@insignia/visualizer/geometry';
import { useEffect, useRef, useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request';
import { exactPurchaseMoney } from '../shared/purchase-view';
import ArtworkUpload from './ArtworkUpload';

const endpoint = (id: string) => `/api/purchases/v1/${encodeURIComponent(id)}`;
function HistoricalPreview({ group }: { group: PurchaseGroup }) {
  const element = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Historical preview unavailable.');
  useEffect(() => {
    let ended = false;
    let renderer: import('@insignia/visualizer').Visualizer | undefined;
    try {
      if (!group.geometry || !element.current) return;
      const geometry = group.geometry as GeometryV1;
      validateGeometry(geometry);
      const first = geometry.views[0];
      if (!first?.image || !group.imageUrls[first.image.revisionId]) return;
      void import('@insignia/visualizer')
        .then(async ({ createVisualizer }) => {
          if (ended || !element.current) return;
          renderer = await createVisualizer({
            element: element.current,
            onCommand: () => {},
            onStatus: (status) => {
              if (!ended)
                setMessage(status === 'ready' ? 'Historical geometry preview.' : 'Historical preview unavailable.');
            },
          });
          if (ended) {
            renderer.destroy();
            return;
          }
          renderer.setMode('preview');
          renderer.update(
            projectScene(
              {
                version: 0,
                geometry,
                viewId: first.id,
                variantId: group.variants[0]?.variantId,
                artwork: { kind: 'none' },
              },
              { width: 560, height: 320, pixelRatio: 1 },
              group.imageUrls,
            ),
          );
        })
        .catch(() => {
          if (!ended) setMessage('Historical preview unavailable.');
        });
    } catch {}
    return () => {
      ended = true;
      renderer?.destroy();
    };
  }, [group]);
  return (
    <>
      <div
        ref={element}
        style={{
          width: '100%',
          maxWidth: '560px',
          height: message === 'Historical preview unavailable.' ? '0' : '320px',
        }}
      />
      <p>{message}</p>
    </>
  );
}
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
      <button type="button" disabled={busy} onClick={() => void download()}>
        Prepare historical original
      </button>
      {link && (
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
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; expiresAt: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setSelected(null);
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
    const current = generation.current;
    setBusy(true);
    try {
      const result = PurchasePrivateUrlSchema.parse(
        await authenticatedJson(
          `${endpoint(purchase.purchaseId)}/artwork/${encodeURIComponent(placement.currentAssetId!)}/${kind}`,
        ),
      );
      if (current !== generation.current) return;
      if (Date.parse(result.expiresAt) <= Date.now()) throw new Error('Artwork link expired');
      if (kind === 'download') setLink(result);
      else setPreview(result);
    } catch (e) {
      if (current === generation.current) {
        setMessage(e instanceof Error ? e.message : 'Artwork unavailable');
        deny(e);
      }
    } finally {
      if (current === generation.current) setBusy(false);
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
      <h4>
        {label} · {group.presentation?.labels.methods?.[placement.methodId] ?? placement.methodId} ·{' '}
        {group.presentation?.labels.steps?.[placement.stepId] ?? placement.stepId}
      </h4>
      <p>
        Purchased artwork:{' '}
        {placement.originalArtwork.kind === 'deferred' ? 'Logo later' : placement.originalArtwork.revisionId}
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
          Original collection deadline: {placement.currentExpiresAt}.{' '}
          {retentionExpired
            ? 'Artwork expired.'
            : Date.parse(placement.currentExpiresAt) - Date.now() <= 30 * 86400000
              ? Date.parse(placement.currentExpiresAt) - Date.now() <= 7 * 86400000
                ? 'Deletion within 7 days. Download before deletion.'
                : 'Retention expiry within 30 days. Download before deletion.'
              : ''}
        </p>
      )}
      {placement.currentAssetId && !retentionExpired && (
        <>
          <button type="button" disabled={busy || disabled} onClick={() => void access('preview')}>
            View safe preview
          </button>
          <button type="button" disabled={busy || disabled} onClick={() => void access('download')}>
            Prepare original download
          </button>
        </>
      )}
      {preview && <img src={preview.url} alt={`Verified PNG ${label}`} style={{ maxWidth: '200px' }} />}
      {link && (
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
            <button type="button" disabled={!selected || disabled || busy} onClick={() => void attach()}>
              {placement.currentAssetId || purchase.artworkState === 'ERASED' ? 'Replace artwork' : 'Attach artwork'}
            </button>
          </>
        )}
      <p role="status">{message}</p>
    </section>
  );
}
export default function PurchaseArtwork({ purchaseId }: { purchaseId?: string }) {
  const [items, setItems] = useState<PurchaseView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseView | null>(null);
  const [message, setMessage] = useState('Loading orders…');
  const [busy, setBusy] = useState(false);
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
        setMessage(kind === 'lock' ? 'Artwork locked.' : 'Shopify facts reconciled.');
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
      <nav>
        <a href="/admin/products">Products</a> · <a href="/admin/orders">Orders and artwork</a>
      </nav>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!denied && (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {purchaseId ? 'Refresh purchase' : 'Refresh orders'}
        </button>
      )}
      {!purchaseId && !denied && (
        <section>
          <h2>Customized orders</h2>
          {items.length === 0 && !busy && <p>No customized orders recorded.</p>}
          {nextCursor && (
            <button type="button" disabled={busy} onClick={() => void load(nextCursor)}>
              Load older orders
            </button>
          )}
          {items.map((item) => (
            <p key={item.purchaseId}>
              <a href={`/admin/orders/${item.purchaseId}`}>{item.orderId}</a> ·{' '}
              {item.lines.length ? item.artworkState : 'Binding requires reconciliation'} ·{' '}
              {exactPurchaseMoney(item.originalTotalMinor, item.exponent, item.currency)}
            </p>
          ))}
        </section>
      )}
      {purchase && (
        <>
          <h2>{purchase.orderId}</h2>
          <p>Order created: {purchase.orderCreatedAt}</p>
          <p>{exactPurchaseMoney(purchase.originalTotalMinor, purchase.exponent, purchase.currency)}</p>
          <p>
            Shopify payment status: {purchase.financialStatus}. First fully paid:{' '}
            {purchase.firstPaidAt ?? 'Not recorded'}.
          </p>
          {purchase.cancelledAt && <p>Shopify cancellation: {purchase.cancelledAt}</p>}
          <p>Shopify owns payment, fulfillment, refunds, returns and restock.</p>
          {purchase.exceptions.map((exception, index) => (
            <p role="alert" key={index}>
              Reconciliation exception: {exception}
            </p>
          ))}
          <button type="button" disabled={busy} onClick={() => void command('reconcile')}>
            Reconcile Shopify facts
          </button>
          <h3>Purchased variants</h3>
          {purchase.lines.map((line) => (
            <p key={line.orderLineId}>
              {line.productId} / {line.variantId}: {line.quantity} ×{' '}
              {exactPurchaseMoney(line.unitPriceMinor, purchase.exponent, purchase.currency)}
            </p>
          ))}
          {purchase.lines.length > 0 && <p>Artwork state: {purchase.artworkState}</p>}
          {purchase.lines.length === 0 ? (
            <p>Customization binding requires reconciliation. No production authorization is established.</p>
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
                <section key={group.index}>
                  <h3>
                    Customization {group.index + 1} · historical revision {group.configRevisionId}
                  </h3>
                  <p>Design retention deadline: {group.payloadExpiresAt}</p>
                  <HistoricalPreview group={group} />
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
              <button
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
              </button>
            </>
          )}
          <h3>Attachment history</h3>
          {purchase.artworkEvents.map((event) => (
            <p key={event.eventId}>
              Version {event.version}: {event.kind} {event.erasedAt ? '— artwork detail erased' : (event.assetId ?? '')}
              {event.expiresAt ? ` · original deadline ${event.expiresAt}` : ''}
              {event.kind === 'ATTACH' &&
                event.assetId &&
                !event.erasedAt &&
                event.expiresAt &&
                Date.parse(event.expiresAt) > Date.now() && (
                  <HistoricalOriginal purchaseId={purchase.purchaseId} assetId={event.assetId} deny={deny} />
                )}
            </p>
          ))}
          <h3>Shopify refunds</h3>
          {purchase.refunds.length === 0 && <p>No refunds recorded.</p>}
          {purchase.refunds.map((refund) => (
            <p key={refund.refundId}>
              {refund.refundId}: {exactPurchaseMoney(refund.amountMinor, purchase.exponent, refund.currency)} ·{' '}
              {refund.occurredAt}
              {refund.lines.map((line) => (
                <span key={line.lineId}>
                  {' '}
                  · {line.lineId}: {line.quantity} refunded,{' '}
                  {exactPurchaseMoney(line.amountMinor, purchase.exponent, refund.currency)}
                </span>
              ))}
            </p>
          ))}
        </>
      )}
    </s-page>
  );
}
