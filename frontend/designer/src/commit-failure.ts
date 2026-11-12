import { BUYER_CART_CAPACITY } from '@insignia/contracts';
import { type CustomerMessage, customerMessage } from '@insignia/ui-localization/customer';
import type { PortFailure } from './port-failure';

/**
 * Why a review (quote preparation) or Add to cart failed (spec §8.3). One cause each; a field exists only for
 * the causes it belongs to. `preparation`: the quote must be prepared again, so the primary action reviews again;
 * otherwise it repeats Add to cart.
 */
export type CommitFailure =
  | {
      cause:
        | 'unknown'
        | 'unavailable'
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
  /**
   * Retry helps after the server's `Retry-After` (`retryAfterSeconds`, when sent). `waiting` holds Retry until it
   * passes; the runtime owns that timer.
   */
  | { cause: 'busy' | 'rate-limited'; preparation: boolean; retryAfterSeconds?: number; waiting: boolean }
  /** `retryAfterSeconds`: when the visitor window admits a new session, if the server said. */
  | { cause: 'session-limited'; preparation: boolean; retryAfterSeconds?: number }
  /** Another tab or the repair view holds the cart lock, which only applying an accepted set takes. */
  | { cause: 'cart-busy'; preparation: false }
  /** Shopify definitely refused the cart write (only Add to cart reaches it); `detail` is its own explanation. */
  | { cause: 'cart-rejected' | 'cart-rejected-stock'; preparation: false; detail?: string };
export type CommitFailureCause = CommitFailure['cause'];

/**
 * The primary action after a failure. Only the two retries repeat a request: `retry-review` prepares the quote
 * again, `retry-add` repeats Add to cart. `edit-quantities` returns to Quantities, `replace-artwork` and
 * `edit-design` to the Design step, and `close` uses the usual close flow, which keeps the design.
 */
export type CommitFailureAction =
  | 'retry-review'
  | 'retry-add'
  | 'edit-quantities'
  | 'replace-artwork'
  | 'edit-design'
  | 'close';

/** A failed port call's cause. A code outside the whitelist, or none, is `unknown`. */
export function commitFailure(
  { code, reason, retryAfter, stock, detail }: PortFailure,
  preparation: boolean,
): CommitFailure {
  const wait = retryAfter ? { retryAfterSeconds: retryAfter } : {};
  switch (code) {
    // Both only follow an accepted set; a preparation never reaches them.
    case 'CART_REJECTED':
      return preparation
        ? { cause: 'unknown', preparation }
        : { cause: stock ? 'cart-rejected-stock' : 'cart-rejected', preparation, ...(detail ? { detail } : {}) };
    case 'CART_BUSY': return preparation ? { cause: 'unknown', preparation } : { cause: 'cart-busy', preparation };
    case 'CAPACITY_EXCEEDED': return { cause: reason === 'CART_LINES' ? 'cart-lines' : 'capacity', preparation };
    case 'SESSION_RATE_LIMITED': return { cause: 'session-limited', preparation, ...wait };
    case 'RATE_LIMITED': return { cause: 'rate-limited', preparation, ...wait, waiting: !!retryAfter };
    case 'BUSY': return { cause: 'busy', preparation, ...wait, waiting: !!retryAfter };
    case 'REVIEW_REQUIRED': return { cause: 'review-required', preparation };
    case 'ARTWORK_EXPIRED': return { cause: 'artwork-expired', preparation };
    case 'POSITION_INVALID': return { cause: 'position-invalid', preparation };
    case 'PRODUCT_UNAVAILABLE': return { cause: 'product-unavailable', preparation };
    case 'UNSUPPORTED_MARKET': return { cause: 'unsupported-market', preparation };
    case 'COUNTRY_REQUIRED': return { cause: 'country-required', preparation };
    case 'ENTITLEMENT_DENIED': return { cause: 'entitlement-denied', preparation };
    case 'UNAVAILABLE': return { cause: 'unavailable', preparation };
    default: return { cause: 'unknown', preparation };
  }
}

/** Whole minutes, rounded up. */
const minutes = (seconds: number) => Math.ceil(seconds / 60);

/**
 * The one place a failure's copy, primary action and Retry hold are decided. `detail`, when present, is Shopify's
 * own plain-text explanation and replaces the message. The server's English message is never shown.
 */
export function commitFailureView(
  failure: CommitFailure,
  formatLocale: string,
): { message: CustomerMessage; detail?: string; action: CommitFailureAction; waiting: boolean } {
  const retry = failure.preparation ? 'retry-review' : 'retry-add';
  const view = (message: CustomerMessage, action: CommitFailureAction = retry) => ({ message, action, waiting: false });
  switch (failure.cause) {
    case 'unknown':
      return view(
        failure.preparation
          ? customerMessage('common:summary.unavailable')
          : customerMessage('customer:recovery.cartCommitFailed'),
      );
    case 'unavailable': return view(customerMessage('customer:recovery.unavailable'));
    case 'busy': return { ...view(customerMessage('customer:recovery.busy')), waiting: failure.waiting };
    case 'rate-limited':
      return {
        ...view(
          failure.retryAfterSeconds
            ? customerMessage('customer:recovery.rateLimitedWait', { count: minutes(failure.retryAfterSeconds) })
            : customerMessage('customer:recovery.rateLimited'),
        ),
        waiting: failure.waiting,
      };
    case 'cart-busy': return view(customerMessage('customer:recovery.cartBusy'));
    case 'review-required': return view(customerMessage('customer:recovery.reviewRequired'));
    case 'cart-rejected':
    case 'cart-rejected-stock':
      // Review and Add to cart prepare afresh after a refusal.
      return {
        ...view(
          customerMessage(
            failure.cause === 'cart-rejected-stock' ? 'customer:recovery.cartRejectedStock' : 'customer:recovery.cartRejected',
          ),
        ),
        ...(failure.detail ? { detail: failure.detail } : {}),
      };
    case 'capacity':
      return view(
        customerMessage('customer:recovery.cartLimit', {
          formattedMaxLines: new Intl.NumberFormat(formatLocale).format(BUYER_CART_CAPACITY.variants),
          formattedMaxItems: new Intl.NumberFormat(formatLocale).format(BUYER_CART_CAPACITY.quantity),
        }),
        'edit-quantities',
      );
    case 'cart-lines': return view(customerMessage('customer:recovery.cartLineLimit'), 'edit-quantities');
    case 'artwork-expired': return view(customerMessage('customer:recovery.artworkExpired'), 'replace-artwork');
    case 'position-invalid': return view(customerMessage('customer:recovery.positionInvalid'), 'edit-design');
    case 'product-unavailable': return view(customerMessage('customer:recovery.productUnavailable'), 'close');
    case 'unsupported-market': return view(customerMessage('customer:recovery.unsupportedMarket'), 'close');
    case 'country-required': return view(customerMessage('customer:recovery.countryRequired'), 'close');
    case 'entitlement-denied': return view(customerMessage('customer:recovery.entitlementDenied'), 'close');
    // Neither a retry nor another file helps until the visitor window admits a new session (#348). Without
    // Retry-After the one-hour window is the longest wait, as for an upload.
    case 'session-limited':
      return view(
        customerMessage('customer:artwork.sessionLimited', { count: minutes(failure.retryAfterSeconds ?? 3600) }),
        'close',
      );
  }
}
