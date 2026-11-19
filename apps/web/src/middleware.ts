import { defineMiddleware } from 'astro:middleware';
import { ensureCustomerArtworkNotificationRuntime } from './server/customer-artwork/notification-runtime.ts';

/** Transport and sniffing hardening for every response; route-specific headers are left untouched. */
export function applyBaselineHeaders(headers: Headers): void {
  if (!headers.has('Strict-Transport-Security')) headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
}

/** A private explicit notification deployment starts one bounded, unref'ed runner; pages never wait for delivery. */
export const onRequest = defineMiddleware(async (_context, next) => {
  if (process.env.INSIGNIA_CUSTOMER_EMAIL_ENABLED === '1' && process.env.CUSTOMER_ARTWORK_EMAIL_PROFILE)
    void ensureCustomerArtworkNotificationRuntime();
  const response = await next();
  try {
    applyBaselineHeaders(response.headers);
  } catch {
    // Immutable headers (a fetched passthrough) keep their own policy.
  }
  return response;
});
