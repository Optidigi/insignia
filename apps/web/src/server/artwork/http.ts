import { randomUUID } from 'node:crypto';
import { ARTWORK_POLICY, ArtworkError, type ArtworkScope, type createArtworkService } from '@insignia/application';
import { type ArtworkTimingDiagnostic, createObservability } from '@insignia/observability';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from '../admin/contracts.js';
import { adminBusy, adminJson, mutationOrigin, shopifyBusy, validActor } from '../admin/http.ts';
import { artworkEmptyBody, artworkJsonBody } from './body.ts';

export type ArtworkRoute = { audience: 'merchant' | 'guest' } & (
  | { kind: 'begin' }
  | { kind: 'status' | 'complete' | 'preview' | 'download'; assetId: string }
);
export interface ArtworkHttpServices {
  appOrigin: string;
  artwork: ReturnType<typeof createArtworkService>;
  authenticate(request: Request, options?: { fresh?: boolean }): Promise<AdminActor | null>;
  /** Verifies App Proxy, current installation and server-issued resource/session capability. */
  verifyGuest?(request: Request): Promise<ArtworkScope | null>;
  issueGuest?(request: Request): Promise<{ token: string; expiresAt: string } | null>;
  /** No upload admission without a qualified, available isolated worker. */
  ensureInspectionReady?(): Promise<void>;
}
const ASSET = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function declaration(request: Request, guest: boolean) {
  const body = await artworkJsonBody(request);
  return body &&
    Object.keys(body).length === (guest ? 3 : 2) &&
    (!guest || typeof body.capability === 'string') &&
    typeof body.contentType === 'string' &&
    typeof body.byteLength === 'number' &&
    Number.isSafeInteger(body.byteLength) &&
    body.byteLength > 0 &&
    body.byteLength <= ARTWORK_POLICY.maxBytes
    ? { contentType: body.contentType, byteLength: body.byteLength }
    : null;
}

const logger = createObservability().logger;
type ArtworkNote = Partial<Pick<ArtworkTimingDiagnostic, 'assetId' | 'state' | 'failure'>>;
const ARTWORK_STATES = new Set([
  'UPLOADING',
  'QUEUED',
  'INSPECTING',
  'PROMOTING',
  'USABLE',
  'REJECTED',
  'DELETING',
  'DELETED',
]);
function noteResult(note: ArtworkNote, value: unknown) {
  if (!value || typeof value !== 'object') return value;
  if ('assetId' in value && typeof value.assetId === 'string' && ASSET.test(value.assetId))
    note.assetId = value.assetId;
  if ('state' in value && typeof value.state === 'string' && ARTWORK_STATES.has(value.state))
    note.state = value.state as ArtworkTimingDiagnostic['state'];
  return value;
}

/** Guest begin/complete/status each log one timing line; merchant routes are unchanged. */
export async function handleArtworkRequest(
  request: Request,
  services: ArtworkHttpServices | undefined,
  route: ArtworkRoute,
  timing: (value: ArtworkTimingDiagnostic) => void = (value) =>
    logger.info('artwork_request_timing', { artworkTiming: value }),
): Promise<Response> {
  if (route.audience !== 'guest' || (route.kind !== 'begin' && route.kind !== 'complete' && route.kind !== 'status'))
    return respondArtwork(request, services, route, {});
  const operation = route.kind;
  const started = performance.now();
  const note: ArtworkNote = 'assetId' in route && ASSET.test(route.assetId) ? { assetId: route.assetId } : {};
  let httpStatus = 500;
  try {
    const response = await respondArtwork(request, services, route, note);
    httpStatus = response.status;
    return response;
  } finally {
    try {
      timing({
        correlationId: randomUUID(),
        operation,
        outcome: httpStatus < 400 ? 'success' : 'failure',
        httpStatus,
        totalMs: Math.round(performance.now() - started),
        ...(note.assetId ? { assetId: note.assetId } : {}),
        ...(httpStatus < 400 && note.state ? { state: note.state } : {}),
        ...(httpStatus < 400 ? {} : { failure: note.failure ?? 'UNAVAILABLE' }),
      });
    } catch {
      /* Diagnostics never change the buyer response. */
    }
  }
}

async function respondArtwork(
  request: Request,
  services: ArtworkHttpServices | undefined,
  route: ArtworkRoute,
  note: ArtworkNote,
): Promise<Response> {
  if (!services) return adminJson(503, { error: 'Artwork unavailable' });
  const write = route.kind === 'begin' || route.kind === 'complete';
  if (request.method !== (write || route.audience === 'guest' ? 'POST' : 'GET')) {
    note.failure = 'METHOD_NOT_ALLOWED';
    return adminJson(405, { error: 'Method not allowed' });
  }
  let scope: ArtworkScope;
  try {
    if (route.audience === 'merchant') {
      if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
        return adminJson(401, { error: 'Authentication required' });
      // Artwork writes and downloads are staff-sensitive: fresh online exchange.
      const actor = await services.authenticate(
        request,
        write || route.kind === 'download' ? { fresh: true } : undefined,
      );
      if (!validActor(actor, Date.now())) return adminJson(401, { error: 'Authentication required' });
      if (actor.canReadArtwork !== true || (write && actor.canUploadArtwork !== true))
        return adminJson(403, { error: 'Artwork permission required' });
      const url = new URL(request.url);
      if (url.searchParams.has('shop') && url.searchParams.get('shop') !== actor.shop)
        return adminJson(403, { error: 'Shop mismatch' });
      if (write && !mutationOrigin(request, services.appOrigin)) return adminJson(403, { error: 'Origin denied' });
      scope = { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration, kind: 'merchant' };
    } else {
      if (route.kind === 'download') return adminJson(403, { error: 'Merchant access required' });
      const verified = await services.verifyGuest?.(request);
      if (verified?.kind !== 'guest' || !/^[a-f0-9]{64}$/.test(verified.ownerHash ?? '')) {
        note.failure = 'AUTHENTICATION_REQUIRED';
        return adminJson(401, { error: 'Authentication required' });
      }
      scope = verified;
    }
  } catch (error) {
    note.failure = 'AUTHENTICATION_UNAVAILABLE';
    if (shopifyBusy(error)) return adminBusy();
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
      if (!body) {
        note.failure = 'INVALID_DECLARATION';
        return adminJson(422, { error: 'Invalid artwork declaration' });
      }
      note.failure = 'INSPECTION_UNAVAILABLE';
      if (!services.ensureInspectionReady) return adminJson(503, { error: 'Artwork inspection unavailable' });
      await services.ensureInspectionReady();
      note.failure = undefined;
      return adminJson(201, noteResult(note, await services.artwork.begin(scope, body)));
    }
    if (!ASSET.test(route.assetId)) {
      note.failure = 'NOT_FOUND';
      return adminJson(404, { error: 'Artwork not found' });
    }
    if (route.kind === 'complete') {
      // Completion has no client-provided state, tenant, object key or inspection authority.
      if (route.audience === 'merchant' && !(await artworkEmptyBody(request)))
        return adminJson(422, { error: 'Completion body must be empty' });
      return adminJson(202, noteResult(note, await services.artwork.complete(scope, route.assetId)));
    }
    return adminJson(200, noteResult(note, await services.artwork[route.kind](scope, route.assetId)));
  } catch (error) {
    const code = error instanceof ArtworkError ? error.code : 'UNAVAILABLE';
    note.failure ??= code;
    const status = {
      INVALID_INPUT: 422,
      NOT_FOUND: 404,
      EXPIRED: 410,
      NOT_USABLE: 409,
      CONFLICT: 409,
      // 4xx so Shopify's app proxy passes the code and Retry-After through to the storefront.
      RATE_LIMITED: 429,
      UNAVAILABLE: 503,
    }[code];
    const response = adminJson(status, {
      code,
      error: code === 'UNAVAILABLE' ? 'Artwork unavailable' : `Artwork ${code.toLowerCase().replaceAll('_', ' ')}`,
    });
    if (error instanceof ArtworkError && error.retryAfterSeconds)
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
}
