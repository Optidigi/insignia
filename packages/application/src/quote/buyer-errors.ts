/**
 * Conditions a buyer can act on. The buyer API answers each with a specific 4xx status, because
 * Shopify's app proxy replaces every app 5xx with a bare 500 and drops the body and headers.
 * Add a code here and its status/message in `apps/web/src/server/buyer/http.ts`.
 */
export type BuyerRejectionCode =
  | 'REVIEW_REQUIRED'
  | 'UNSUPPORTED_MARKET'
  | 'ARTWORK_EXPIRED'
  | 'POSITION_INVALID'
  | 'PRODUCT_UNAVAILABLE'
  | 'COUNTRY_REQUIRED'
  | 'ENTITLEMENT_DENIED'
  | 'CAPACITY_EXCEEDED'
  /** Only an exhausted lifetime quota of the buyer session (reason SESSION_QUOTA); other limits are not rejections. */
  | 'RATE_LIMITED';

/**
 * A finer, public reason for a rejection, sent as `details.reason`; never the rejected data itself.
 * NOT_OWNED: a cart line's signed set is not owned by this buyer session (an earlier one, #340).
 * NOT_OWNED_EXPIRED: the same, and checkout certainly rejects it: its signed validity ended in the shop's
 * time zone, or its key, authorization epoch or generation is no longer admitted (#371).
 * CART_LINES: CAPACITY_EXCEEDED because the cart would hold more than 200 lines in total, not because
 * of the 32-line / 10,000-garment signed set (#335).
 * SESSION_QUOTA: RATE_LIMITED because a lifetime quota of the buyer session (drafts, proposals, cart
 * applications) is exhausted; no retry succeeds until the session expires (#371).
 */
export type BuyerRejectionReason = 'NOT_OWNED' | 'NOT_OWNED_EXPIRED' | 'CART_LINES' | 'SESSION_QUOTA';

export class BuyerRejectedError extends Error {
  /** `detail` is for tests and debugging only; it never reaches a response or log. */
  constructor(
    readonly code: BuyerRejectionCode,
    detail: string = code,
    readonly reason?: BuyerRejectionReason,
  ) {
    super(detail);
    this.name = 'BuyerRejectedError';
  }
}

/**
 * The shop-local day ended between preparing and signing. The transaction rolls back, so nothing is
 * stored or returned (in renewal the second check follows signing, whose result is discarded); a
 * plain retry re-prepares for the new day.
 */
export class ShopDayChangedError extends Error {
  constructor() {
    super('shop-local day changed before signing');
    this.name = 'ShopDayChangedError';
  }
}
