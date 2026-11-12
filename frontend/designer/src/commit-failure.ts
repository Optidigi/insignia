import { BUYER_CART_CAPACITY } from '@insignia/contracts';
import { type CustomerMessage, customerMessage } from '@insignia/ui-localization/customer';
import type { PortFailure } from './port-failure';

/**
 * Why a review (quote preparation) or Add to cart failed (spec §8.3). One cause each; a field exists only for
 * the causes it belongs to. `preparation`: the failure happened while preparing the quote, so Retry re-prepares
 * it; otherwise the primary action repeats Add to cart.
 */
export type CommitFailure =
  | {
      cause:
        | 'unknown'
        | 'unavailable'
        | 'busy'
        | 'cart-busy'
        | 'review-required'
        | 'artwork-expired'
        | 'position-invalid'
        | 'product-unavailable'
        | 'unsupported-market'
        | 'country-required'
        | 'entitlement-denied'
        /** The whole cart is over one signed set: 32 lines / 10,000 items (#335). */
        | 'capacity'
        /** The cart is over 200 lines in total (#335). */
        | 'cart-lines';
      preparation: boolean;
    }
  /** `retryAfterSeconds`: the server's Retry-After, when it sent one. */
  | { cause: 'rate-limited' | 'session-limited'; preparation: boolean; retryAfterSeconds?: number }
  /** Shopify definitely refused the cart write (only Add to cart reaches it); `detail` is its own explanation. */
  | { cause: 'cart-rejected' | 'cart-rejected-stock'; preparation: false; detail?: string };
export type CommitFailureCause = CommitFailure['cause'];

/**
 * The primary action after a failure. Only `retry` repeats the request; the others never re-send it:
 * `edit-quantities` returns to Quantities, `replace-artwork` and `edit-design` to the Design step, and `close`
 * uses the usual close flow, which keeps the design.
 */
export type CommitFailureAction = 'retry' | 'edit-quantities' | 'replace-artwork' | 'edit-design' | 'close';

/** A failed port call's cause. A code outside the whitelist, or none, is `unknown`. */
export function commitFailure({ code, reason, retryAfter, stock, detail }: PortFailure, preparation: boolean): CommitFailure {
  const wait = retryAfter ? { retryAfterSeconds: retryAfter } : {};
  switch (code) {
    case 'CART_REJECTED':
      return preparation
        ? { cause: 'unknown', preparation }
        : { cause: stock ? 'cart-rejected-stock' : 'cart-rejected', preparation, ...(detail ? { detail } : {}) };
    case 'CAPACITY_EXCEEDED': return { cause: reason === 'CART_LINES' ? 'cart-lines' : 'capacity', preparation };
    case 'SESSION_RATE_LIMITED': return { cause: 'session-limited', preparation, ...wait };
    case 'RATE_LIMITED': return { cause: 'rate-limited', preparation, ...wait };
    case 'REVIEW_REQUIRED': return { cause: 'review-required', preparation };
    case 'ARTWORK_EXPIRED': return { cause: 'artwork-expired', preparation };
    case 'POSITION_INVALID': return { cause: 'position-invalid', preparation };
    case 'PRODUCT_UNAVAILABLE': return { cause: 'product-unavailable', preparation };
    case 'UNSUPPORTED_MARKET': return { cause: 'unsupported-market', preparation };
    case 'COUNTRY_REQUIRED': return { cause: 'country-required', preparation };
    case 'ENTITLEMENT_DENIED': return { cause: 'entitlement-denied', preparation };
    case 'BUSY': return { cause: 'busy', preparation };
    case 'UNAVAILABLE': return { cause: 'unavailable', preparation };
    case 'CART_BUSY': return { cause: 'cart-busy', preparation };
    default: return { cause: 'unknown', preparation };
  }
}

/** Whole minutes, rounded up. */
const minutes = (seconds: number) => Math.ceil(seconds / 60);

/**
 * The one place a failure's copy and action are decided. `detail`, when present, is Shopify's own plain-text
 * explanation and replaces the message. The server's English message is never shown.
 */
export function commitFailureView(
  failure: CommitFailure,
  formatLocale: string,
): { message: CustomerMessage; detail?: string; action: CommitFailureAction } {
  switch (failure.cause) {
    case 'unknown':
      return {
        message: failure.preparation
          ? customerMessage('common:summary.unavailable')
          : customerMessage('customer:recovery.cartCommitFailed'),
        action: 'retry',
      };
    case 'unavailable': return { message: customerMessage('customer:recovery.unavailable'), action: 'retry' };
    case 'busy': return { message: customerMessage('customer:recovery.busy'), action: 'retry' };
    case 'cart-busy': return { message: customerMessage('customer:recovery.cartBusy'), action: 'retry' };
    case 'review-required': return { message: customerMessage('customer:recovery.reviewRequired'), action: 'retry' };
    case 'rate-limited':
      return {
        message: failure.retryAfterSeconds
          ? customerMessage('customer:recovery.rateLimitedWait', { count: minutes(failure.retryAfterSeconds) })
          : customerMessage('customer:recovery.rateLimited'),
        action: 'retry',
      };
    case 'cart-rejected':
    case 'cart-rejected-stock':
      // Review and Add to cart prepare afresh after a refusal.
      return {
        message: customerMessage(
          failure.cause === 'cart-rejected-stock' ? 'customer:recovery.cartRejectedStock' : 'customer:recovery.cartRejected',
        ),
        ...(failure.detail ? { detail: failure.detail } : {}),
        action: 'retry',
      };
    case 'capacity':
      return {
        message: customerMessage('customer:recovery.cartLimit', {
          formattedMaxLines: new Intl.NumberFormat(formatLocale).format(BUYER_CART_CAPACITY.variants),
          formattedMaxItems: new Intl.NumberFormat(formatLocale).format(BUYER_CART_CAPACITY.quantity),
        }),
        action: 'edit-quantities',
      };
    case 'cart-lines': return { message: customerMessage('customer:recovery.cartLineLimit'), action: 'edit-quantities' };
    case 'artwork-expired': return { message: customerMessage('customer:recovery.artworkExpired'), action: 'replace-artwork' };
    case 'position-invalid': return { message: customerMessage('customer:recovery.positionInvalid'), action: 'edit-design' };
    case 'product-unavailable': return { message: customerMessage('customer:recovery.productUnavailable'), action: 'close' };
    case 'unsupported-market': return { message: customerMessage('customer:recovery.unsupportedMarket'), action: 'close' };
    case 'country-required': return { message: customerMessage('customer:recovery.countryRequired'), action: 'close' };
    case 'entitlement-denied': return { message: customerMessage('customer:recovery.entitlementDenied'), action: 'close' };
    // Neither a retry nor another file helps until the visitor window admits a new session (#348). Without
    // Retry-After the one-hour window is the longest wait, as for an upload.
    case 'session-limited':
      return {
        message: customerMessage('customer:artwork.sessionLimited', { count: minutes(failure.retryAfterSeconds ?? 3600) }),
        action: 'close',
      };
  }
}
