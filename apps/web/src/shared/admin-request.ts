let tokenRequest: Promise<string> | null = null;
async function browserDeadline<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Admin request timed out'));
    }, 10_000);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function sessionToken(forceFresh = false): Promise<string> {
  const bridge = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  const tokenGetter = bridge?.idToken?.bind(bridge);
  if (!tokenGetter) return Promise.reject(new Error('Open this page from Shopify Admin to verify your session.'));
  if (forceFresh) return browserDeadline(() => tokenGetter());
  if (!tokenRequest)
    tokenRequest = browserDeadline(() => tokenGetter()).finally(() => {
      tokenRequest = null;
    });
  return tokenRequest;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  let body: T & { error?: string; message?: string; validationIssues?: { path: string; message: string }[] };
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
    });
  return body;
}
export async function authenticatedJson<T>(path: string, init: RequestInit = {}, forceFresh = false): Promise<T> {
  return browserDeadline(async (signal) => {
    const send = async (fresh = forceFresh) =>
      fetch(path, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: 'Bearer ' + (await sessionToken(fresh)),
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal,
      });
    let response = await send();
    if (response.status === 401) response = await send(true);
    return jsonResponse<T>(response);
  });
}
