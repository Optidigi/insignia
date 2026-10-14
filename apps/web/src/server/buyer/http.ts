import { randomUUID } from 'node:crypto';
import {
  BuyerAcceptanceSchema,
  BuyerCapabilitySchema,
  BuyerCartStateSchema,
  BuyerConfirmationSchema,
  BuyerDesignSchema,
  BuyerIdSchema,
  BuyerProposalRequestSchema,
  BuyerRenewalSchema,
  parseBuyerResponse,
} from '@insignia/contracts';
import { BuyerStateError } from '@insignia/database';
import { type BuyerFailureDiagnostic, createObservability } from '@insignia/observability';
import { buyerJsonBody } from './body.ts';
import type { BuyerServices } from './service.ts';

const logger = createObservability().logger;

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export async function handleBuyerRequest(
  request: Request,
  services: BuyerServices | undefined,
  route: string,
  diagnostic: (value: BuyerFailureDiagnostic) => void = (value) => logger.error('buyer_request_failed', value),
): Promise<Response> {
  const requestId = randomUUID();
  const respond = (body: unknown, status = 200) =>
    Response.json(status < 400 ? parseBuyerResponse(route, body) : body, {
      status,
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  try {
    if (!services) throw new HttpError(503, 'UNAVAILABLE');
    if (route === 'config' && request.method === 'GET') return respond(await services.config(request));
    const body = await buyerJsonBody(request);
    if (!body) throw new HttpError(400, 'INVALID_REQUEST');
    if (route === 'sessions' && request.method === 'POST') {
      if (Object.keys(body).length) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.session(request));
    }
    if (!BuyerCapabilitySchema.safeParse(body.capability).success) throw new HttpError(401, 'UNAUTHORIZED');
    const authority = await services.guest.verify(
      new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: body.capability }),
      }),
    );
    if (!authority || authority.kind !== 'guest' || !authority.ownerHash) throw new HttpError(401, 'UNAUTHORIZED');
    const scope = {
      shopId: authority.shopId,
      installationGeneration: authority.installationGeneration,
      ownerHash: authority.ownerHash,
    };
    if (!(await services.store.getSession(scope, services.clock()))) throw new HttpError(401, 'UNAUTHORIZED');
    const [collection, id, action] = route.split('/');
    if (id && !BuyerIdSchema.safeParse(id).success) throw new HttpError(400, 'INVALID_REQUEST');
    const issuance =
      request.method === 'POST' &&
      id &&
      ((collection === 'quote-proposals' && action === 'accept') || (collection === 'quotes' && action === 'renew'));
    if (!issuance) await services.store.admitRequest(scope, services.clock());
    if (request.method === 'POST' && route === 'quote-proposals') {
      const parsed = BuyerProposalRequestSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.propose(scope, parsed.data));
    }
    if (request.method === 'POST' && collection === 'quote-proposals' && id && action === 'accept') {
      const parsed = BuyerAcceptanceSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.accept(scope, id, parsed.data));
    }
    if (request.method === 'POST' && collection === 'quotes' && id && action === 'renew') {
      const parsed = BuyerRenewalSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.renew(scope, id, parsed.data));
    }
    if (request.method === 'PUT' && collection === 'designs' && id && !action) {
      const parsed = BuyerDesignSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.design(scope, id, parsed.data));
    }
    if (request.method === 'POST' && collection === 'cart-applications' && id && action === 'confirm') {
      const parsed = BuyerConfirmationSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.confirm(scope, id, parsed.data));
    }
    if (request.method === 'POST' && route === 'cart-state') {
      const parsed = BuyerCartStateSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.cartState(scope, parsed.data.lines));
    }
    throw new HttpError(404, 'NOT_FOUND');
  } catch (error) {
    if (!(error instanceof HttpError) && !(error instanceof BuyerStateError)) {
      const collection = route.split('/')[0] ?? 'request';
      const buyerStage = [
        'config',
        'sessions',
        'quote-proposals',
        'quotes',
        'designs',
        'cart-applications',
        'cart-state',
      ].includes(collection)
        ? (collection as BuyerFailureDiagnostic['buyerStage'])
        : 'request';
      const databaseCode = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const errorClass: BuyerFailureDiagnostic['errorClass'] =
        databaseCode === '55P03'
          ? 'DatabaseLockTimeout'
          : databaseCode === '57014' || (error instanceof Error && error.message === 'Query read timeout')
            ? 'DatabaseQueryTimeout'
            : databaseCode === '42501'
              ? 'DatabasePermissionDenied'
              : error instanceof TypeError
                ? 'TypeError'
                : error instanceof Error && ['ShopContextError', 'CatalogContextError'].includes(error.name)
                  ? 'ProviderReadUnavailable'
                  : error instanceof Error &&
                      [
                        'Function artifact evidence invalid or mismatched',
                        'Buyer acceptance release unavailable',
                        'Trusted release source unavailable',
                      ].includes(error.message)
                    ? 'ReleaseEvidenceUnavailable'
                    : 'UnexpectedFailure';
      // Whitelisted classes/stages only: no exception message/stack, body, URL,
      // capability or signed carriers enter diagnostics or the public response.
      try {
        diagnostic({ correlationId: requestId, buyerStage, errorClass });
      } catch {
        /* Diagnostics cannot change settlement. */
      }
    }
    const code =
      error instanceof HttpError
        ? error.code
        : error instanceof BuyerStateError
          ? error.code
          : error instanceof Error && error.message === 'REVIEW_REQUIRED'
            ? 'REVIEW_REQUIRED'
            : error instanceof Error && error.message === 'fresh recognized entitlement required'
              ? 'ENTITLEMENT_DENIED'
              : 'UNAVAILABLE';
    const status =
      error instanceof HttpError
        ? error.status
        : code === 'RATE_LIMITED'
          ? 429
          : code === 'ENTITLEMENT_DENIED'
            ? 403
            : ['REVIEW_REQUIRED', 'CONFLICT'].includes(code)
              ? 409
              : code === 'NOT_FOUND'
                ? 404
                : code === 'INVALID'
                  ? 422
                  : 503;
    return respond(
      {
        code,
        message:
          code === 'REVIEW_REQUIRED'
            ? 'Prices or selections changed. Review the complete customization again.'
            : 'Customization request could not be completed.',
        requestId,
      },
      status,
    );
  }
}
