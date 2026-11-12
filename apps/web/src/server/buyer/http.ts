import { randomUUID } from 'node:crypto';
import {
  BuyerAcceptanceDeclinedError,
  BuyerRejectedError,
  type BuyerRejectionCode,
  type BuyerRejectionReason,
  CatalogContextUnavailable,
  EntitlementObservationUnavailableError,
  ShopDayChangedError,
} from '@insignia/application';
import {
  BUYER_CART_CAPACITY,
  BuyerAcceptanceSchema,
  BuyerCapabilitySchema,
  BuyerCartStateSchema,
  BuyerConfirmationSchema,
  BuyerDesignRestoreRequestSchema,
  BuyerDesignSchema,
  BuyerIdSchema,
  BuyerProposalRequestSchema,
  BuyerRenewalSchema,
  isBuyerCartCapacityIssue,
  parseBuyerResponse,
} from '@insignia/contracts';
import { BuyerStateError } from '@insignia/database';
import { type BuyerFailureDiagnostic, type BuyerTimingDiagnostic, createObservability } from '@insignia/observability';
import {
  ContextualPricingError,
  PrimaryMarketError,
  ShopContextError,
  ShopifyAdminUnavailableError,
  VariantAvailabilityError,
} from '@insignia/shopify';
import { buyerJsonBody } from './body.ts';
import {
  cacheStatus,
  proposalDiagnostics,
  proposalFailureStage,
  proposalStage,
  proposalTiming,
} from './diagnostics.ts';
import type { BuyerServices } from './service.ts';

const logger = createObservability().logger;

/**
 * Shopify's app proxy replaces every app 5xx with a bare 500 (no body or headers), so conditions a
 * buyer can act on, and transient ones a retry clears, must be 4xx. Only unexpected failures are 503.
 */
const REJECTIONS: Record<
  BuyerRejectionCode,
  { status: number; errorClass: BuyerFailureDiagnostic['errorClass']; message: string }
> = {
  REVIEW_REQUIRED: {
    status: 409,
    errorClass: 'ReviewRequired',
    message: 'Prices or selections changed. Review the complete customization again.',
  },
  UNSUPPORTED_MARKET: {
    status: 422,
    errorClass: 'UnsupportedMarket',
    message: 'Customization is not available for your country or currency.',
  },
  ARTWORK_EXPIRED: {
    status: 409,
    errorClass: 'ArtworkExpired',
    message: 'Your artwork is no longer available. Upload it again.',
  },
  POSITION_INVALID: {
    status: 422,
    errorClass: 'PositionInvalid',
    message: 'The artwork position is not allowed for this product. Adjust the position.',
  },
  PRODUCT_UNAVAILABLE: {
    status: 410,
    errorClass: 'ProductUnavailable',
    message: 'This product or option is no longer available.',
  },
  COUNTRY_REQUIRED: {
    status: 400,
    errorClass: 'CountryRequired',
    message: 'Your country is needed to customize this product.',
  },
  ENTITLEMENT_DENIED: {
    status: 403,
    errorClass: 'EntitlementDenied',
    message: 'Customization is not available in this store right now.',
  },
  CAPACITY_EXCEEDED: {
    status: 422,
    errorClass: 'CapacityExceeded',
    message: `Your cart has reached the customization limit of ${BUYER_CART_CAPACITY.variants} customized cart lines and ${BUYER_CART_CAPACITY.quantity.toLocaleString('en-US')} customized items. Remove items from your cart or lower quantities to continue.`,
  },
};
const FAILED = 'Customization request could not be completed.';
/**
 * A provider read failure, and whether a later retry can complete it. Each error type owns that
 * knowledge: only throttling, Shopify 5xx and network/abort are transient, never 401/403 or a scope.
 */
function providerReadTransient(error: unknown): boolean | undefined {
  return error instanceof ShopifyAdminUnavailableError ||
    error instanceof ContextualPricingError ||
    error instanceof PrimaryMarketError ||
    error instanceof VariantAvailabilityError ||
    error instanceof ShopContextError ||
    error instanceof CatalogContextUnavailable
    ? error.transient
    : undefined;
}
function classifyFailure(error: unknown): {
  status: number;
  code: string;
  message: string;
  /** Seconds until a retry can succeed: 409 BUSY, and 429 SESSION_RATE_LIMITED from the visitor window. */
  retryAfter?: string;
  /** Only BUSY: the identical request may be repeated after `retryAfter`. */
  retryable?: true;
  /** A rejection's public reason, such as a cart set owned by an earlier session (#340). */
  details?: { reason: BuyerRejectionReason };
  /** Absent for request/state errors that were never logged. */
  errorClass?: BuyerFailureDiagnostic['errorClass'];
} {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: FAILED };
  if (error instanceof BuyerStateError)
    return {
      status: { NOT_FOUND: 404, CONFLICT: 409, RATE_LIMITED: 429, SESSION_RATE_LIMITED: 429, INVALID: 422 }[error.code],
      code: error.code,
      message: FAILED,
      ...(error.retryAfterSeconds ? { retryAfter: String(error.retryAfterSeconds) } : {}),
    };
  if (error instanceof BuyerRejectedError)
    return {
      ...REJECTIONS[error.code],
      code: error.code,
      ...(error.reason ? { details: { reason: error.reason } } : {}),
    };
  // Shopify prices no node for a deleted variant; acceptance prices before it reads stock.
  if (error instanceof ContextualPricingError && error.kind === 'missing_variant')
    return { ...REJECTIONS.PRODUCT_UNAVAILABLE, code: 'PRODUCT_UNAVAILABLE' };
  const databaseCode = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const provider = providerReadTransient(error);
  // Nothing was signed or stored; the same request (acceptance: the same idempotency key) can retry.
  const busy: BuyerFailureDiagnostic['errorClass'] | undefined =
    databaseCode === '55P03'
      ? 'DatabaseLockTimeout'
      : error instanceof ShopDayChangedError
        ? 'ShopDayChanged'
        : provider
          ? 'ProviderReadUnavailable'
          : undefined;
  if (busy)
    return {
      status: 409,
      code: 'BUSY',
      message: 'Customization is busy. Try again in a moment.',
      retryAfter: provider ? '2' : '1',
      retryable: true,
      errorClass: busy,
    };
  return {
    status: 503,
    code: 'UNAVAILABLE',
    message: FAILED,
    errorClass:
      databaseCode === '57014' || (error instanceof Error && error.message === 'Query read timeout')
        ? 'DatabaseQueryTimeout'
        : databaseCode === '42501'
          ? 'DatabasePermissionDenied'
          : error instanceof TypeError
            ? 'TypeError'
            : provider === false
              ? 'ProviderReadUnavailable'
              : error instanceof Error &&
                  [
                    'Function artifact evidence invalid or mismatched',
                    'Buyer acceptance release unavailable',
                    'Trusted release source unavailable',
                  ].includes(error.message)
                ? 'ReleaseEvidenceUnavailable'
                : error instanceof EntitlementObservationUnavailableError
                  ? 'EntitlementObservationUnavailable'
                  : error instanceof Error && error.name === 'SignerUnavailableError'
                    ? 'SignerUnavailable'
                    : error instanceof Error && error.name === 'PublicConfigDriftError'
                      ? 'PublicConfigDrift'
                      : 'UnexpectedFailure',
  };
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
/** An over-capacity cart is buyer-actionable (422), even alongside the per-group bounds it also breaks. */
function invalidDesired(issues: readonly { code: string; params?: unknown }[]): Error {
  return issues.some(isBuyerCartCapacityIssue)
    ? new BuyerRejectedError('CAPACITY_EXCEEDED')
    : new HttpError(400, 'INVALID_REQUEST');
}
export function handleBuyerRequest(...args: Parameters<typeof handleRequest>): Promise<Response> {
  const [collection, id, action] = args[2].split('/');
  return (args[0].method === 'POST' &&
    (args[2] === 'quote-proposals' || (collection === 'quote-proposals' && id && action === 'accept'))) ||
    (args[0].method === 'GET' && args[2] === 'config')
    ? proposalDiagnostics(() => handleRequest(...args))
    : handleRequest(...args);
}

async function handleRequest(
  request: Request,
  services: BuyerServices | undefined,
  route: string,
  /** Buyer-actionable 4xx log at info and BUSY at warn (concurrency pressure stays visible); 503s at error. */
  diagnostic: (value: BuyerFailureDiagnostic, level: 'info' | 'warn' | 'error') => void = (value, level) =>
    level === 'error' ? logger.error('buyer_request_failed', value) : logger[level]('buyer_request_rejected', value),
  timingDiagnostic: (value: BuyerTimingDiagnostic) => void = (value) =>
    logger.info('buyer_request_timing', { timing: value }),
): Promise<Response> {
  const requestId = randomUUID();
  let outcome: BuyerTimingDiagnostic['outcome'] = 'failure';
  let response: Response | undefined;
  const respond = (body: unknown, status = 200) => {
    response = Response.json(status < 400 ? parseBuyerResponse(route, body) : body, {
      status,
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    return response;
  };
  try {
    if (!services) throw new HttpError(503, 'UNAVAILABLE');
    if (route === 'eligibility' && request.method === 'GET') return respond(await services.eligibility(request));
    if (route === 'config' && request.method === 'GET') {
      const config = await services.config(request);
      outcome = 'success';
      return respond(config);
    }
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
      if (!parsed.success) throw invalidDesired(parsed.error.issues);
      const proposal = await proposalStage('prepare', () => services.propose(scope, parsed.data));
      const response = await proposalStage('response-validation', () => respond(proposal));
      outcome = 'success';
      return response;
    }
    if (request.method === 'POST' && collection === 'quote-proposals' && id && action === 'accept') {
      const parsed = BuyerAcceptanceSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
      const accepted = await proposalStage('prepare', () => services.accept(scope, id, parsed.data));
      const response = await proposalStage('response-validation', () => respond(accepted));
      outcome = 'success';
      return response;
    }
    if (request.method === 'POST' && collection === 'quotes' && id && action === 'renew') {
      const parsed = BuyerRenewalSchema.safeParse(body);
      if (!parsed.success) throw invalidDesired(parsed.error.issues);
      return respond(await services.renew(scope, id, parsed.data));
    }
    if (request.method === 'POST' && collection === 'designs' && id && action === 'restore') {
      if (!BuyerDesignRestoreRequestSchema.safeParse(body).success) throw new HttpError(400, 'INVALID_REQUEST');
      return respond(await services.restoreDesign(scope, id));
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
    const failure = classifyFailure(error);
    if (failure.errorClass) {
      // Whitelisted classes/stages only: no exception message/stack, body, URL,
      // capability or signed carriers enter diagnostics or the public response.
      try {
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
        const proposalStage =
          proposalFailureStage(error) ??
          (route === 'quote-proposals' && request.method === 'POST' ? 'request-setup' : undefined);
        diagnostic(
          {
            correlationId: requestId,
            buyerStage,
            errorClass: failure.errorClass,
            ...(proposalStage === undefined ? {} : { proposalStage }),
          },
          failure.status >= 500 ? 'error' : failure.retryable ? 'warn' : 'info',
        );
      } catch {
        /* Diagnostics cannot change settlement. */
      }
    }
    const response = respond(
      {
        code: failure.code,
        ...(error instanceof BuyerAcceptanceDeclinedError ? { acceptanceOutcome: 'declined' as const } : {}),
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        requestId,
        ...(failure.retryable ? { retryable: true } : {}),
      },
      failure.status,
    );
    if (failure.retryAfter) response.headers.set('Retry-After', failure.retryAfter);
    return response;
  } finally {
    try {
      const timing = proposalTiming(
        requestId,
        route === 'quote-proposals' ? 'proposal' : route === 'config' ? 'config' : 'acceptance',
        request.signal.aborted ? 'cancelled' : outcome,
      );
      if (timing) {
        // Diagnostic identity only; no command or buyer capability crosses here.
        const cache = cacheStatus();
        response?.headers.set('X-Insignia-Request-Id', requestId);
        response?.headers.set(
          'Server-Timing',
          `insignia;dur=${timing.totalMs};desc="${requestId}"${cache ? `, cache;desc="${cache}"` : ''}`,
        );
        timingDiagnostic(timing);
      }
    } catch {
      /* Diagnostics cannot change settlement. */
    }
  }
}
