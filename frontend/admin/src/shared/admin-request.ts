import { adminRequestPolicy } from './admin-request-policy.ts';
import { readFreshBridgeToken } from './bridge-token.ts';

// Shared per scheduling policy: a publication never shares an ordinary request's token promise.
const tokenRequests = new Map<string, Promise<string>>();
async function browserDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal | null,
  timeoutMs = 10000,
): Promise<T> {
  const controller = new AbortController();
  caller?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortCaller: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abortCaller = () => {
      controller.abort(caller?.reason);
      reject(caller?.reason ?? new DOMException('Request cancelled', 'AbortError'));
    };
    caller?.addEventListener('abort', abortCaller, { once: true });
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Admin request timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortCaller) caller?.removeEventListener('abort', abortCaller);
  }
}
function sessionToken(forceFresh = false, policy = adminRequestPolicy('')): Promise<string> {
  const bridge = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  const tokenGetter = bridge?.idToken?.bind(bridge);
  if (!tokenGetter) return Promise.reject(new Error('Open this page from Shopify Admin to verify your session.'));
  const acquire = () =>
    browserDeadline(
      (signal) => readFreshBridgeToken(tokenGetter, signal, policy.minimumValidityMs),
      undefined,
      policy.timeoutMs,
    );
  if (forceFresh) return acquire();
  const key = `${policy.timeoutMs}:${policy.minimumValidityMs}`;
  let pending = tokenRequests.get(key);
  if (!pending) {
    pending = acquire().finally(() => tokenRequests.delete(key));
    tokenRequests.set(key, pending);
  }
  return pending;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  let body: T & {
    code?: string;
    error?: string;
    message?: string;
    validationIssues?: { path: string; message: string }[];
    noEffect?: boolean;
  };
  try {
    body = (await response.json()) as T & { error?: string; message?: string };
  } catch {
    if (response.ok) throw new Error('Invalid successful Admin response');
    throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    if (response.ok) throw new Error('Invalid successful Admin response');
    throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
  }
  if (!response.ok)
    throw Object.assign(new Error(body.message ?? body.error ?? `Request failed (${response.status})`), {
      status: response.status,
      // The server's stable reason (BUSY, or a config rejection code; see config-rejection.ts); callers validate it.
      code: typeof body.code === 'string' ? body.code : undefined,
      validationIssues: body.validationIssues,
      noEffect: body.noEffect === true,
    });
  return body;
}
/** Shopify was throttling or degraded; nothing happened and the same action can be retried. */
export function isShopifyBusy(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'BUSY';
}
/** A failure without an HTTP answer after the request was actually sent: its effect is unknown.
 * Failures before dispatch (token wait, deadline, missing host) are known to have had none. */
export function isUnansweredRequest(error: unknown): boolean {
  return !!error && typeof error === 'object' && !('status' in error) && 'dispatched' in error && error.dispatched === true;
}
/** `resendValidityMs`: a resent publish's required session-token validity (#468). */
export async function authenticatedJson<T>(
  path: string,
  init: RequestInit = {},
  forceFresh = false,
  resendValidityMs?: number,
): Promise<T> {
  const policy = adminRequestPolicy(path, init, resendValidityMs);
  let dispatched = false;
  try {
    return await authenticatedRequest<T>(path, init, forceFresh, policy, (sent) => {
      dispatched = sent;
    });
  } catch (error) {
    if (error && typeof error === 'object' && !('status' in error))
      try {
        Object.defineProperty(error, 'dispatched', { value: dispatched, configurable: true });
      } catch {
        /* A frozen error stays unmarked, which reads as not dispatched. */
      }
    throw error;
  }
}
function authenticatedRequest<T>(
  path: string,
  init: RequestInit,
  forceFresh: boolean,
  policy: ReturnType<typeof adminRequestPolicy>,
  dispatching: (sent: boolean) => void,
): Promise<T> {
  return browserDeadline(
    async (signal) => {
      const send = async (fresh = forceFresh) => {
        // A request answered 401 had no effect: a retry that fails before it is sent is not dispatched.
        dispatching(false);
        const token = await sessionToken(fresh, policy);
        signal.throwIfAborted();
        dispatching(true);
        return fetch(path, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal,
        });
      };
      let response = await send();
      // Signing setup consumes a single-use owner allocation, including ambiguous replies.
      const singleAttempt = path === '/api/admin/signing' && init.method?.toUpperCase() === 'POST';
      if (response.status === 401 && !singleAttempt) response = await send(true);
      return jsonResponse<T>(response);
    },
    init.signal,
    policy.timeoutMs,
  );
}
