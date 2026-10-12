import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ArtworkScope } from '@insignia/application';
import type { DurableCore } from '@insignia/database';

type Guest = {
  version: 'm6-guest-v1';
  shop: string;
  shopId: string;
  generation: string;
  productId: string;
  nonce: string;
  expiresAt: number;
};
/** App Proxy proves routing identity; the separate resource capability proves session ownership. */
export function createArtworkGuestAuthority(input: {
  core: Pick<DurableCore, 'tenants' | 'acceptedQuotes'>;
  verifyProxy(url: URL): Promise<{ shop: string } | null>;
  secret: string;
  clock?: () => number;
}) {
  if (!input.secret) throw new Error('Guest capability configuration missing');
  const clock = input.clock ?? Date.now;
  const digest = (body: string) =>
    createHmac('sha256', input.secret).update('insignia-artwork-guest-v1\0').update(body).digest();
  async function resource(request: Request, expected?: Guest) {
    const url = new URL(request.url);
    const proxy = await input.verifyProxy(url);
    if (!proxy || (expected && expected.shop !== proxy.shop)) return null;
    // Browser mutations must originate at the authenticated storefront; headerless server proxy requests still need the capability.
    const origin = request.headers.get('Origin');
    if (origin && origin !== `https://${proxy.shop}`) return null;
    const shop = await input.core.tenants.getShopByDomain(proxy.shop);
    if (!shop || (expected && (shop.shopId !== expected.shopId || shop.currentGeneration !== expected.generation)))
      return null;
    const active = await input.core.tenants.getCurrentAdminInstallation(shop.shopId);
    if (!active?.active || active.generation !== shop.currentGeneration) return null;
    const productId = expected?.productId ?? url.searchParams.get('productId');
    if (
      !productId ||
      !/^[1-9][0-9]{0,19}$/.test(productId) ||
      (!expected && url.searchParams.getAll('productId').length !== 1)
    )
      return null;
    if (!(await input.core.acceptedQuotes.getEffective(shop.shopId, productId))) return null;
    return { shop, productId };
  }
  return {
    async issue(request: Request) {
      if (request.method !== 'GET') return null;
      const authorized = await resource(request);
      if (!authorized) return null;
      const expiresAt = clock() + 4 * 60 * 60 * 1000;
      const guest: Guest = {
        version: 'm6-guest-v1',
        shop: authorized.shop.shopDomain,
        shopId: authorized.shop.shopId,
        generation: authorized.shop.currentGeneration,
        productId: authorized.productId,
        nonce: randomBytes(32).toString('base64url'),
        expiresAt,
      };
      const body = Buffer.from(JSON.stringify(guest)).toString('base64url');
      return { token: `${body}.${digest(body).toString('base64url')}`, expiresAt: new Date(expiresAt).toISOString() };
    },
    async verify(request: Request): Promise<ArtworkScope | null> {
      if (
        request.method !== 'POST' ||
        request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
      )
        return null;
      const reader = request.clone().body?.getReader();
      if (!reader) return null;
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2048) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk.value);
      }
      let envelope: { capability?: unknown };
      try {
        envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return null;
      }
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope) ||
        Object.keys(envelope).some((key) => !['capability', 'contentType', 'byteLength'].includes(key))
      )
        return null;
      const token = envelope.capability;
      if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
        return null;
      const [body, signature] = token.split('.');
      if (!body || !signature) return null;
      const supplied = Buffer.from(signature, 'base64url'),
        expected = digest(body);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
      let guest: Guest;
      try {
        guest = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (
        !guest ||
        guest.version !== 'm6-guest-v1' ||
        !Number.isSafeInteger(guest.expiresAt) ||
        guest.expiresAt <= clock() ||
        guest.expiresAt > clock() + 4 * 60 * 60 * 1000 ||
        typeof guest.nonce !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(guest.nonce)
      )
        return null;
      if (!(await resource(request, guest))) return null;
      return {
        kind: 'guest',
        shopId: guest.shopId,
        installationGeneration: guest.generation,
        ownerHash: createHash('sha256').update(guest.nonce).digest('hex'),
      };
    },
  };
}
