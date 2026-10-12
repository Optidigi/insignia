import { ARTWORK_POLICY, ArtworkError, type ArtworkScope, type createArtworkService } from '@insignia/application';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from '../admin/contracts.js';
import { adminJson, mutationOrigin, validActor } from '../admin/http.ts';

export type ArtworkRoute = { audience: 'merchant' | 'guest' } & (
  | { kind: 'begin' }
  | { kind: 'status' | 'complete' | 'preview' | 'download'; assetId: string }
);
export interface ArtworkHttpServices {
  appOrigin: string;
  artwork: ReturnType<typeof createArtworkService>;
  authenticate(request: Request): Promise<AdminActor | null>;
  /** Verifies App Proxy, current installation and server-issued resource/session capability. */
  verifyGuest?(request: Request): Promise<ArtworkScope | null>;
  issueGuest?(request: Request): Promise<{ token: string; expiresAt: string } | null>;
  /** No upload admission without a qualified, available isolated worker. */
  ensureInspectionReady?(): Promise<void>;
}
const ASSET = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function declaration(request: Request, guest: boolean) {
  if (
    !(request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() === 'application/json') ||
    !request.body
  )
    return null;
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 2048) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    return body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === (guest ? 3 : 2) &&
      (!guest || typeof body.capability === 'string') &&
      typeof body.contentType === 'string' &&
      Number.isSafeInteger(body.byteLength) &&
      body.byteLength > 0 &&
      body.byteLength <= ARTWORK_POLICY.maxBytes
      ? { contentType: body.contentType, byteLength: body.byteLength }
      : null;
  } catch {
    return null;
  }
}
export async function handleArtworkRequest(
  request: Request,
  services: ArtworkHttpServices | undefined,
  route: ArtworkRoute,
): Promise<Response> {
  if (!services) return adminJson(503, { error: 'Artwork unavailable' });
  const write = route.kind === 'begin' || route.kind === 'complete';
  if (request.method !== (write || route.audience === 'guest' ? 'POST' : 'GET'))
    return adminJson(405, { error: 'Method not allowed' });
  let scope: ArtworkScope;
  try {
    if (route.audience === 'merchant') {
      if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
        return adminJson(401, { error: 'Authentication required' });
      const actor = await services.authenticate(request);
      if (!validActor(actor, Date.now())) return adminJson(401, { error: 'Authentication required' });
      if (!actor.canRead || (write && !actor.canEdit)) return adminJson(403, { error: 'Permission required' });
      const url = new URL(request.url);
      if (url.searchParams.has('shop') && url.searchParams.get('shop') !== actor.shop)
        return adminJson(403, { error: 'Shop mismatch' });
      if (write && !mutationOrigin(request, services.appOrigin)) return adminJson(403, { error: 'Origin denied' });
      scope = { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration, kind: 'merchant' };
    } else {
      if (route.kind === 'download') return adminJson(403, { error: 'Merchant access required' });
      const verified = await services.verifyGuest?.(request);
      if (verified?.kind !== 'guest' || !/^[a-f0-9]{64}$/.test(verified.ownerHash ?? ''))
        return adminJson(401, { error: 'Authentication required' });
      scope = verified;
    }
  } catch (error) {
    const response = adminJson(
      error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED' ? 401 : 503,
      { error: 'Authentication unavailable' },
    );
    if (response.status === 401) response.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    return response;
  }
  try {
    if (route.kind === 'begin') {
      const body = await declaration(request, route.audience === 'guest');
      if (!body) return adminJson(422, { error: 'Invalid artwork declaration' });
      if (!services.ensureInspectionReady) return adminJson(503, { error: 'Artwork inspection unavailable' });
      await services.ensureInspectionReady();
      return adminJson(201, await services.artwork.begin(scope, body));
    }
    if (!ASSET.test(route.assetId)) return adminJson(404, { error: 'Artwork not found' });
    if (route.kind === 'complete') {
      // Completion has no client-provided state, tenant, object key or inspection authority.
      if (request.body && route.audience === 'merchant') {
        const reader = request.body.getReader();
        const first = await reader.read();
        await reader.cancel();
        if (!first.done) return adminJson(422, { error: 'Completion body must be empty' });
      }
      return adminJson(202, await services.artwork.complete(scope, route.assetId));
    }
    return adminJson(200, await services.artwork[route.kind](scope, route.assetId));
  } catch (error) {
    const code = error instanceof ArtworkError ? error.code : 'UNAVAILABLE';
    const status = {
      INVALID_INPUT: 422,
      NOT_FOUND: 404,
      EXPIRED: 410,
      NOT_USABLE: 409,
      CONFLICT: 409,
      UNAVAILABLE: 503,
    }[code];
    return adminJson(status, {
      error: code === 'UNAVAILABLE' ? 'Artwork unavailable' : `Artwork ${code.toLowerCase().replaceAll('_', ' ')}`,
    });
  }
}
