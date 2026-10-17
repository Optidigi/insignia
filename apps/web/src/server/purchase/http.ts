import { randomUUID } from 'node:crypto';
import {
  PurchaseAttachmentSchema,
  PurchaseListViewSchema,
  PurchaseLockSchema,
  PurchasePrivateUrlSchema,
  PurchaseReconcileSchema,
  PurchaseViewSchema,
} from '@insignia/contracts';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from '../admin/contracts.js';
import { mutationOrigin, validActor } from '../admin/http.ts';
import { artworkJsonBody } from '../artwork/body.ts';
import type { PurchaseServices } from './service.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export async function handlePurchaseRequest(
  request: Request,
  services: PurchaseServices | undefined,
  route = '',
): Promise<Response> {
  const requestId = randomUUID();
  const respond = (data: unknown, status = 200, maximumBytes = 1048576) => {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > maximumBytes) throw new HttpError(503, 'RESPONSE_TOO_LARGE');
    return new Response(text, {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
  try {
    if (!services) throw new HttpError(503, 'UNAVAILABLE');
    if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
      throw new HttpError(401, 'UNAUTHORIZED');
    const actor: AdminActor | null = await services.authenticate(request);
    if (!validActor(actor, Date.now())) throw new HttpError(401, 'UNAUTHORIZED');
    if (actor.canReadOrders !== true || actor.canReadArtwork !== true) throw new HttpError(403, 'PERMISSION_REQUIRED');
    const url = new URL(request.url);
    if (url.searchParams.has('shop') && url.searchParams.get('shop') !== actor.shop)
      throw new HttpError(403, 'SHOP_MISMATCH');
    if (route === 'privacy' || route.startsWith('privacy/')) {
      if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      if (route === 'privacy') {
        const after = url.searchParams.get('after');
        if (after && !UUID.test(after)) throw new HttpError(400, 'INVALID_REQUEST');
        return respond(await services.privacyRequests(actor, after));
      }
      const [, inboxId, kind, purchaseId, setKind, setId, ...remaining] = route.split('/');
      if (!inboxId || !UUID.test(inboxId) || remaining.length) throw new HttpError(404, 'NOT_FOUND');
      let value: unknown;
      if (!kind && !purchaseId) value = await services.privacyRequest(actor, inboxId);
      else if (kind === 'orders' && purchaseId && UUID.test(purchaseId)) {
        if (!setKind && !setId) value = await services.privacyOrder(actor, inboxId, purchaseId);
        else if (setKind === 'sets' && setId && UUID.test(setId))
          value = await services.privacyOrder(actor, inboxId, purchaseId, setId);
        else throw new HttpError(404, 'NOT_FOUND');
      } else throw new HttpError(404, 'NOT_FOUND');
      if (!value) throw new HttpError(404, 'NOT_FOUND');
      return respond(value, 200, 4194304);
    }
    const [id, action, assetId, purpose, ...extra] = route.split('/');
    if (extra.length || (id && !UUID.test(id))) throw new HttpError(404, 'NOT_FOUND');
    if (request.method === 'GET') {
      if (!route) {
        const before = url.searchParams.get('before');
        const limit = Number(url.searchParams.get('limit') ?? '20');
        if ((before && !UUID.test(before)) || !Number.isInteger(limit) || limit < 1 || limit > 50)
          throw new HttpError(400, 'INVALID_REQUEST');
        return respond(PurchaseListViewSchema.parse(await services.list(actor, { before, limit })));
      }
      if (id && !action) {
        const view = await services.get(actor, id);
        if (!view) throw new HttpError(404, 'NOT_FOUND');
        return respond(PurchaseViewSchema.parse(view));
      }
      if (
        id &&
        action === 'artwork' &&
        assetId &&
        UUID.test(assetId) &&
        ['download', 'preview'].includes(purpose ?? '')
      ) {
        const value = await services[purpose as 'download' | 'preview'](actor, id, assetId);
        return respond(
          PurchasePrivateUrlSchema.parse({
            url: value.url,
            expiresAt: value.expiresAt,
            ...('aspectRatio' in value ? { aspectRatio: value.aspectRatio } : {}),
          }),
        );
      }
      throw new HttpError(404, 'NOT_FOUND');
    }
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    if (!mutationOrigin(request, services.appOrigin)) throw new HttpError(403, 'ORIGIN_DENIED');
    if (actor.canUploadArtwork !== true) throw new HttpError(403, 'PERMISSION_REQUIRED');
    if (!id || assetId || purpose || !['artwork', 'lock', 'reconcile'].includes(action ?? ''))
      throw new HttpError(404, 'NOT_FOUND');
    const body = await artworkJsonBody(request);
    if (!body) throw new HttpError(400, 'INVALID_REQUEST');
    const schema =
      action === 'artwork'
        ? PurchaseAttachmentSchema
        : action === 'lock'
          ? PurchaseLockSchema
          : PurchaseReconcileSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
    if (action === 'artwork') await services.attach(actor, id, PurchaseAttachmentSchema.parse(body));
    else if (action === 'lock') await services.lock(actor, id, PurchaseLockSchema.parse(body));
    else await services.reconcile(actor, id);
    const view = await services.get(actor, id);
    if (!view) throw new HttpError(404, 'NOT_FOUND');
    return respond(PurchaseViewSchema.parse(view), action === 'reconcile' ? 202 : 200);
  } catch (error) {
    if (error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED') {
      const response = respond({ code: 'UNAUTHORIZED', message: 'Fresh merchant identity required', requestId }, 401);
      response.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      return response;
    }
    const code =
      error instanceof HttpError
        ? error.code
        : typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : error instanceof Error
            ? error.message
            : 'UNAVAILABLE';
    const status =
      error instanceof HttpError
        ? error.status
        : ((
            {
              NOT_FOUND: 404,
              CONFLICT: 409,
              LOCKED: 409,
              NOT_READY: 409,
              EXPIRED: 410,
              INVALID: 400,
              MERCHANT_REQUIRED: 403,
              INVALID_ARTWORK_COMMAND: 400,
              ARTWORK_UNAVAILABLE: 410,
            } as Record<string, number>
          )[code] ?? 503);
    return respond(
      {
        code: status === 503 ? 'UNAVAILABLE' : code,
        message: status === 503 ? 'Purchase dependency unavailable' : 'Purchase request requires review',
        requestId,
      },
      status,
    );
  }
}
