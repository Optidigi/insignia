import { useEffect, useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import AdminSkeleton from '../components/AdminSkeleton';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request.js';

type RequestView = {
  inboxId: string;
  requestId: string;
  receivedAt: string;
  fulfillBy: string;
  requestedOrderCount: number;
};
type Manifest = RequestView & { orders: { orderId: string; purchaseId: string | null }[] };
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function MerchantPrivacy() {
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [designExports, setDesignExports] = useState<{ purchaseId: string; setId: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useAdminPageReady(loaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await operation();
      setDenied(false);
    } catch (error) {
      if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
        setRequests([]);
        setManifest(null);
        setDesignExports([]);
        setDenied(true);
      }
      setError(true);
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () =>
      setRequests((await authenticatedJson<{ items: RequestView[] }>('/api/purchases/v1/privacy')).items),
    );
  }, []);
  return (
    <s-page inlineSize="base" heading="Customer privacy requests">
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        Settings
      </s-link>
      <s-button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setManifest(null);
            setDesignExports([]);
            setRequests((await authenticatedJson<{ items: RequestView[] }>('/api/purchases/v1/privacy')).items);
          })
        }
      >
        Refresh requests
      </s-button>
      <s-section heading="Data requests">
        <s-stack gap="base">
          <s-paragraph>
            Download each available order record and its original artwork, then provide them to the requesting customer
            through your store’s privacy process. Downloading here does not confirm delivery to the customer.
          </s-paragraph>
          <s-paragraph>
            Exports use currently retained records. Erased or expired artwork stays unavailable.
          </s-paragraph>
          {(!loaded || (busy && !requests.length)) && <AdminSkeleton label="Loading privacy requests" />}
          {error && (
            <s-banner tone="critical" heading="Privacy requests unavailable">
              {denied
                ? 'Reopen Insignia from Shopify Admin to verify your access.'
                : 'Privacy records could not be loaded. Try again.'}
            </s-banner>
          )}
          {loaded && !busy && !error && !requests.length && (
            <s-empty-state heading="No open data requests">
              <s-paragraph slot="subheading">No data requests are currently available.</s-paragraph>
            </s-empty-state>
          )}
          {requests.length > 0 && (
            <s-table loading={busy}>
              <s-table-header-row>
                <s-table-header listSlot="primary">Request</s-table-header>
                <s-table-header listSlot="labeled">Due</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">
                  Requested orders
                </s-table-header>
                <s-table-header listSlot="inline">Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {requests.map((request) => (
                  <s-table-row key={request.inboxId}>
                    <s-table-cell>
                      <s-text>Request {request.requestId}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text data-date-time={request.fulfillBy}>
                        {new Intl.DateTimeFormat('en', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'UTC',
                        }).format(new Date(request.fulfillBy))}{' '}
                        UTC
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>{request.requestedOrderCount}</s-table-cell>
                    <s-table-cell>
                      <s-button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setDesignExports([]);
                            setManifest(await authenticatedJson(`/api/purchases/v1/privacy/${request.inboxId}`));
                          })
                        }
                      >
                        Open request
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {requests.length === 100 && (
            <s-button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setManifest(null);
                  setDesignExports([]);
                  setRequests(
                    (
                      await authenticatedJson<{ items: RequestView[] }>(
                        `/api/purchases/v1/privacy?after=${requests[requests.length - 1]?.inboxId}`,
                      )
                    ).items,
                  );
                })
              }
            >
              Next requests
            </s-button>
          )}
        </s-stack>
      </s-section>
      {manifest && (
        <s-section heading={`Request ${manifest.requestId}`}>
          <s-stack gap="base">
            <s-button disabled={busy} onClick={() => download(manifest, `insignia-request-${manifest.requestId}.json`)}>
              Download request summary (JSON)
            </s-button>
            {!manifest.orders.length && (
              <s-paragraph>
                No orders were requested. Insignia does not hold a separate customer contact profile.
              </s-paragraph>
            )}
            {manifest.orders.map((order, index) => (
              <s-stack key={order.orderId} gap="base">
                <s-divider />
                <s-heading>Requested order {index + 1}</s-heading>
                {order.purchaseId ? (
                  <>
                    <s-button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const value = await authenticatedJson<{
                            designs: { setId: string; hasRetainedPayload: boolean }[];
                          }>(`/api/purchases/v1/privacy/${manifest.inboxId}/orders/${order.purchaseId}`);
                          download(value, `insignia-order-${order.purchaseId}.json`);
                          setDesignExports(
                            value.designs
                              .filter((d) => d.hasRetainedPayload)
                              .map((d) => ({ purchaseId: order.purchaseId as string, setId: d.setId })),
                          );
                        })
                      }
                    >
                      Download order data
                    </s-button>
                    <s-link href={`/admin/orders/${order.purchaseId}`}>Original artwork and retained preview</s-link>
                  </>
                ) : (
                  <s-paragraph>No matching Insignia purchase is held.</s-paragraph>
                )}
                <AdminDisclosure label="Shopify order reference">
                  <s-paragraph>{order.orderId}</s-paragraph>
                </AdminDisclosure>
              </s-stack>
            ))}
            {designExports.map((design, index) => (
              <s-paragraph key={design.setId}>
                <s-button
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      download(
                        await authenticatedJson(
                          `/api/purchases/v1/privacy/${manifest.inboxId}/orders/${design.purchaseId}/sets/${design.setId}`,
                        ),
                        `insignia-design-${design.setId}.json`,
                      ),
                    )
                  }
                >
                  Download retained design {index + 1}
                </s-button>
              </s-paragraph>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
