import type { AcceptedQuote, QuoteAuthorizationSet, QuoteIssuanceWindow } from '../quote/accept-quote.js';

/** Supplied only by an independently authenticated, fully paginated provider read. */
export type VerifiedOrder = {
  shopId: string;
  installationGeneration: string;
  orderId: string;
  createdAt: string;
  updatedAt: string;
  observedAt: string;
  currency: string;
  country: string | null;
  marketId: string | null;
  contextVerified: boolean;
  totalPriceMinor: string;
  test: boolean;
  edited: boolean;
  sourceApiVersion: '2026-07';
  complete: boolean;
  financialStatus: string;
  cancelledAt: string | null;
  lines: readonly {
    lineId: string;
    productId: string | null;
    variantId: string | null;
    quantity: number;
    currentQuantity: number;
    originalUnitPriceMinor: string;
    sellingPlanId: string | null;
    attributes: readonly { key: string; value: string }[];
  }[];
  transactions: readonly {
    transactionId: string;
    kind: string;
    status: string;
    occurredAt: string | null;
    amountMinor: string;
    currency: string;
  }[];
  refunds: readonly {
    refundId: string;
    occurredAt: string;
    currency: string;
    amountMinor: string;
    lines: readonly { lineId: string; quantity: number; amountMinor: string }[];
  }[];
};

export type HistoricalPurchaseOffer = {
  quote: AcceptedQuote;
  authorization: QuoteAuthorizationSet;
  issuance: QuoteIssuanceWindow;
  publicKey: Uint8Array;
  keyRevokedAt: string | null;
  installationWindow: { generation: string; startedAt: string; deactivatedAt: string | null };
  /** Historical payload with original collection deadlines, never reconstructed from current config. */
  designPayload: unknown;
  payloadCollectedAt: string;
  payloadExpiresAt: string;
};
export type PurchaseBinding = {
  quoteId: string;
  authorizationSetId: string;
  quote: AcceptedQuote;
  lines: readonly {
    orderLineId: string;
    lineIndex: number;
    productId: string;
    variantId: string;
    quantity: number;
    unitPriceMinor: string;
  }[];
  designPayload: unknown;
  payloadCollectedAt: string;
  payloadExpiresAt: string;
};
export type PurchaseObservation = {
  order: VerifiedOrder;
  bindings: readonly PurchaseBinding[];
  exception: string | null;
  /** A verified successful payment fact; first-fully-paid timing is resolved from provider facts. */
  firstPaidAt: string | null;
};
export interface PurchasePorts {
  orders: { read(input: { shopId: string; installationGeneration: string; orderId: string }): Promise<VerifiedOrder> };
  offers: {
    get(input: {
      shopId: string;
      installationGeneration: string;
      quoteId: string;
      authorizationSetId: string;
    }): Promise<HistoricalPurchaseOffer | null>;
  };
  store: { reconcile(observation: PurchaseObservation): Promise<unknown> };
}
