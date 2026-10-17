import { useEffect, useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request.js';
import AdminNavigation from './AdminNavigation';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await operation();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () =>
      setRequests((await authenticatedJson<{ items: RequestView[] }>('/api/purchases/v1/privacy')).items),
    );
  }, []);
  return (
    <s-page heading="Customer privacy requests">
      <AdminNavigation current="privacy" />
      <s-section heading="Provide requested customer data">
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
        <p>
          Download each available order record and its original artwork, then provide them to the requesting customer
          through your store’s privacy process. Downloading here does not confirm delivery to the customer.
        </p>
        <p>Exports use currently retained records. Erased or expired artwork stays unavailable.</p>
        {busy && <p role="status">Loading privacy records…</p>}
        {error && <p role="alert">Privacy records could not be loaded. Try again.</p>}
        {!busy && !requests.length && <p>No data requests are currently available.</p>}
        {requests.map((request) => (
          <p key={request.inboxId}>
            Request {request.requestId} · {request.requestedOrderCount} requested orders · Due{' '}
            {new Date(request.fulfillBy).toUTCString()}{' '}
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
          </p>
        ))}
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
      </s-section>
      {manifest && (
        <s-section heading={`Request ${manifest.requestId}`}>
          <s-button disabled={busy} onClick={() => download(manifest, `insignia-request-${manifest.requestId}.json`)}>
            Download request manifest
          </s-button>
          {!manifest.orders.length && (
            <p>No orders were requested. Insignia does not hold a separate customer contact profile.</p>
          )}
          {manifest.orders.map((order) => (
            <p key={order.orderId}>
              {order.orderId}{' '}
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
                  </s-button>{' '}
                  <s-link href={`/admin/orders/${order.purchaseId}`}>Original artwork and retained preview</s-link>
                </>
              ) : (
                'No matching Insignia purchase is held.'
              )}
            </p>
          ))}
          {designExports.map((design, index) => (
            <p key={design.setId}>
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
            </p>
          ))}
        </s-section>
      )}
    </s-page>
  );
}
