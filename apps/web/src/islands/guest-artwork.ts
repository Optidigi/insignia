import type { JsonApi } from './artwork-upload';

/** Browser-held capability is sent only in a private JSON body through the current App Proxy. */
export function createGuestArtworkApi(input: {
  proxyBase: string;
  productId: string;
  fetchImpl?: typeof fetch;
  clock?: () => number;
}): JsonApi {
  if (!/^\/apps\/[a-z0-9-]{1,64}$/.test(input.proxyBase) || !/^[1-9][0-9]{0,19}$/.test(input.productId))
    throw new Error('Artwork session configuration invalid');
  const transport = input.fetchImpl ?? fetch,
    clock = input.clock ?? Date.now;
  let session: Promise<{ token: string; expiresAt: string }> | undefined;
  async function read<T>(url: string, init: RequestInit): Promise<T> {
    const response = await transport(url, {
      ...init,
      cache: 'no-store',
      // Shopify's storefront access gate needs its same-origin cookie.
      // Proxy signature and private capability still authorize Insignia requests.
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Object.assign(new Error('Artwork request unavailable'), { status: response.status });
    return response.json() as Promise<T>;
  }
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!/^\/api\/artwork(?:\/[a-f0-9-]+\/(?:complete|status|preview))?$/.test(path))
      throw new Error('Artwork action invalid');
    if (!session)
      session = read<{ token: string; expiresAt: string }>(
        `${input.proxyBase}/guest/session?productId=${input.productId}`,
        { method: 'GET' },
      ).catch((error) => {
        session = undefined;
        throw error;
      });
    const grant = await session;
    if (
      typeof grant.token !== 'string' ||
      grant.token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(grant.token) ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= clock()
    ) {
      session = undefined;
      throw Object.assign(new Error('Artwork session expired. Select your file again.'), { status: 410 });
    }
    const declaration = init.body ? JSON.parse(String(init.body)) : {};
    return read<T>(input.proxyBase + '/guest' + path.slice('/api/artwork'.length), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...declaration, capability: grant.token }),
    });
  };
}
