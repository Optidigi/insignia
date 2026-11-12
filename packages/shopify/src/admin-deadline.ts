/** A Shopify Admin request timed out, was throttled or hit a Shopify 5xx; a later retry can succeed. */
export class ShopifyAdminUnavailableError extends Error {
  readonly transient = true;
  constructor(message: string) {
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

/** Hard wall-clock bound even when an injected transport ignores AbortSignal. */
export async function withAdminDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  label: string,
  onTimeout?: () => void,
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
      reject(new ShopifyAdminUnavailableError(label + ' timed out'));
    }, 10_000);
  });
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
