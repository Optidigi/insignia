export interface SigningOwnerView {
  version: 'm5-signing-owner-action-v1';
  state: 'READY' | 'WAITING_FOR_VERIFICATION' | 'PENDING' | 'PROVISIONED' | 'STOPPED' | 'UNCERTAIN';
  actionAvailable: boolean;
  retryAuthorized: false;
  quoteIssuanceAuthorized: false;
}
/** Fixed transport. POST is dispatched once; recovery uses authenticated GET. */
async function fixedRequest(
  method: 'GET' | 'POST',
  token: () => Promise<string>,
  send: typeof fetch = fetch,
): Promise<SigningOwnerView> {
  if (!['GET', 'POST'].includes(method)) throw new Error('Signing setup unavailable');
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = async () => {
    const once = async () => {
      const bearer = await token();
      if (!/^[^\s]{1,8192}$/.test(bearer)) throw new Error('Signing setup unavailable');
      return send('/api/admin/signing', {
        method,
        signal: abort.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify({ action: 'setup' }) } : {}),
      });
    };
    let response = await once();
    if (method === 'GET' && response.status === 401) response = await once();
    if (!response.ok) throw Object.assign(new Error('Signing setup unavailable'), { status: response.status });
    const value = (await response.json()) as SigningOwnerView;
    const fields = ['version', 'state', 'actionAvailable', 'retryAuthorized', 'quoteIssuanceAuthorized'];
    if (
      !value ||
      Object.keys(value).sort().join(',') !== fields.sort().join(',') ||
      value.version !== 'm5-signing-owner-action-v1' ||
      !['READY', 'WAITING_FOR_VERIFICATION', 'PENDING', 'PROVISIONED', 'STOPPED', 'UNCERTAIN'].includes(value.state) ||
      value.actionAvailable !== (value.state === 'READY') ||
      value.retryAuthorized !== false ||
      value.quoteIssuanceAuthorized !== false
    )
      throw new Error('Signing setup unavailable');
    return value;
  };
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error('Signing setup result unavailable'));
        }, 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function signingOwnerRequest(
  method: 'GET' | 'POST',
  token: () => Promise<string>,
  send: typeof fetch = fetch,
): Promise<SigningOwnerView> {
  return fixedRequest(method, token, send) as Promise<SigningOwnerView>;
}
export function signingAuthorizationDenied(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403);
}
