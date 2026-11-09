const messages = {
  READY: 'Ready for signing setup.',
  WAITING_FOR_VERIFICATION: 'Waiting for verification. Refresh status to check again.',
  PENDING: 'Signing setup is pending. Refresh status to check progress.',
  PROVISIONED: 'Signing configuration provisioned. This does not establish quote or purchase readiness.',
  STOPPED: 'Signing setup stopped. Operator review is required.',
  UNCERTAIN: 'Signing status is uncertain. Use status refresh only; operator review is required.',
} as const;
type State = keyof typeof messages;
const custodyKey = 'insignia:signing-operator:read-only:v1';
/** Nonsecret browser custody is conservative UI protection; the server reservation owns exclusivity. */
export function createSigningOperator(
  request: (path: string, init?: RequestInit) => Promise<unknown>,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  changed: () => void = () => {},
) {
  let locked = false;
  try {
    locked = storage.getItem(custodyKey) !== null;
  } catch {
    locked = true;
  }
  let state: State | null = null;
  let busy = false;
  function lock() {
    locked = true;
    try {
      storage.setItem(custodyKey, 'read-only');
      return true;
    } catch {
      return false;
    }
  }
  function accept(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid status');
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).sort().join(',') !== 'actionAvailable,quoteIssuanceAuthorized,retryAuthorized,state,version' ||
      v.version !== 'm5-signing-owner-action-v1' ||
      typeof v.state !== 'string' ||
      !Object.hasOwn(messages, v.state) ||
      v.actionAvailable !== (v.state === 'READY') ||
      v.retryAuthorized !== false ||
      v.quoteIssuanceAuthorized !== false
    )
      throw new Error('Invalid status');
    state = v.state as State;
    if (state !== 'READY' && state !== 'WAITING_FOR_VERIFICATION') lock();
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    changed();
    try {
      accept(await request('/api/admin/signing', { method: 'GET' }));
    } catch {
      lock();
      state = 'UNCERTAIN';
    } finally {
      busy = false;
      changed();
    }
  }
  async function setup() {
    if (locked || busy || state !== 'READY') return;
    // Persist before dispatch. Storage failure must never permit a write without custody.
    const durable = lock();
    busy = true;
    changed();
    try {
      if (!durable) throw new Error('Custody unavailable');
      accept(
        await request('/api/admin/signing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"action":"setup"}',
        }),
      );
    } catch {
      state = 'UNCERTAIN';
    } finally {
      busy = false;
      changed();
    }
  }
  return {
    refresh,
    setup,
    view: () => ({
      busy,
      canSetup: !locked && !busy && state === 'READY',
      message: state ? messages[state] : 'Loading signing status.',
      readOnly: locked,
    }),
  };
}
