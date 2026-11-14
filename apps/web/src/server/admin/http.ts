import { CommandDigestConflictError } from '@insignia/application';
import { MethodConfigurationSchema } from '@insignia/contracts';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { ConfigRejectionCode } from '../../shared/config-rejection.ts';
import { SelectedSetupAuthorityError } from '../selected-product.ts';
import { selectedMediaUrlsValid } from '../selected-product-media-urls.ts';
import { CatalogQueryError } from './catalog-query.ts';
import type { AdminActor, AdminServices, CommandOutcome, ConfigRejectionAction } from './contracts.js';
import { MethodAuthorizationError, MethodCurrencyConflictError } from './methods.ts';

export type AdminRoute =
  | { kind: 'list' }
  | { kind: 'config'; productId: string }
  | { kind: 'readiness' }
  | { kind: 'billing' }
  | { kind: 'methods' }
  | { kind: 'method'; methodId: string }
  | { kind: 'signing' };
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

export function validActor(actor: AdminActor | null, now: number): actor is AdminActor {
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

export function mutationOrigin(request: Request, appOrigin: string): boolean {
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
  const limit = /^[a-f0-9]{64}$/.test(request.headers.get('X-Insignia-Setup-Authority') ?? '') ? 1_048_576 : MAX_BODY;
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > limit) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
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

function outcome(services: AdminServices, action: ConfigRejectionAction, result: CommandOutcome): Response {
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
      services.recordConfigRejection?.({ action, code: result.code });
      return adminJson(422, result);
    case 'forbidden':
      return adminJson(403, result);
  }
}

/** A 422 from the configuration route: observable by reason code only, never by request content. */
function configRejected(
  services: AdminServices,
  action: ConfigRejectionAction,
  code: ConfigRejectionCode,
  body: Record<string, unknown>,
): Response {
  services.recordConfigRejection?.({ action, code });
  return adminJson(422, { ...body, code });
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
  if (!/^Bearer [^\s]{1,8192}$/.test(bearer)) {
    services.recordAuthenticationRejection?.(
      request.headers.has('Authorization') ? 'BEARER_MALFORMED' : 'BEARER_MISSING',
    );
    return adminJson(401, { error: 'Authentication required' });
  }
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
  if (!validActor(actor, Date.now())) {
    if (actor !== null) services.recordAuthenticationRejection?.('AUTHENTICATED_ACTOR_REJECTED');
    return adminJson(401, { error: 'Authentication required' });
  }
  if (url.searchParams.has('shop') && url.searchParams.get('shop') !== actor.shop)
    return adminJson(403, { error: 'Shop mismatch' });
  if (!actor.canRead) return adminJson(403, { error: 'Read permission required' });

  try {
    if (route.kind === 'methods' || route.kind === 'method') {
      if (!services.methods) return adminJson(503, { error: 'Method library unavailable' });
      if (route.kind === 'methods' && request.method === 'GET') {
        if (url.searchParams.get('view') === 'catalog')
          return services.methods.catalog
            ? adminJson(200, await services.methods.catalog(actor))
            : adminJson(503, { error: 'Method catalog unavailable' });
        return adminJson(200, await services.methods.list(actor));
      }
      const item = route.kind === 'method';
      if ((item && !['PUT', 'DELETE'].includes(request.method)) || (!item && request.method !== 'POST'))
        return adminJson(405, { error: 'Method not allowed' });
      if (item && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(route.methodId))
        return adminJson(404, { error: 'Method not found' });
      if (!actor.canEdit) return adminJson(403, { error: 'Edit permission required' });
      if (!mutationOrigin(request, services.appOrigin)) return adminJson(403, { error: 'Origin denied' });
      const key = request.headers.get('Idempotency-Key') ?? '';
      if (!KEY.test(key)) return adminJson(422, { error: 'Idempotency key required' });
      const body = await bodyObject(request);
      const methodAuthority = request.headers.get('X-Insignia-Method-Authority') ?? undefined;
      const methodCurrency = request.headers.get('X-Insignia-Method-Currency') ?? undefined;
      if (methodAuthority !== undefined && !/^[a-f0-9]{64}$/.test(methodAuthority))
        return adminJson(422, { error: 'Invalid Method authority' });
      if (body && 'configuration' in body && request.method !== 'DELETE') {
        if (methodAuthority === undefined || (methodCurrency !== 'USD' && methodCurrency !== 'EUR'))
          return adminJson(422, { error: 'Method authority and currency required' });
        if (!services.methods.saveConfiguration) return adminJson(503, { error: 'Method catalog unavailable' });
        const parsed = MethodConfigurationSchema.safeParse(body.configuration);
        if (
          !parsed.success ||
          Object.keys(body).sort().join(',') !== (item ? 'configuration,version' : 'configuration') ||
          (item &&
            (parsed.data.id !== route.methodId.toLowerCase() ||
              typeof body.version !== 'string' ||
              !/^[1-9][0-9]{0,17}$/.test(body.version)))
        )
          return adminJson(422, { error: 'Invalid method configuration' });
        const result = await services.methods.saveConfiguration(
          actor,
          parsed.data,
          item ? (body.version as string) : null,
          key,
          methodAuthority,
          methodCurrency,
        );
        return adminJson(result.kind === 'conflict' ? 409 : result.kind === 'created' ? 201 : 200, result);
      }
      const deleting = request.method === 'DELETE';
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (
        !body ||
        Object.keys(body).sort().join(',') !== (item ? (deleting ? 'version' : 'name,version') : 'name') ||
        (!deleting &&
          (!name ||
            name.length > 80 ||
            Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) ||
        (item && (typeof body.version !== 'string' || !/^[1-9][0-9]{0,17}$/.test(body.version)))
      )
        return adminJson(422, { error: 'Invalid method command' });
      const result = item
        ? deleting
          ? await services.methods.delete(actor, route.methodId, body.version as string, key, methodAuthority)
          : await services.methods.rename(actor, route.methodId, body.version as string, name, key)
        : await services.methods.create(actor, name, key);
      return adminJson(result.kind === 'conflict' ? 409 : result.kind === 'created' ? 201 : 200, result);
    }
    if (route.kind === 'billing') {
      if (request.method !== 'GET') return adminJson(405, { error: 'Method not allowed' });
      return services.billing
        ? adminJson(200, await services.billing(actor))
        : adminJson(503, { error: 'Billing status unavailable' });
    }
    if (route.kind === 'signing') {
      if (!services.signingOwner) return adminJson(503, { error: 'Signing setup unavailable' });
      if (!actor.canEdit) return adminJson(403, { error: 'Edit permission required' });
      if (request.method === 'GET') return adminJson(200, await services.signingOwner.status(actor));
      if (request.method !== 'POST') return adminJson(405, { error: 'Method not allowed' });
      if (!mutationOrigin(request, services.appOrigin)) return adminJson(403, { error: 'Origin denied' });
      const body = await bodyObject(request);
      if (!body || Object.keys(body).length !== 1 || body.action !== 'setup')
        return adminJson(422, { error: 'Invalid command' });
      const result = await services.signingOwner.start(actor, bearer.slice(7));
      return adminJson(result.state === 'PENDING' ? 202 : 200, result);
    }
    if (request.method === 'GET') {
      if (route.kind === 'readiness')
        return services.inspectReadiness
          ? adminJson(200, await services.inspectReadiness(actor))
          : adminJson(503, { error: 'Readiness service unavailable' });
      if (route.kind === 'list') {
        const query = (url.searchParams.get('q') ?? '').trim();
        const cursor = url.searchParams.get('cursor');
        const configuration = url.searchParams.get('configuration');
        const limit = Number(url.searchParams.get('limit') ?? '20');
        if (
          query.length > 100 ||
          (cursor && cursor.length > (cursor.startsWith('selected-catalog-v1:') ? 1024 : 512)) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 20 ||
          (configuration !== null &&
            !['all', 'not_configured', 'draft', 'published', 'unavailable'].includes(configuration))
        )
          return adminJson(422, { error: 'Invalid search' });
        return adminJson(
          200,
          await services.catalog.list(actor, {
            query,
            cursor,
            limit,
            ...(configuration
              ? { configuration: configuration as import('./catalog-query.js').ProductConfigurationFilter }
              : {}),
          }),
        );
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
    if (!KEY.test(key))
      return configRejected(services, 'command', 'IDEMPOTENCY_KEY_REQUIRED', { error: 'Idempotency key required' });
    const body = await bodyObject(request);
    if (!body || 'shop' in body || 'shopId' in body || 'staffId' in body)
      return configRejected(services, 'command', 'INVALID_COMMAND', { error: 'Invalid command' });
    const source = await services.catalog.get(actor, route.productId);
    if (!source || source.id !== route.productId) return adminJson(404, { error: 'Product not found' });
    if (request.method === 'POST' && body.action === 'reconcile') {
      const authority = request.headers.get('X-Insignia-Setup-Authority') ?? '';
      if (
        Object.keys(body).sort().join(',') !== 'action,operationKey,stage' ||
        (body.stage !== 'create' && body.stage !== 'save' && body.stage !== 'publish') ||
        typeof body.operationKey !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.operationKey) ||
        key !== `${body.operationKey}:reconcile` ||
        !/^[a-f0-9]{64}$/.test(authority)
      )
        return configRejected(services, 'reconcile', 'INVALID_RECONCILIATION_IDENTITY', {
          error: 'Invalid reconciliation identity',
        });
      return services.configs.reconcile
        ? adminJson(
            200,
            await services.configs.reconcile(actor, route.productId, {
              stage: body.stage,
              operationKey: body.operationKey,
              authority,
            }),
          )
        : adminJson(503, { error: 'Reconciliation unavailable' });
    }
    if (request.method === 'POST' && body.action === 'create' && Object.keys(body).length === 1)
      return outcome(
        services,
        'create',
        await services.configs.create(
          actor,
          route.productId,
          key,
          request.headers.get('X-Insignia-Setup-Authority') ?? undefined,
        ),
      );
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
      return outcome(services, 'copy', await services.configs.copy(actor, route.productId, body.targetProductId, key));
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
        services,
        'publish',
        await services.configs.publish(actor, route.productId, {
          configId: body.configId,
          draftVersion: body.draftVersion,
          idempotencyKey: key,
          ...(request.headers.has('X-Insignia-Setup-Authority')
            ? { authority: request.headers.get('X-Insignia-Setup-Authority')! }
            : {}),
        }),
      );
    if (
      request.method === 'PUT' &&
      body.action === 'save' &&
      !selectedMediaUrlsValid(body.draft, services.appOrigin, route.productId)
    )
      return configRejected(services, 'save', 'MEDIA_URL_NOT_CANONICAL', {
        kind: 'invalid',
        noEffect: true,
        message: 'Reload owned preview media before saving. Delivery URLs cannot be stored in product configuration.',
      });
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
        services,
        'save',
        await services.configs.save(actor, route.productId, {
          configId: body.configId,
          draftVersion: body.draftVersion,
          draft: body.draft,
          idempotencyKey: key,
          ...(request.headers.has('X-Insignia-Setup-Authority')
            ? { authority: request.headers.get('X-Insignia-Setup-Authority')! }
            : {}),
        }),
      );
    return configRejected(services, 'command', 'INVALID_COMMAND', { error: 'Invalid command' });
  } catch (error) {
    if (error instanceof SelectedSetupAuthorityError)
      return adminJson(403, { error: 'Current setup authority required' });
    if (error instanceof CatalogQueryError) return adminJson(error.status, { error: error.message });
    if (error instanceof MethodCurrencyConflictError) return adminJson(409, { error: error.message });
    if (error instanceof MethodAuthorizationError)
      return adminJson(403, { error: 'Current tenant installation required' });
    if (error instanceof CommandDigestConflictError)
      return adminJson(409, { kind: 'conflict', message: 'Command key was used for a different request' });
    return adminJson(503, { error: 'Admin service unavailable' });
  }
}
