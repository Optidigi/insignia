import { useEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';

type Method = { id: string; name: string; version: string };
export default function MethodLibrary() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ method: Method | null } | null>(null);
  const editor = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    let active = true;
    void customElements.whenDefined('s-modal').then(() => {
      if (!active) return;
      if (editing) editor.current?.showOverlay();
      else editor.current?.hideOverlay();
    });
    return () => {
      active = false;
    };
  }, [editing]);
  const [loading, setLoading] = useState(true);
  useAdminPageReady(!loading);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  // Each opening has its own identity, including a same-method reopen batched with hide.
  const [deleting, setDeleting] = useState<{ methodId: string } | null>(null);
  const removal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    let active = true;
    void customElements.whenDefined('s-modal').then(() => {
      if (!active) return;
      if (deleting) removal.current?.showOverlay();
      else removal.current?.hideOverlay();
    });
    return () => {
      active = false;
    };
  }, [deleting]);
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
    setEditing(null);
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
      setEditing(null);
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
      }
      pending.current = null;
      setUncertain(false);
      setDeleting(null);
      setEditing(null);
      setName('');
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
      <s-modal ref={removal} id="remove-method" heading="Remove decoration method?" onHide={() => setDeleting(null)}>
        <s-stack gap="base">
          <s-paragraph>Remove this method from your reusable library?</s-paragraph>
          <s-text type="strong">{methods.find((m) => m.id === deleting?.methodId)?.name}</s-text>
          <s-paragraph>Existing product configurations and orders will stay unchanged.</s-paragraph>
          {error && deleting && (
            <s-banner tone="critical" heading="Method could not be removed">
              {error}
            </s-banner>
          )}
          {uncertain && deleting && (
            <s-banner tone="warning">
              Removal could not be confirmed. Close this dialog and refresh the library before continuing.
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          disabled={busy || uncertain || !deleting}
          onClick={() => {
            const method = methods.find((m) => m.id === deleting?.methodId);
            if (method) void write('DELETE', method.id, { version: method.version });
          }}
        >
          Confirm removal
        </s-button>
        <s-button slot="secondary-actions" commandFor="remove-method" command="--hide" disabled={busy}>
          Cancel
        </s-button>
      </s-modal>
      <s-stack direction="inline" gap="base">
        <s-button
          variant="primary"
          disabled={busy || loading || denied || uncertain}
          onClick={() => {
            setName('');
            setEditing({ method: null });
          }}
        >
          Add method
        </s-button>
        <s-button onClick={() => void load()} disabled={busy || loading}>
          Refresh library
        </s-button>
      </s-stack>
      <s-modal
        ref={editor}
        id="edit-method"
        heading={editing?.method ? 'Edit decoration method' : 'Add decoration method'}
        onHide={() => setEditing(null)}
      >
        <s-stack gap="base">
          {editing && !denied && (
            <s-text-field
              label={editing?.method ? 'Library method name' : 'New method name'}
              value={name}
              maxLength={80}
              disabled={busy || uncertain}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          )}
          <s-paragraph>Use a name your team recognizes, such as embroidery or screen printing.</s-paragraph>
          {error && editing && (
            <s-banner tone="critical" heading="Method could not be saved">
              {error}
            </s-banner>
          )}
          {uncertain && editing && (
            <s-banner tone="warning">
              The result is not confirmed. Cancel to return to the library, then refresh before retrying the same
              change.
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={busy || uncertain || !name.trim() || name.trim() === editing?.method?.name}
          onClick={() => {
            if (editing)
              void write(
                editing.method ? 'PUT' : 'POST',
                editing.method?.id ?? null,
                editing.method ? { name: name.trim(), version: editing.method.version } : { name: name.trim() },
              );
          }}
        >
          {editing?.method ? 'Save name' : 'Add to library'}
        </s-button>
        <s-button slot="secondary-actions" commandFor="edit-method" command="--hide" disabled={busy}>
          Cancel
        </s-button>
      </s-modal>
      {error && (
        <s-banner tone="critical" heading="Library could not be updated">
          {error}
        </s-banner>
      )}
      {uncertain && (
        <s-banner tone="warning" heading="Check the last change">
          <s-stack gap="base">
            <s-paragraph>
              Refresh the library to check its current state. Retrying uses the same command and cannot create a second
              copy.
            </s-paragraph>
            <s-button
              disabled={busy || loading}
              onClick={() => {
                const command = pending.current;
                if (command) void write(command.method, command.id, command.body);
              }}
            >
              Retry last change
            </s-button>
          </s-stack>
        </s-banner>
      )}
      {notice && <s-banner tone="success">{notice}</s-banner>}
      <s-section padding="none" accessibilityLabel="Decoration methods">
        {loading ? (
          <s-box padding="base">
            <AdminSkeleton variant="table" label="Loading decoration methods" />
          </s-box>
        ) : (
          !denied &&
          (methods.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Method</s-table-header>
                <s-table-header listSlot="inline">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {methods.map((method) => (
                  <s-table-row key={method.id}>
                    <s-table-cell>{method.name}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        <s-button
                          disabled={busy || uncertain}
                          onClick={() => {
                            setName(method.name);
                            setEditing({ method });
                          }}
                        >
                          Edit
                        </s-button>
                        <s-button
                          tone="critical"
                          disabled={busy || uncertain}
                          onClick={() => setDeleting({ methodId: method.id })}
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            !error && (
              <s-empty-state heading="Build your decoration library">
                <s-paragraph slot="subheading">
                  Add the decoration services your store offers, then reuse them when configuring a product.
                </s-paragraph>
              </s-empty-state>
            )
          ))
        )}
      </s-section>
      <s-section slot="aside" heading="About your library">
        <s-stack gap="base">
          <s-paragraph>
            Each product gets its own copy of a method. Library changes never update existing drafts, published
            configurations or orders.
          </s-paragraph>
          <s-paragraph>Set prices, print areas and sizes in the product configuration.</s-paragraph>
          <s-link href="/admin/products">Configure a product</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
