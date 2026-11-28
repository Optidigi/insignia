import { CommandDigestConflictError } from '@insignia/application';
import { MethodConfigurationSchema } from '@insignia/contracts';
import { type AdminFailureDiagnostic, describeUnexpectedError } from '@insignia/observability';
import {
  AdminOnlineIdentityError,
  CatalogReadError,
  PartnerSubscriptionError,
  ShopifyAdminUnavailableError,
} from '@insignia/shopify';
import type { ConfigRejectionCode } from '../../shared/config-rejection.ts';
import { PUBLICATION_REQUEST_DEADLINE_MS } from '../merchant-config.ts';
import { SelectedSetupAuthorityError } from '../selected-product.ts';
import { selectedMediaUrlsValid } from '../selected-product-media-urls.ts';
import { AdminAuthenticationBusyError } from './auth.ts';
import { CatalogQueryError } from './catalog-query.ts';
import type { AdminActor, AdminServices, CommandOutcome, ConfigRejectionAction } from './contracts.js';
import { MethodAuthorizationError, MethodCurrencyConflictError } from './methods.ts';
import { publicationStage, timePublication } from './publication-timing.ts';

export type AdminRoute =
  | { kind: 'list' }
  | { kind: 'config'; productId: string }
  | { kind: 'readiness' }
  | { kind: 'billing' }
  | { kind: 'setup-status' }
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

/**
 * Shopify answered with throttling or an outage; nothing about the request was wrong. Partner
 * subscription errors state transience for the buyer API (spec §8.3) only: admin routes keep their 503.
 */
export function shopifyBusy(error: unknown): boolean {
  return (
    error instanceof AdminAuthenticationBusyError ||
    error instanceof ShopifyAdminUnavailableError ||
    (error instanceof Error &&
      !(error instanceof PartnerSubscriptionError) &&
      (error as { transient?: unknown }).transient === true)
  );
}
/** Transient provider conditions are 409 BUSY with Retry-After, never a 5xx (spec §13.1). */
export function adminBusy(): Response {
  const response = adminJson(409, {
    code: 'BUSY',
    error: 'Shopify is busy right now. Wait a few seconds and try again.',
  });
  response.headers.set('Retry-After', String(ADMIN_BUSY_RETRY_AFTER_SECONDS));
  return response;
}
export const ADMIN_BUSY_RETRY_AFTER_SECONDS = 2;
function authenticationBusy(error: unknown): boolean {
  return (
    error instanceof AdminAuthenticationBusyError ||
    (error instanceof Error && (error as { authentication?: unknown }).authentication === true && shopifyBusy(error))
  );
}
/** BUSY only when nothing can have happened: authentication (before any effect) or a read.
 * A failed mutation may already have had an effect and keeps its ambiguous 503. */
export function busyWithoutEffect(request: Request, error: unknown): boolean {
  return authenticationBusy(error) || (request.method === 'GET' && shopifyBusy(error));
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
    case 'resend':
      return adminJson(202, result);
    case 'conflict':
      return adminJson(409, result);
    case 'invalid':
      services.recordConfigRejection?.({ action, code: result.code });
      return adminJson(422, result);
  }
}

async function authenticateAdmin(
  request: Request,
  services: AdminServices,
  fresh: boolean,
  authorityUntilMs?: number,
): Promise<AdminActor | Response> {
  let actor: AdminActor | null;
  try {
    actor = await services.authenticate(
      request,
      fresh ? { fresh: true, ...(authorityUntilMs === undefined ? {} : { authorityUntilMs }) } : undefined,
    );
  } catch (error) {
    if (error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED') {
      const response = adminJson(401, { error: 'Authentication required' });
      response.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      return response;
    }
    if (shopifyBusy(error)) return adminBusy();
    return adminJson(503, { error: 'Authentication unavailable' });
  }
  if (!validActor(actor, Date.now())) {
    if (actor !== null) services.recordAuthenticationRejection?.('AUTHENTICATED_ACTOR_REJECTED');
    return adminJson(401, { error: 'Authentication required' });
  }
  return actor;
}

async function readProductConfig(services: AdminServices, actor: AdminActor, productId: string): Promise<Response> {
  const product = await services.catalog.get(actor, productId);
  if (!product || product.id !== productId) return adminJson(404, { error: 'Product not found' });
  const view = await services.configs.read(actor, productId);
  if (view.product.id !== productId) return adminJson(503, { error: 'Product identity mismatch' });
  return adminJson(200, view);
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

const FAILURE_ROUTES = {
  list: 'catalog',
  readiness: 'readiness',
  billing: 'billing',
  'setup-status': 'setup-status',
  methods: 'methods',
  method: 'method',
  signing: 'signing',
} as const satisfies Record<Exclude<AdminRoute['kind'], 'config'>, AdminFailureDiagnostic['adminRoute']>;
const FAILURE_METHODS: readonly string[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** Unexpected failures are recorded by route template and reduced error only; recording never changes the response. */
export function recordAdminFailure(
  services: Pick<AdminServices, 'recordAdminFailure'>,
  request: Request,
  adminRoute: AdminFailureDiagnostic['adminRoute'],
  error: unknown,
): void {
  if (!services.recordAdminFailure || !FAILURE_METHODS.includes(request.method)) return;
  try {
    services.recordAdminFailure({
      adminRoute,
      httpMethod: request.method as AdminFailureDiagnostic['httpMethod'],
      ...describeUnexpectedError(error),
    });
  } catch {
    // Observation is best effort; the caller still receives the same 503.
  }
}

/** Authenticated API boundary. A bare document route contains no private data. */
export async function handleAdminRequest(
  request: Request,
  services: AdminServices | undefined,
  route: AdminRoute,
): Promise<Response> {
  if (!services) return adminJson(503, { error: 'Admin service unavailable' });
  // A publish's steps may run until PUBLICATION_REQUEST_DEADLINE_MS after this moment (owner, 25 Nov 2026).
  const acceptedAtMs = Date.now();
  const url = new URL(request.url);
  const bearer = request.headers.get('Authorization') ?? '';
  if (!/^Bearer [^\s]{1,8192}$/.test(bearer)) {
    services.recordAuthenticationRejection?.(
      request.headers.has('Authorization') ? 'BEARER_MALFORMED' : 'BEARER_MISSING',
    );
    return adminJson(401, { error: 'Authentication required' });
  }
  // Billing and signing are staff-sensitive: they always use a fresh online exchange.
  const authenticated = await authenticateAdmin(
    request,
    services,
    route.kind === 'billing' || route.kind === 'signing',
  );
  if (authenticated instanceof Response) return authenticated;
  const actor = authenticated;
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
    if (route.kind === 'setup-status') {
      if (request.method !== 'GET') return adminJson(405, { error: 'Method not allowed' });
      return services.setupStatus
        ? adminJson(200, await services.setupStatus(actor))
        : adminJson(503, { error: 'Setup status unavailable' });
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
      try {
        return await readProductConfig(services, actor, route.productId);
      } catch (error) {
        if (!(error instanceof CatalogReadError) || error.kind !== 'http_error' || error.status !== 401) throw error;
        // A concurrent online exchange can revoke a cached grant after authentication. Only this
        // read is repeated, after Shopify and the app both recheck the original staff session.
        const refreshed = await authenticateAdmin(request, services, true);
        if (refreshed instanceof Response) return refreshed;
        if (
          !refreshed.canRead ||
          refreshed.shop !== actor.shop ||
          refreshed.shopId !== actor.shopId ||
          refreshed.tenantShopId !== actor.tenantShopId ||
          refreshed.installationId !== actor.installationId ||
          refreshed.installationGeneration !== actor.installationGeneration ||
          refreshed.staffId !== actor.staffId ||
          refreshed.sessionId !== actor.sessionId
        )
          return adminJson(403, { error: 'Current product read permission required' });
        return await readProductConfig(services, refreshed, route.productId);
      }
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
    if (request.method === 'POST' && body.action === 'choose-free-product') {
      if (
        Object.keys(body).length !== 2 ||
        (body.expectedProductId !== null &&
          (typeof body.expectedProductId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(body.expectedProductId)))
      )
        return adminJson(422, { error: 'Invalid Free product choice' });
      const fresh = await authenticateAdmin(request, services, true);
      if (fresh instanceof Response) return fresh;
      if (fresh.tenantShopId !== actor.tenantShopId || fresh.staffId !== actor.staffId || !fresh.canReadOrders)
        return adminJson(403, { error: 'Store owner access required' });
      const result = await services.configs.chooseFreeProduct?.(fresh, route.productId, body.expectedProductId);
      if (result === 'selected') return adminJson(200, { selected: true });
      if (result === 'missing') return adminJson(404, { error: 'Save the product setup before selecting it' });
      if (result === 'conflict') return adminJson(409, { error: 'Free product changed. Reload and try again.' });
      return adminJson(403, { error: 'Current Free plan and store owner access required' });
    }
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
      body.action === 'publish' &&
      typeof body.configId === 'string' &&
      CONFIG_ID.test(body.configId) &&
      typeof body.draftVersion === 'string' &&
      VERSION.test(body.draftVersion) &&
      Object.keys(body).length === 3
    ) {
      const configId = body.configId;
      const draftVersion = body.draftVersion;
      const publish = async (): Promise<Response | CommandOutcome> => {
        // Publishing is staff-sensitive: confirm the same staff with a fresh online exchange. A request
        // that starts with a valid session token may then finish its steps on that online grant after
        // the token expires, until PUBLICATION_REQUEST_DEADLINE_MS after it was accepted (owner, 25 Nov 2026).
        const fresh = await publicationStage('authentication', () =>
          authenticateAdmin(request, services, true, acceptedAtMs + PUBLICATION_REQUEST_DEADLINE_MS),
        );
        if (fresh instanceof Response) return fresh;
        if (fresh.shop !== actor.shop || fresh.staffId !== actor.staffId || fresh.tenantShopId !== actor.tenantShopId)
          return adminJson(401, { error: 'Authentication required' });
        if (!fresh.canEdit) return adminJson(403, { error: 'Edit permission required' });
        return services.configs.publish(fresh, route.productId, {
          configId,
          draftVersion,
          idempotencyKey: key,
          ...(request.headers.has('X-Insignia-Setup-Authority')
            ? { authority: request.headers.get('X-Insignia-Setup-Authority')! }
            : {}),
        });
      };
      const result = await timePublication(
        publish,
        (settled) =>
          'error' in settled
            ? { outcome: 'failure' }
            : settled.value instanceof Response
              ? { outcome: 'refused' }
              : settled.value.kind === 'accepted'
                ? { outcome: 'accepted', state: settled.value.state }
                : {
                    outcome:
                      settled.value.kind === 'resend' ||
                      settled.value.kind === 'conflict' ||
                      settled.value.kind === 'invalid'
                        ? settled.value.kind
                        : 'failure',
                  },
        services.recordPublicationTiming,
      );
      return result instanceof Response ? result : outcome(services, 'publish', result);
    }
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
    if (busyWithoutEffect(request, error)) return adminBusy();
    recordAdminFailure(
      services,
      request,
      route.kind === 'config'
        ? request.method === 'GET'
          ? 'product-config'
          : 'product-config-command'
        : FAILURE_ROUTES[route.kind],
      error,
    );
    return adminJson(503, { error: 'Admin service unavailable' });
  }
}
