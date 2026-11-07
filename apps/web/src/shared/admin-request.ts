import { adminRequestPolicy } from '../../../../frontend/admin/src/shared/admin-request-policy.ts';
import { readFreshBridgeToken } from '../../../../frontend/admin/src/shared/bridge-token.ts';

const tokenRequests = new Map<number, Promise<string>>();
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
  const key = policy.minimumValidityMs;
  let pending = tokenRequests.get(key);
  if (!pending) {
    pending = acquire().finally(() => tokenRequests.delete(key));
    tokenRequests.set(key, pending);
  }
  return pending;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  let body: T & {
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
      validationIssues: body.validationIssues,
      noEffect: body.noEffect === true,
    });
  return body;
}
export async function authenticatedJson<T>(path: string, init: RequestInit = {}, forceFresh = false): Promise<T> {
  const policy = adminRequestPolicy(path, init);
  return browserDeadline(
    async (signal) => {
      const send = async (fresh = forceFresh) => {
        const token = await sessionToken(fresh, policy);
        signal.throwIfAborted();
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
      if (response.status === 401) response = await send(true);
      return jsonResponse<T>(response);
    },
    init.signal,
    policy.timeoutMs,
  );
}
