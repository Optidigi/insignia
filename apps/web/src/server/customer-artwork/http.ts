import type { createArtworkService, createCustomerArtworkLinks } from '@insignia/application';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor } from '../admin/contracts.js';
import { mutationOrigin, validActor } from '../admin/http.ts';
import { artworkJsonBody } from '../artwork/body.ts';

export type CustomerArtworkHttpServices = {
  appOrigin: string;
  links: ReturnType<typeof createCustomerArtworkLinks>;
  view?(capability: string): Promise<unknown>;
  artwork: Pick<ReturnType<typeof createArtworkService>, 'begin' | 'complete' | 'status' | 'preview'> | undefined;
  authenticate(request: Request): Promise<AdminActor | null>;
  assertMerchantAccess?(actor: AdminActor): Promise<void>;
  ensureInspectionReady(): Promise<void>;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
function exact(body: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(body).length === fields.length && fields.every((field) => Object.hasOwn(body, field));
}
/** Customer authority is solely the explicit bearer capability, never cookies/query/tenant body fields. */
export async function handleCustomerArtworkRequest(
  request: Request,
  services: CustomerArtworkHttpServices | undefined,
): Promise<Response> {
  if (!services) return json({ error: 'Customer artwork unavailable' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json({ error: 'Customer artwork link required' }, 401);
  if (request.headers.has('Origin') && request.headers.get('Origin') !== new URL(services.appOrigin).origin)
    return json({ error: 'Origin denied' }, 403);
  const body = await artworkJsonBody(request);
  if (!body || typeof body.action !== 'string') return json({ error: 'Invalid request' }, 422);
  const fields: Record<string, string[]> = {
    view: ['action'],
    begin: ['action', 'contentType', 'byteLength'],
    complete: ['action', 'assetId'],
    status: ['action', 'assetId'],
    preview: ['action', 'assetId'],
    attach: ['action', 'assetId', 'groupIndex', 'placementId', 'expectedVersion', 'requestId'],
  };
  const allowed = fields[body.action];
  if (!allowed || !exact(body, allowed)) return json({ error: 'Invalid request' }, 422);
  try {
    const view = await services.links.resolve(token);
    if (body.action === 'view') return json(services.view ? await services.view(token) : view);
    if (body.action === 'attach') {
      if (
        typeof body.assetId !== 'string' ||
        typeof body.placementId !== 'string' ||
        typeof body.requestId !== 'string' ||
        typeof body.groupIndex !== 'number' ||
        typeof body.expectedVersion !== 'number'
      )
        return json({ error: 'Invalid request' }, 422);
      return json(
        await services.links.attach(token, {
          assetId: body.assetId,
          placementId: body.placementId,
          groupIndex: body.groupIndex,
          expectedVersion: body.expectedVersion,
          requestId: body.requestId,
        }),
      );
    }
    if (!services.artwork) return json({ error: 'Artwork processing unavailable' }, 503);
    const scope = await services.links.scope(token);
    if (body.action === 'begin') {
      if (!view.slots.length) return json({ error: 'No missing artwork' }, 409);
      if (typeof body.contentType !== 'string' || typeof body.byteLength !== 'number')
        return json({ error: 'Invalid request' }, 422);
      await services.ensureInspectionReady();
      return json(
        await services.artwork.begin(scope, { contentType: body.contentType, byteLength: body.byteLength }),
        201,
      );
    }
    if (typeof body.assetId !== 'string' || !uuid.test(body.assetId)) return json({ error: 'Invalid request' }, 422);
    if (body.action === 'complete') return json(await services.artwork.complete(scope, body.assetId), 202);
    if (body.action === 'status') return json(await services.artwork.status(scope, body.assetId));
    return json(await services.artwork.preview(scope, body.assetId));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'INVALID_INPUT') return json({ error: 'Invalid artwork' }, 422);
    if (code === 'UNAVAILABLE') return json({ error: 'Artwork processing unavailable' }, 503);
    if (code === 'EXPIRED') return json({ error: 'Artwork expired' }, 410);
    if (code === 'NOT_FOUND') return json({ error: 'Artwork unavailable' }, 404);
    if (
      code === 'NOT_USABLE' ||
      code === 'CONFLICT' ||
      (error instanceof Error && error.message === 'CUSTOMER_ARTWORK_UNAVAILABLE')
    )
      return json({ error: 'Customer artwork link or slot unavailable' }, 409);
    return json({ error: 'Customer artwork temporarily unavailable' }, 503);
  }
}
/** Merchant can share before payment, but must have the same verified order/artwork grants as attachment. */
export async function handleMerchantArtworkLinkRequest(
  request: Request,
  services: CustomerArtworkHttpServices | undefined,
  purchaseId: string,
): Promise<Response> {
  if (!services) return json({ error: 'Customer artwork unavailable' }, 503);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
    return json({ error: 'Authentication required' }, 401);
  try {
    const actor = await services.authenticate(request);
    if (!validActor(actor, Date.now())) return json({ error: 'Authentication required' }, 401);
    if (!actor.canReadOrders || !actor.canReadArtwork || !actor.canUploadArtwork)
      return json({ error: 'Artwork permission required' }, 403);
    if (!mutationOrigin(request, services.appOrigin)) return json({ error: 'Origin denied' }, 403);
    if (!uuid.test(purchaseId)) return json({ error: 'Purchase unavailable' }, 404);
    await services.assertMerchantAccess?.(actor);
    if (!validActor(actor, Date.now())) return json({ error: 'Authentication required' }, 401);
    const body = await artworkJsonBody(request);
    if (!body || !exact(body, ['requestId']) || typeof body.requestId !== 'string' || !uuid.test(body.requestId))
      return json({ error: 'Invalid request' }, 422);
    const link = await services.links.issue(
      { kind: 'merchant', shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration },
      { purchaseId, requestId: body.requestId },
    );
    if (services.view) {
      const capability = new URLSearchParams(new URL(link.url).hash.slice(1)).get('capability');
      if (!capability) throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
      await services.view(capability);
    }
    return json(link, 201);
  } catch (error) {
    if (error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED') {
      const response = json({ error: 'Fresh merchant identity required' }, 401);
      response.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      return response;
    }
    return json(
      { error: 'Customer artwork link unavailable' },
      error instanceof Error && error.message === 'CUSTOMER_ARTWORK_UNAVAILABLE' ? 409 : 503,
    );
  }
}
