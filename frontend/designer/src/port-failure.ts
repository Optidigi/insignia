/**
 * Buyer API codes the Designer words itself (spec §8.3), plus two local conditions: `CART_BUSY` (another tab
 * or the repair view holds this browser's cart lock) and `CART_REJECTED` (Shopify definitely refused the cart
 * write). Any other code is a generic failure. The server's English `message` is never shown.
 */
export const PORT_FAILURE_CODES = [
  'REVIEW_REQUIRED',
  'ARTWORK_EXPIRED',
  'UNSUPPORTED_MARKET',
  'POSITION_INVALID',
  'PRODUCT_UNAVAILABLE',
  'COUNTRY_REQUIRED',
  'ENTITLEMENT_DENIED',
  'RATE_LIMITED',
  'SESSION_RATE_LIMITED',
  'CAPACITY_EXCEEDED',
  'BUSY',
  'UNAVAILABLE',
  'CART_BUSY',
  'CART_REJECTED',
] as const;
export type PortFailureCode = (typeof PORT_FAILURE_CODES)[number];

/** The longest wait the Designer names: the per-visitor session window is one hour. */
const MAX_RETRY_AFTER_SECONDS = 3600;

/**
 * Everything the Designer reads from a failed port call. The same reader validates and bounds it on both sides of
 * the iframe bridge, so only these whitelisted fields ever cross it.
 */
export interface PortFailure {
  code?: PortFailureCode;
  /** Upload and renewal outcomes (artwork expired, inspection rejected, not found). */
  status?: 403 | 404 | 410 | 422;
  /** Whole seconds to wait, from `Retry-After`; at most one hour. */
  retryAfter?: number;
  /**
   * `CART_LINES`: `CAPACITY_EXCEEDED` over 200 cart lines rather than the signed set (#335). `SESSION_QUOTA`:
   * `RATE_LIMITED` because a lifetime quota of the buyer session is exhausted (#371). `DIMENSIONS_TOO_LARGE`: a 422
   * upload whose image is over the pixel limit (#445).
   */
  reason?: 'CART_LINES' | 'SESSION_QUOTA' | 'DIMENSIONS_TOO_LARGE';
  /** `CART_REJECTED`: Shopify's 422 (stock or limit), and its own explanation as plain text. */
  stock?: true;
  detail?: string;
  /** The port re-proposed; the buyer reviews the refreshed quote before applying it. */
  reviewRequired?: true;
  expiresAt?: string;
  /** The server committed a decline of this acceptance (§8.3 REVIEW_REQUIRED). */
  acceptanceOutcome?: 'declined';
}

const field = (value: object, key: string): unknown => (key in value ? (value as Record<string, unknown>)[key] : undefined);

/** Read a port error (or a bridged failure) into its validated, bounded fields. */
export function portFailure(error: unknown): PortFailure {
  if (!error || typeof error !== 'object') return {};
  const code = field(error, 'code');
  const status = field(error, 'status');
  const retryAfter = field(error, 'retryAfter');
  const details = field(error, 'details');
  const detail = field(error, 'detail');
  const expiresAt = field(error, 'expiresAt');
  // Port errors mark these with their own flags; a bridged failure carries the code.
  const rejected = field(error, 'cartRejected') === true || code === 'CART_REJECTED';
  const detailsReason = details && typeof details === 'object' ? field(details, 'reason') : undefined;
  const reason = (value: string) => field(error, 'reason') === value || detailsReason === value;
  const cartLines = field(error, 'cartLines') === true || reason('CART_LINES');
  const known = rejected ? 'CART_REJECTED' : PORT_FAILURE_CODES.find((candidate) => candidate === code);
  return {
    ...(known ? { code: known } : {}),
    ...(status === 403 || status === 404 || status === 410 || status === 422 ? { status } : {}),
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
      ? { retryAfter: Math.min(Math.ceil(retryAfter), MAX_RETRY_AFTER_SECONDS) }
      : {}),
    ...(known === 'CAPACITY_EXCEEDED' && cartLines ? { reason: 'CART_LINES' as const } : {}),
    ...(known === 'RATE_LIMITED' && reason('SESSION_QUOTA') ? { reason: 'SESSION_QUOTA' as const } : {}),
    ...(status === 422 && reason('DIMENSIONS_TOO_LARGE') ? { reason: 'DIMENSIONS_TOO_LARGE' as const } : {}),
    ...(rejected && field(error, 'stock') === true ? { stock: true as const } : {}),
    ...(rejected && typeof detail === 'string' && detail ? { detail: detail.slice(0, 300) } : {}),
    ...(field(error, 'reviewRequired') === true
      ? {
          reviewRequired: true as const,
          ...(typeof expiresAt === 'string' && expiresAt.length <= 64 && Number.isFinite(Date.parse(expiresAt))
            ? { expiresAt }
            : {}),
        }
      : {}),
    ...(field(error, 'acceptanceOutcome') === 'declined' ? { acceptanceOutcome: 'declined' as const } : {}),
  };
}
