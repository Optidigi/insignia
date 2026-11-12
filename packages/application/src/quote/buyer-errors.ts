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
  | 'ENTITLEMENT_DENIED';

export class BuyerRejectedError extends Error {
  /** `detail` is for tests and debugging only; it never reaches a response or log. */
  constructor(
    readonly code: BuyerRejectionCode,
    detail: string = code,
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
