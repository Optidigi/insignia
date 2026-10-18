import { useRef, useState } from 'preact/hooks';

const readinessScopes = ['read_cart_transforms', 'read_validations'];
type ScopeDetail = { granted: string[]; optional: string[]; required: string[] };
type ScopesApi = {
  query(): Promise<ScopeDetail>;
  request(scopes: string[]): Promise<{ result: 'granted-all' | 'declined-all'; detail: ScopeDetail }>;
};
function api(): ScopesApi {
  const scopes = (window as unknown as { shopify?: { scopes?: ScopesApi } }).shopify?.scopes;
  if (!scopes?.query || !scopes.request) throw new Error('Scope API unavailable');
  return scopes;
}
async function bounded<T>(task: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Permission check timed out')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Browser scopes only guide consent. Current server authentication remains authority. */
export default function ReadinessPermissions({ inspect }: { inspect: () => Promise<unknown> }) {
  const [missing, setMissing] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const requested = useRef(false);
  async function inspectCurrent() {
    await inspect();
    setStatus('Readiness checked. Publication still requires current eligibility.');
  }
  async function check() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMissing([]);
    try {
      const detail = await bounded(() => api().query(), 10_000);
      if (!Array.isArray(detail.granted) || !Array.isArray(detail.optional)) throw new Error('Invalid scope response');
      const needed = readinessScopes.filter((scope) => !detail.granted.includes(scope));
      if (needed.some((scope) => !detail.optional.includes(scope)))
        throw new Error('Readiness permissions unavailable');
      if (needed.length) {
        if (requested.current) {
          setStatus('Permissions are still missing. Reload before another permission request.');
        } else {
          setMissing(needed);
          setStatus('Allow Insignia to check publication readiness.');
        }
      } else {
        await inspectCurrent();
      }
    } catch {
      setStatus('Readiness could not be checked. Try checking again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function allow() {
    if (inFlight.current || requested.current || !missing.length) return;
    inFlight.current = true;
    requested.current = true;
    setBusy(true);
    const scopes = [...missing];
    setMissing([]);
    try {
      const response = await bounded(() => api().request(scopes), 120_000);
      if (response.result === 'declined-all') {
        setStatus('Permissions were declined. Readiness remains unverified.');
      } else if (response.result === 'granted-all') {
        await inspectCurrent();
      } else {
        throw new Error('Invalid permission response');
      }
    } catch {
      setStatus('Permission or readiness check did not complete. Check readiness again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <s-section heading="Publication readiness">
      <div class="admin-description">
        <s-paragraph>Check the permissions and current setup needed for publication.</s-paragraph>
      </div>
      <s-button disabled={busy} onClick={() => void check()}>
        Check readiness
      </s-button>
      {missing.length > 0 && (
        <s-button disabled={busy} onClick={() => void allow()}>
          Allow readiness checks
        </s-button>
      )}
      {status && (
        <div role="status">
          <s-paragraph>{status}</s-paragraph>
        </div>
      )}
    </s-section>
  );
}
