import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ArtworkScope } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import { artworkJsonBody } from './body.ts';

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
  /** Explicit buyer-session budget; standalone M6 callers keep their four-hour window. */
  sessionDurationMs?: number;
}) {
  if (!input.secret) throw new Error('Guest capability configuration missing');
  const clock = input.clock ?? Date.now;
  const sessionDurationMs = input.sessionDurationMs ?? 4 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sessionDurationMs) || sessionDurationMs < 60_000 || sessionDurationMs > 7 * 86400_000)
    throw new Error('Guest session duration invalid');
  const digest = (body: string) =>
    createHmac('sha256', input.secret).update('insignia-artwork-guest-v1\0').update(body).digest();
  async function resource(request: Request, expected?: Guest) {
    const url = new URL(request.url);
    const proxy = await input.verifyProxy(url);
    if (!proxy || (expected && expected.shop !== proxy.shop)) return null;
    // Routing authority is the signed proxy shop, never the unsigned Origin header.
    // Storefront custom domains are supported. Guest mutation authority is a private
    // body capability (no ambient cookies); JSON responses expose no cross-origin grant.
    // A caller with that bearer capability has the same authority when Origin is absent.
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
    async resolve(request: Request) {
      if (request.method !== 'GET') return null;
      const authorized = await resource(request);
      return authorized
        ? {
            shopId: authorized.shop.shopId,
            installationGeneration: authorized.shop.currentGeneration,
            productId: authorized.productId,
          }
        : null;
    },
    async issue(request: Request) {
      if (request.method !== 'GET') return null;
      const authorized = await resource(request);
      if (!authorized) return null;
      const expiresAt = clock() + sessionDurationMs;
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
      const envelope = await artworkJsonBody(request);
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
        guest.expiresAt > clock() + sessionDurationMs ||
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
