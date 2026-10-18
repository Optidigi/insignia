import { useEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
import SettingsNavigation from '../components/SettingsNavigation';
import { authenticatedJson } from '../shared/admin-request';

type Method = { id: string; name: string; version: string };
export default function MethodLibrary() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Retain each command key through an uncertain response. Explicit refresh reconciles state.
  const pending = useRef<{
    signature: string;
    key: string;
    method: 'POST' | 'PUT' | 'DELETE';
    id: string | null;
    body: object;
  } | null>(null);
  function clearDenied(error: unknown) {
    if (![401, 403].includes((error as { status?: number }).status ?? 0)) return false;
    setMethods([]);
    setNames({});
    setName('');
    setNotice('');
    setDeleting(null);
    pending.current = null;
    setUncertain(false);
    setDenied(true);
    return true;
  }
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await authenticatedJson<{ methods: Method[] }>('/api/admin/methods');
      setDenied(false);
      setMethods(result.methods);
      setNames(Object.fromEntries(result.methods.map((m) => [m.id, m.name])));
      setDeleting(null);
    } catch (e) {
      clearDenied(e);
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function write(method: 'POST' | 'PUT' | 'DELETE', id: string | null, body: object) {
    if (inFlight.current) return;
    const signature = JSON.stringify([method, id, body]);
    if (pending.current && pending.current.signature !== signature) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    if (!pending.current) pending.current = { signature, key: crypto.randomUUID(), method, id, body };
    try {
      const result = await authenticatedJson<{ method?: Method }>(
        `/api/admin/methods${id ? '/' + encodeURIComponent(id) : ''}`,
        {
          method,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
          body: JSON.stringify(body),
        },
      );
      if (method === 'DELETE') setMethods((items) => items.filter((m) => m.id !== id));
      else if (result.method) {
        const saved = result.method;
        setMethods((items) =>
          method === 'POST'
            ? [...items.filter((item) => item.id !== saved.id), saved]
            : items.map((m) => (m.id === saved.id ? saved : m)),
        );
        setNames((values) => ({ ...values, [saved.id]: saved.name }));
      }
      pending.current = null;
      setUncertain(false);
      setDeleting(null);
      if (method === 'POST') setName('');
      setNotice(
        method === 'DELETE'
          ? 'Removed from library. Existing products are unchanged.'
          : 'Library saved. Existing products are unchanged.',
      );
    } catch (e) {
      if (clearDenied(e)) setError((e as Error).message);
      else {
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          pending.current = null;
          setUncertain(false);
        } else setUncertain(true);
        setError((e as Error).message + ' Refresh to check the library before continuing.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <s-page heading="Decoration method library">
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        Settings
      </s-link>
      <SettingsNavigation current="methods" />
      <s-section heading="Reusable methods for your store">
        <s-paragraph>
          Add methods such as embroidery or screen printing once, then choose them when configuring a product. Each
          product gets its own copy; renaming or removing a library entry never changes an existing draft, published
          product or order.
        </s-paragraph>
        <s-paragraph>Prices, print areas and available sizes are configured separately for each product.</s-paragraph>
        {error && (
          <s-banner tone="critical" heading="Library could not be updated">
            {error}
          </s-banner>
        )}
        {uncertain && (
          <s-button
            disabled={busy || loading}
            onClick={() => {
              const command = pending.current;
              if (command) void write(command.method, command.id, command.body);
            }}
          >
            Retry last change
          </s-button>
        )}
        {notice && <s-banner tone="success">{notice}</s-banner>}
        <s-button onClick={() => void load()} disabled={busy || loading}>
          Refresh library
        </s-button>
        {loading ? (
          <AdminSkeleton label="Loading decoration methods" />
        ) : (
          !denied && (
            <>
              <s-text-field
                label="New method name"
                value={name}
                maxLength={80}
                disabled={busy || uncertain}
                onInput={(e) => setName(e.currentTarget.value)}
              />
              <s-button
                variant="primary"
                disabled={busy || uncertain || !name.trim()}
                onClick={() => void write('POST', null, { name: name.trim() })}
              >
                Add to library
              </s-button>
              {!methods.length && !error && (
                <s-paragraph>No methods yet. Add the decoration services your store offers.</s-paragraph>
              )}
              {methods.length > 0 && (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Name</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {methods.map((m) => (
                      <s-table-row key={m.id}>
                        <s-table-cell>
                          <s-text-field
                            label="Library method name"
                            value={names[m.id] ?? m.name}
                            maxLength={80}
                            disabled={busy || uncertain}
                            onInput={(e) => setNames({ ...names, [m.id]: e.currentTarget.value })}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="base">
                            <s-button
                              disabled={busy || uncertain || !names[m.id]?.trim() || names[m.id]?.trim() === m.name}
                              onClick={() => void write('PUT', m.id, { name: names[m.id]?.trim(), version: m.version })}
                            >
                              Save name
                            </s-button>
                            <s-button tone="critical" disabled={busy || uncertain} onClick={() => setDeleting(m.id)}>
                              Remove
                            </s-button>
                            {deleting === m.id && (
                              <>
                                <s-text>Remove “{m.name}” from the library?</s-text>
                                <s-button
                                  tone="critical"
                                  disabled={busy || uncertain}
                                  onClick={() => void write('DELETE', m.id, { version: m.version })}
                                >
                                  Confirm removal
                                </s-button>
                                <s-button disabled={busy || uncertain} onClick={() => setDeleting(null)}>
                                  Cancel
                                </s-button>
                              </>
                            )}
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </>
          )
        )}
      </s-section>
    </s-page>
  );
}
