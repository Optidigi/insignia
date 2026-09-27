import type { AppEventsTransport, FakeAggregate } from './app-events.ts';
import { BillingProof, type QualificationResult, type VerifiedHistory,
  type VerifiedPurchase, type VerifiedPostPaymentLifecycle, type VerifiedSubmissionWindow,
  type UsageFact } from './index.ts';

/** Production must supply authenticated, fully paginated Partner observations. */
export interface SubscriptionPort {
  readCurrent(shopId: string): Promise<VerifiedHistory>;
  readAt(shopId: string, firstFullyPaidAt: string): Promise<VerifiedHistory>;
  readSubmissionWindow(shopId: string): Promise<VerifiedSubmissionWindow>;
}

/** An off-store application seam; no implementation in this spike opens a network connection. */
export class BillingApplication {
  readonly ledger: BillingProof;
  private readonly subscriptions: SubscriptionPort;
  private readonly events: AppEventsTransport;

  constructor(ledger: BillingProof, subscriptions: SubscriptionPort, events: AppEventsTransport) {
    this.ledger = ledger;
    this.subscriptions = subscriptions;
    this.events = events;
  }

  async decideNewAction(shopId: string, feature: string, now: string): Promise<
      'ALLOW' | 'DENY_FEATURE' | 'DENY_INACTIVE' | 'PENDING_VERIFY'> {
    let history: VerifiedHistory;
    try { history = await this.subscriptions.readCurrent(shopId); }
    catch { return 'PENDING_VERIFY'; }
    return this.ledger.decideNewAction(history, shopId, feature, now);
  }

  async onVerifiedPurchase(purchase: VerifiedPurchase): Promise<QualificationResult> {
    let history: VerifiedHistory;
    try { history = await this.subscriptions.readAt(purchase.shopId, purchase.firstFullyPaidAt); }
    catch { return this.ledger.recordPendingPurchase(purchase); }
    return this.ledger.recordPaid(purchase, history);
  }

  onVerifiedPostPaymentLifecycle(event: VerifiedPostPaymentLifecycle): UsageFact | null {
    return this.ledger.observePostPaymentLifecycle(event);
  }

  async deliverNext(now: string): Promise<
      'NO_PENDING' | 'PENDING_VERIFY' | 'NOT_DUE' | 'RETRY_SCHEDULED' |
      'TRANSPORT_ACCEPTED' | 'RECONCILIATION_REQUIRED'> {
    const pending = this.ledger.outbox().filter(row => row.state === 'PENDING');
    if (pending.length === 0) return 'NO_PENDING';
    const due = pending.find(row => !row.nextAttemptAt || Date.parse(now) >= Date.parse(row.nextAttemptAt));
    if (!due) return 'NOT_DUE';
    let window: VerifiedSubmissionWindow;
    try { window = await this.subscriptions.readSubmissionWindow(due.event.shop_id); }
    catch { return 'PENDING_VERIFY'; }
    return this.ledger.dispatchNext(this.events, window, now, due.event.shop_id);
  }

  reconcile(observation: FakeAggregate): ReturnType<BillingProof['reconcileAggregate']> {
    return this.ledger.reconcileAggregate(observation);
  }
}

/** Synthetic port with explicit missing-data failures; does not authenticate or query Shopify. */
export class FakeSubscriptionPort implements SubscriptionPort {
  private readonly histories = new Map<string, VerifiedHistory>();
  private readonly windows = new Map<string, VerifiedSubmissionWindow>();

  setHistory(shopId: string, history: VerifiedHistory): void {
    if (shopId !== history.shopId) throw new Error('Fake subscription tenant mismatch');
    this.histories.set(shopId, structuredClone(history));
  }
  setWindow(shopId: string, window: VerifiedSubmissionWindow): void {
    if (shopId !== window.shopId) throw new Error('Fake window tenant mismatch');
    this.windows.set(shopId, structuredClone(window));
  }
  async readCurrent(shopId: string): Promise<VerifiedHistory> {
    const history = this.histories.get(shopId);
    if (!history) throw new Error('Synthetic current subscription unavailable');
    return structuredClone(history);
  }
  async readAt(shopId: string, _firstFullyPaidAt: string): Promise<VerifiedHistory> {
    return this.readCurrent(shopId);
  }
  async readSubmissionWindow(shopId: string): Promise<VerifiedSubmissionWindow> {
    const window = this.windows.get(shopId);
    if (!window) throw new Error('Synthetic submission window unavailable');
    return structuredClone(window);
  }
}
