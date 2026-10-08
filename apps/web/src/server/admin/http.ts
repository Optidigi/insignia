import { CommandDigestConflictError } from '@insignia/application';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminActor, AdminServices, CommandOutcome } from './contracts.js';

export type AdminRoute = { kind: 'list' } | { kind: 'config'; productId: string };
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const CONFIG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^(0|[1-9][0-9]{0,18})$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_BODY = 256_000;

export function productGid(segment: string): string | null {
  return /^[1-9][0-9]*$/.test(segment) ? `gid://shopify/Product/${segment}` : null;
}

export function adminJson(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      Vary: 'Authorization, Origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function validActor(actor: AdminActor | null, now: number): actor is AdminActor {
  return (
    !!actor &&
    /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(actor.shop) &&
    /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(actor.shopId) &&
    !!actor.installationId &&
    !!actor.staffId &&
    !!actor.sessionId &&
    Number.isFinite(actor.expiresAtMs) &&
    actor.expiresAtMs > now
  );
}

function mutationOrigin(request: Request, appOrigin: string): boolean {
  try {
    const configured = new URL(appOrigin);
    const requested = new URL(request.url);
    const forwardedHttps = configured.protocol === 'https:' && requested.protocol === 'http:';
    return (
      request.headers.get('Origin') === configured.origin &&
      requested.host === configured.host &&
      (requested.protocol === configured.protocol || forwardedHttps) &&
      request.headers.get('Sec-Fetch-Site') !== 'cross-site'
    );
  } catch {
    return false;
  }
}

async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return null;
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_BODY) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function outcome(result: CommandOutcome): Response {
  switch (result.kind) {
    case 'created':
      return adminJson(201, result);
    case 'saved':
      return adminJson(200, result);
    case 'accepted':
      return adminJson(202, result);
    case 'conflict':
      return adminJson(409, result);
    case 'invalid':
      return adminJson(422, result);
    case 'forbidden':
      return adminJson(403, result);
  }
}

/** Authenticated API boundary. A bare document route contains no private data. */
export async function handleAdminRequest(
  request: Request,
  services: AdminServices | undefined,
  route: AdminRoute,
): Promise<Response> {
  if (!services) return adminJson(503, { error: 'Admin service unavailable' });
  const url = new URL(request.url);
  const bearer = request.headers.get('Authorization') ?? '';
  if (!/^Bearer [^\s]{1,8192}$/.test(bearer)) return adminJson(401, { error: 'Authentication required' });
  let actor: AdminActor | null;
  try {
    actor = await services.authenticate(request);
  } catch (error) {
    if (error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED') {
      const response = adminJson(401, { error: 'Authentication required' });
      response.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      return response;
    }
    return adminJson(503, { error: 'Authentication unavailable' });
  }
  if (!validActor(actor, Date.now())) return adminJson(401, { error: 'Authentication required' });
  if (url.searchParams.has('shop') && url.searchParams.get('shop') !== actor.shop)
    return adminJson(403, { error: 'Shop mismatch' });
  if (!actor.canRead) return adminJson(403, { error: 'Read permission required' });

  try {
    if (request.method === 'GET') {
      if (route.kind === 'list') {
        const query = (url.searchParams.get('q') ?? '').trim();
        const cursor = url.searchParams.get('cursor');
        if (query.length > 100 || (cursor && cursor.length > 512)) return adminJson(422, { error: 'Invalid search' });
        return adminJson(200, await services.catalog.list(actor, { query, cursor, limit: 20 }));
      }
      if (!PRODUCT_ID.test(route.productId)) return adminJson(404, { error: 'Product not found' });
      const product = await services.catalog.get(actor, route.productId);
      if (!product || product.id !== route.productId) return adminJson(404, { error: 'Product not found' });
      const view = await services.configs.read(actor, route.productId);
      if (view.product.id !== route.productId) return adminJson(503, { error: 'Product identity mismatch' });
      return adminJson(200, view);
    }
    if (route.kind !== 'config' || !PRODUCT_ID.test(route.productId) || !['POST', 'PUT'].includes(request.method))
      return adminJson(405, { error: 'Method not allowed' });
    if (!mutationOrigin(request, services.appOrigin)) return adminJson(403, { error: 'Origin denied' });
    if (!actor.canEdit) return adminJson(403, { error: 'Edit permission required' });
    const key = request.headers.get('Idempotency-Key') ?? '';
    if (!KEY.test(key)) return adminJson(422, { error: 'Idempotency key required' });
    const body = await bodyObject(request);
    if (!body || 'shop' in body || 'shopId' in body || 'staffId' in body)
      return adminJson(422, { error: 'Invalid command' });
    const source = await services.catalog.get(actor, route.productId);
    if (!source || source.id !== route.productId) return adminJson(404, { error: 'Product not found' });
    if (request.method === 'POST' && body.action === 'create' && Object.keys(body).length === 1)
      return outcome(await services.configs.create(actor, route.productId, key));
    if (
      request.method === 'POST' &&
      body.action === 'copy' &&
      typeof body.targetProductId === 'string' &&
      PRODUCT_ID.test(body.targetProductId) &&
      body.targetProductId !== route.productId &&
      Object.keys(body).length === 2
    ) {
      const target = await services.catalog.get(actor, body.targetProductId);
      if (!target || target.id !== body.targetProductId) return adminJson(404, { error: 'Target product not found' });
      return outcome(await services.configs.copy(actor, route.productId, body.targetProductId, key));
    }
    if (
      request.method === 'POST' &&
      body.action === 'publish' &&
      typeof body.configId === 'string' &&
      CONFIG_ID.test(body.configId) &&
      typeof body.draftVersion === 'string' &&
      VERSION.test(body.draftVersion) &&
      Object.keys(body).length === 3
    )
      return outcome(
        await services.configs.publish(actor, route.productId, {
          configId: body.configId,
          draftVersion: body.draftVersion,
          idempotencyKey: key,
        }),
      );
    if (
      request.method === 'PUT' &&
      body.action === 'save' &&
      typeof body.configId === 'string' &&
      CONFIG_ID.test(body.configId) &&
      typeof body.draftVersion === 'string' &&
      VERSION.test(body.draftVersion) &&
      body.draft &&
      typeof body.draft === 'object' &&
      !Array.isArray(body.draft) &&
      Object.keys(body).length === 4
    )
      return outcome(
        await services.configs.save(actor, route.productId, {
          configId: body.configId,
          draftVersion: body.draftVersion,
          draft: body.draft,
          idempotencyKey: key,
        }),
      );
    return adminJson(422, { error: 'Invalid command' });
  } catch (error) {
    if (error instanceof CommandDigestConflictError)
      return adminJson(409, { kind: 'conflict', message: 'Command key was used for a different request' });
    return adminJson(503, { error: 'Admin service unavailable' });
  }
}
