import { randomBytes } from 'node:crypto';
import type { AppEventsTransport, FakeAggregate, TransportResult } from './app-events.ts';
import { canonicalInstant } from './time.ts';
export { FakeAppEvents } from './app-events.ts';

/** Artificial fixtures. These handles, prices and features are not merchant offers. */
export interface TestPlan {
  handle: string;
  features: readonly string[];
  includedOrders: number;
  mockMonthlyCents: number;
  mockOverageCents: number;
}

export const TEST_PLANS: readonly TestPlan[] = [
  { handle: 'fixture_a', features: ['proof.alpha'], includedOrders: 2, mockMonthlyCents: 101, mockOverageCents: 17 },
  { handle: 'fixture_b', features: ['proof.alpha', 'proof.beta'], includedOrders: 4, mockMonthlyCents: 203, mockOverageCents: 13 },
  { handle: 'fixture_c', features: ['proof.alpha', 'proof.beta', 'proof.gamma'], includedOrders: 8, mockMonthlyCents: 307, mockOverageCents: 11 }
];

export type ContractState = 'ACTIVE' | 'FROZEN' | 'CANCELLED' | 'NONE';
export interface ContractInterval {
  from: string;
  until: string | null;
  state: ContractState;
  planHandle?: string;
  evidenceId?: string;
  trial: { from: string; until: string } | null;
}

/** A normalized, identity-checked Partner API observation, not raw redirect data. */
export interface VerifiedHistory {
  source: 'PARTNER_API_2026_07';
  appId: string;
  shopId: string;
  observedAt: string;
  completeFrom: string;
  completeThrough: string;
  intervals: readonly ContractInterval[];
}

/** Input from a purchase/payment verifier outside this scoped spike. */
export interface VerifiedPurchase {
  source: 'VERIFIED_PURCHASE_FACT';
  appId: string;
  shopId: string;
  orderId: string;
  installationGeneration: string;
  firstFullyPaidAt: string;
  fullyPaid: boolean;
  shopifyTest: boolean;
  verifiedCustomizationGroups: number;
  customizedQuantity: number;
}

export interface VerifiedPostPaymentLifecycle {
  source: 'VERIFIED_POST_PAYMENT_LIFECYCLE';
  appId: string;
  shopId: string;
  orderId: string;
  kind: 'REFUNDED' | 'CANCELLED' | 'RESTOCKED';
}

export type Qualification = 'BILLABLE' | 'WAIVED_TRIAL' | 'UNBILLABLE_INACTIVE' | 'PENDING_HISTORY';
export interface UsageFact {
  key: string;
  shopId: string;
  orderId: string;
  eventKind: 'customized_order_paid';
  firstFullyPaidAt: string;
  installationGeneration: string;
  qualification: Qualification;
  planHandle: string | null;
}

export interface AppEvent {
  shop_id: string;
  event_handle: 'customized_order_paid';
  timestamp: string;
  idempotency_key: string;
  attributes: { value: 1 };
}

export type DeliveryState = 'PENDING' | 'TRANSPORT_ACCEPTED' | 'RECONCILIATION_REQUIRED' | 'OPERATOR_VERIFIED';
export interface OutboxRecord {
  factKey: string;
  event: AppEvent;
  state: DeliveryState;
  attempts: number;
  lastDisposition: string | null;
  nextAttemptAt: string | null;
}

export interface VerifiedSubmissionWindow {
  source: 'PARTNER_API_2026_07';
  appId: string;
  shopId: string;
  observedAt: string;
  cycleFrom: string;
  cycleUntil: string;
}

export interface LocalSnapshot {
  version: 1;
  appId: string;
  facts: UsageFact[];
  outbox: OutboxRecord[];
}

export type QualificationResult = { kind: Qualification | 'IGNORED'; fact?: UsageFact };

function instant(value: string): number {
  const canonical = canonicalInstant(value);
  if (!canonical) throw new Error('Invalid exact instant');
  return Date.parse(canonical);
}

function localKey(shopId: string, orderId: string): string {
  return JSON.stringify([shopId, orderId, 'customized_order_paid']);
}

export class BillingProof {
  private readonly plans: ReadonlyMap<string, TestPlan>;
  private readonly expectedAppId: string;
  private readonly keyFactory: () => string;
  private readonly factMap = new Map<string, UsageFact>();
  private readonly outboxMap = new Map<string, OutboxRecord>();
  private readonly dispatching = new Set<string>();

  constructor(plans: readonly TestPlan[], expectedAppId: string,
      keyFactory: () => string = () => randomBytes(32).toString('hex')) {
    this.plans = new Map(plans.map(plan => [plan.handle, plan]));
    this.expectedAppId = expectedAppId;
    this.keyFactory = keyFactory;
    if (this.plans.size !== plans.length || plans.some(plan =>
      !plan.handle || plan.features.length === 0 || new Set(plan.features).size !== plan.features.length ||
      !Number.isSafeInteger(plan.includedOrders) || plan.includedOrders < 0 ||
      !Number.isSafeInteger(plan.mockMonthlyCents) || plan.mockMonthlyCents < 0 ||
      !Number.isSafeInteger(plan.mockOverageCents) || plan.mockOverageCents < 0))
      throw new Error('Invalid test plan catalogue');
  }

  facts(): UsageFact[] { return structuredClone([...this.factMap.values()]); }
  outbox(): OutboxRecord[] { return structuredClone([...this.outboxMap.values()]); }
  recordPendingPurchase(purchase: VerifiedPurchase): QualificationResult {
    if (purchase.source !== 'VERIFIED_PURCHASE_FACT' ||
        purchase.appId !== this.expectedAppId ||
        !purchase.installationGeneration ||
        !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(purchase.shopId) ||
        !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(purchase.orderId))
      throw new Error('Unverified purchase identity');
    if (!purchase.fullyPaid || purchase.shopifyTest ||
        !Number.isSafeInteger(purchase.verifiedCustomizationGroups) || purchase.verifiedCustomizationGroups < 1 ||
        !Number.isSafeInteger(purchase.customizedQuantity) || purchase.customizedQuantity < 1)
      return { kind: 'IGNORED' };
    const firstPaid = canonicalInstant(purchase.firstFullyPaidAt);
    if (!firstPaid) throw new Error('Invalid first-paid instant');
    const key = localKey(purchase.shopId, purchase.orderId);
    const existing = this.factMap.get(key);
    if (existing) {
      if (existing.firstFullyPaidAt !== firstPaid) throw new Error('First-paid instant changed');
      return { kind: existing.qualification, fact: structuredClone(existing) };
    }
    const fact: UsageFact = {
      key, shopId: purchase.shopId, orderId: purchase.orderId,
      eventKind: 'customized_order_paid', firstFullyPaidAt: firstPaid,
      installationGeneration: purchase.installationGeneration,
      qualification: 'PENDING_HISTORY', planHandle: null
    };
    this.factMap.set(key, fact);
    return { kind: 'PENDING_HISTORY', fact: structuredClone(fact) };
  }
  exportSnapshot(): LocalSnapshot {
    return { version: 1, appId: this.expectedAppId, facts: this.facts(), outbox: this.outbox() };
  }

  /** Later buyer lifecycle changes cannot reverse a first-paid usage fact. */
  observePostPaymentLifecycle(event: VerifiedPostPaymentLifecycle): UsageFact | null {
    if (event.source !== 'VERIFIED_POST_PAYMENT_LIFECYCLE' ||
        event.appId !== this.expectedAppId ||
        !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(event.shopId) ||
        !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(event.orderId) ||
        !['REFUNDED', 'CANCELLED', 'RESTOCKED'].includes(event.kind))
      throw new Error('Unverified lifecycle identity');
    const fact = this.factMap.get(localKey(event.shopId, event.orderId));
    return fact ? structuredClone(fact) : null;
  }

  static resume(plans: readonly TestPlan[], expectedAppId: string, snapshot: LocalSnapshot): BillingProof {
    if (snapshot.version !== 1 || snapshot.appId !== expectedAppId) throw new Error('Snapshot app/version mismatch');
    const proof = new BillingProof(plans, expectedAppId);
    for (const fact of snapshot.facts) {
      if (fact.key !== localKey(fact.shopId, fact.orderId) ||
          proof.factMap.has(fact.key) || fact.eventKind !== 'customized_order_paid')
        throw new Error('Invalid or duplicate usage fact');
      if (canonicalInstant(fact.firstFullyPaidAt) !== fact.firstFullyPaidAt)
        throw new Error('Invalid stored first-paid instant');
      proof.factMap.set(fact.key, structuredClone(fact));
    }
    const providerKeys = new Set<string>();
    for (const delivery of snapshot.outbox) {
      const fact = proof.factMap.get(delivery.factKey);
      if (!fact || fact.qualification !== 'BILLABLE' || proof.outboxMap.has(delivery.factKey) ||
          delivery.event.shop_id !== fact.shopId || delivery.event.timestamp !== fact.firstFullyPaidAt ||
          delivery.event.event_handle !== 'customized_order_paid' ||
          !/^[0-9a-f]{64}$/.test(delivery.event.idempotency_key) ||
          providerKeys.has(delivery.event.idempotency_key) || delivery.event.attributes.value !== 1 ||
          !Number.isSafeInteger(delivery.attempts) || delivery.attempts < 0 ||
          (delivery.nextAttemptAt !== null && !Number.isFinite(Date.parse(delivery.nextAttemptAt))))
        throw new Error('Invalid or duplicate outbox');
      proof.outboxMap.set(delivery.factKey, structuredClone(delivery));
      providerKeys.add(delivery.event.idempotency_key);
    }
    for (const fact of proof.factMap.values()) {
      if (fact.qualification === 'BILLABLE' && !proof.outboxMap.has(fact.key))
        throw new Error('Billable fact missing outbox');
    }
    return proof;
  }

  decideNewAction(history: VerifiedHistory, shopId: string, feature: string, now: string):
      'ALLOW' | 'DENY_FEATURE' | 'DENY_INACTIVE' | 'PENDING_VERIFY' {
    const at = instant(now);
    const observed = instant(history.observedAt);
    if (history.source !== 'PARTNER_API_2026_07' || history.appId !== this.expectedAppId ||
        history.shopId !== shopId || at < observed || at - observed > 5 * 60_000 ||
        instant(history.completeThrough) !== observed) return 'PENDING_VERIFY';
    const interval = this.findInterval(history, observed);
    if (!interval || !interval.evidenceId ||
        (interval.until !== null && at >= instant(interval.until))) return 'PENDING_VERIFY';
    if (interval.state !== 'ACTIVE') return 'DENY_INACTIVE';
    if (!interval.planHandle) return 'PENDING_VERIFY';
    const plan = this.plans.get(interval.planHandle);
    if (!plan) return 'PENDING_VERIFY';
    return plan.features.includes(feature) ? 'ALLOW' : 'DENY_FEATURE';
  }

  /** Existing signed offers and retained purchases are checked by their own subsystems. */
  billingEffectOnExistingOffer(): 'NONE' { return 'NONE'; }
  billingEffectOnHistoricalPurchase(): 'NONE' { return 'NONE'; }

  reconcileAggregate(observation: FakeAggregate):
      'AGGREGATE_MATCH_ONLY' | 'REVIEW_REQUIRED' | 'INCOMPLETE_LOCAL_DELIVERY' {
    if (observation.source !== 'FAKE_PROCESSED_AGGREGATE' ||
        observation.appId !== this.expectedAppId ||
        !Number.isSafeInteger(observation.quantity) || observation.quantity < 0 ||
        !Number.isSafeInteger(observation.mockCostCents) || observation.mockCostCents < 0 ||
        instant(observation.cycleFrom) >= instant(observation.cycleUntil)) return 'REVIEW_REQUIRED';
    const rows = [...this.outboxMap.values()].filter(row =>
      row.event.shop_id === observation.shopId &&
      instant(row.event.timestamp) >= instant(observation.cycleFrom) &&
      instant(row.event.timestamp) < instant(observation.cycleUntil));
    if (rows.length === 0 || rows.some(row => row.state === 'RECONCILIATION_REQUIRED'))
      return 'REVIEW_REQUIRED';
    if (rows.some(row => row.state === 'PENDING')) return 'INCOMPLETE_LOCAL_DELIVERY';
    const accepted = rows.filter(row => row.state === 'TRANSPORT_ACCEPTED' ||
      row.state === 'OPERATOR_VERIFIED').length;
    const plan = this.plans.get(observation.planHandle);
    if (!plan || rows.some(row => this.factMap.get(row.factKey)?.planHandle !== plan.handle))
      return 'REVIEW_REQUIRED';
    const expectedCost = Math.max(0, accepted - plan.includedOrders) * plan.mockOverageCents;
    return Number.isSafeInteger(expectedCost) && accepted === observation.quantity &&
      observation.mockCostCents === expectedCost && observation.failedKeys.length === 0
      ? 'AGGREGATE_MATCH_ONLY' : 'REVIEW_REQUIRED';
  }

  async dispatchNext(transport: AppEventsTransport, window: VerifiedSubmissionWindow, now: string,
      shopFilter?: string):
      Promise<'NO_PENDING' | 'NOT_DUE' | 'RETRY_SCHEDULED' | 'TRANSPORT_ACCEPTED' | 'RECONCILIATION_REQUIRED'> {
    const current = instant(now);
    const pending = [...this.outboxMap.values()].filter(row =>
      row.state === 'PENDING' && !this.dispatching.has(row.factKey) &&
      (shopFilter === undefined || row.event.shop_id === shopFilter));
    if (pending.length === 0) return 'NO_PENDING';
    const delivery = pending.find(row => !row.nextAttemptAt || current >= instant(row.nextAttemptAt));
    if (!delivery) return 'NOT_DUE';
    const occurrence = instant(delivery.event.timestamp);
    if (occurrence > current + 5 * 60_000) {
      delivery.nextAttemptAt = new Date(occurrence - 5 * 60_000).toISOString();
      return 'NOT_DUE';
    }
    if (window.source !== 'PARTNER_API_2026_07' || window.appId !== this.expectedAppId ||
        window.shopId !== delivery.event.shop_id ||
        current < instant(window.observedAt) || current - instant(window.observedAt) > 5 * 60_000 ||
        occurrence < instant(window.cycleFrom) || occurrence >= instant(window.cycleUntil)) {
      delivery.state = 'RECONCILIATION_REQUIRED';
      delivery.lastDisposition = 'UNKNOWN_OR_CLOSED_PROVIDER_WINDOW';
      return 'RECONCILIATION_REQUIRED';
    }
    let result: TransportResult;
    this.dispatching.add(delivery.factKey);
    try {
      try { result = await transport.send(structuredClone(delivery.event)); }
      catch { result = { kind: 'TIMEOUT' }; }
    } finally {
      this.dispatching.delete(delivery.factKey);
    }
    delivery.attempts += 1;
    delivery.lastDisposition = result.kind;
    if (result.kind === 'RECEIVED') {
      delivery.state = 'TRANSPORT_ACCEPTED';
      delivery.nextAttemptAt = null;
      return 'TRANSPORT_ACCEPTED';
    }
    if (result.kind === 'AUTH_ERROR' || result.kind === 'VALIDATION_ERROR' ||
        result.kind === 'UNKNOWN_RESPONSE' || delivery.attempts >= 12) {
      delivery.state = 'RECONCILIATION_REQUIRED';
      delivery.nextAttemptAt = null;
      return 'RECONCILIATION_REQUIRED';
    }
    const delayMs = Math.max(Math.min(15 * 60_000, 5_000 * 2 ** (delivery.attempts - 1)),
      result.retryAfterMs ?? 0);
    delivery.nextAttemptAt = new Date(current + delayMs).toISOString();
    return 'RETRY_SCHEDULED';
  }

  recordPaid(purchase: VerifiedPurchase, history: VerifiedHistory): QualificationResult {
    if (purchase.source !== 'VERIFIED_PURCHASE_FACT') throw new Error('Unverified purchase');
    if (!purchase.fullyPaid || purchase.shopifyTest ||
        !Number.isSafeInteger(purchase.verifiedCustomizationGroups) || purchase.verifiedCustomizationGroups < 1 ||
        !Number.isSafeInteger(purchase.customizedQuantity) || purchase.customizedQuantity < 1)
      return { kind: 'IGNORED' };
    if (!/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(purchase.shopId) ||
        !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(purchase.orderId) ||
        purchase.appId !== this.expectedAppId || !purchase.installationGeneration ||
        purchase.shopId !== history.shopId || history.appId !== this.expectedAppId ||
        history.source !== 'PARTNER_API_2026_07')
      throw new Error('Purchase/history tenant mismatch');
    const firstPaid = canonicalInstant(purchase.firstFullyPaidAt);
    if (!firstPaid) throw new Error('Invalid first-paid instant');
    const at = instant(firstPaid);
    const key = localKey(purchase.shopId, purchase.orderId);
    const existing = this.factMap.get(key);
    if (existing && existing.firstFullyPaidAt !== firstPaid)
      throw new Error('First-paid instant changed');
    if (existing && existing.qualification !== 'PENDING_HISTORY')
      return { kind: existing.qualification, fact: structuredClone(existing) };

    const interval = this.findInterval(history, at);
    let qualification: Qualification = 'PENDING_HISTORY';
    let planHandle: string | null = null;
    if (interval) {
      planHandle = interval.planHandle ?? null;
      if (interval.state !== 'ACTIVE') qualification = interval.evidenceId
        ? 'UNBILLABLE_INACTIVE' : 'PENDING_HISTORY';
      else if (!interval.evidenceId || !planHandle || !this.plans.has(planHandle)) qualification = 'PENDING_HISTORY';
      else if (interval.trial && at >= instant(interval.trial.from) && at < instant(interval.trial.until))
        qualification = 'WAIVED_TRIAL';
      else qualification = 'BILLABLE';
    }

    const fact: UsageFact = existing ? { ...existing, qualification, planHandle } : {
      key, shopId: purchase.shopId, orderId: purchase.orderId,
      eventKind: 'customized_order_paid', firstFullyPaidAt: firstPaid,
      installationGeneration: purchase.installationGeneration, qualification, planHandle
    };
    let delivery: OutboxRecord | null = null;
    if (qualification === 'BILLABLE' && !this.outboxMap.has(key)) {
      const idempotencyKey = this.keyFactory();
      if (!/^[0-9a-f]{64}$/.test(idempotencyKey) ||
          [...this.outboxMap.values()].some(row => row.event.idempotency_key === idempotencyKey))
        throw new Error('Invalid or duplicate provider idempotency key');
      delivery = {
        factKey: key,
        event: {
          shop_id: purchase.shopId, event_handle: 'customized_order_paid',
          timestamp: fact.firstFullyPaidAt,
          idempotency_key: idempotencyKey, attributes: { value: 1 }
        },
        state: 'PENDING', attempts: 0, lastDisposition: null, nextAttemptAt: null
      };
    }
    // All fallible preparation is complete; local insertion has no await between records.
    this.factMap.set(key, fact);
    if (delivery) this.outboxMap.set(key, delivery);
    return { kind: qualification, fact: structuredClone(fact) };
  }

  private findInterval(history: VerifiedHistory, at: number): ContractInterval | undefined {
    if (at < instant(history.completeFrom) || at > instant(history.completeThrough) ||
        instant(history.completeThrough) > instant(history.observedAt)) return undefined;
    const matching = history.intervals.filter(period =>
      at >= instant(period.from) && (period.until === null || at < instant(period.until)));
    return matching.length === 1 ? matching[0] : undefined;
  }
}
