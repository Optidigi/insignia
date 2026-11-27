/** Why a Shopify Admin read was unavailable: a fixed, data-free vocabulary for diagnostics. */
export type ShopifyAdminUnavailableReason = 'timeout' | 'throttled' | 'http_5xx' | 'internal_server_error' | 'network';
/** A Shopify Admin request encountered a transient provider or transport failure. */
export class ShopifyAdminUnavailableError extends Error {
  readonly transient = true;
  constructor(
    message: string,
    readonly reason?: ShopifyAdminUnavailableReason,
  ) {
    super(message);
    this.name = 'ShopifyAdminUnavailableError';
  }
}
/** Shopify answers with HTTP 429 or 5xx while throttling or degraded; a later retry can succeed. */
export function transientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
/** Shopify reports throttling as HTTP 200 with a THROTTLED GraphQL error. */
export function graphqlThrottled(errors: unknown): boolean {
  return (
    Array.isArray(errors) &&
    errors.some((error) => (error as { extensions?: { code?: unknown } } | null)?.extensions?.code === 'THROTTLED')
  );
}

/** Shopify reports a failure on its side as HTTP 200 with an INTERNAL_SERVER_ERROR GraphQL error. */
export function graphqlInternalError(errors: unknown): boolean {
  return (
    Array.isArray(errors) &&
    errors.some(
      (error) => (error as { extensions?: { code?: unknown } } | null)?.extensions?.code === 'INTERNAL_SERVER_ERROR',
    )
  );
}
/** Throttling or a Shopify-side failure in any reported GraphQL error: a later retry can succeed (spec §8.3). */
export function graphqlTransient(errors: unknown): boolean {
  return graphqlThrottled(errors) || graphqlInternalError(errors);
}

/** Hard wall-clock bound even when an injected transport ignores AbortSignal. */
export async function withAdminDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  label: string,
  onTimeout?: () => void,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      try {
        onTimeout?.();
      } catch {
        /* cancellation is best effort */
      }
      reject(new ShopifyAdminUnavailableError(label + ' timed out', 'timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
