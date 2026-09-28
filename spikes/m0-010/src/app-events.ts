import type { AppEvent, TestPlan } from './index.ts';

/** A transport result. RECEIVED represents HTTP 202, never a billed charge. */
export type TransportKind = 'RECEIVED' | 'TIMEOUT' | 'CONFLICT' | 'RATE_LIMITED' |
  'SERVER_ERROR' | 'AUTH_ERROR' | 'VALIDATION_ERROR' | 'UNKNOWN_RESPONSE';
export type TransportResult = { kind: TransportKind; retryAfterMs?: number };

export interface AppEventsTransport {
  send(event: AppEvent): Promise<TransportResult>;
}

export interface FakeAggregate {
  source: 'FAKE_PROCESSED_AGGREGATE';
  appId: string;
  planHandle: string;
  shopId: string;
  cycleFrom: string;
  cycleUntil: string;
  quantity: number;
  mockCostCents: number;
  failedKeys: readonly string[];
}

/** Creates the documented 2026-07 body only; credential acquisition and HTTP are excluded. */
export function encodeAppEvent(event: AppEvent): { url: string; method: 'POST'; body: string } {
  if (!/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(event.shop_id) ||
      event.event_handle !== 'customized_order_paid' ||
      !Number.isFinite(Date.parse(event.timestamp)) ||
      new Date(event.timestamp).toISOString() !== event.timestamp ||
      event.attributes.value !== 1 || Object.keys(event.attributes).length !== 1)
    throw new Error('Invalid billing event');
  if (!/^[0-9a-f]{1,64}$/.test(event.idempotency_key)) throw new Error('Invalid idempotency key');
  return { url: 'https://api.shopify.com/app/2026-07/events', method: 'POST', body: JSON.stringify(event) };
}

/** Classifies transport only. Shopify validates billing asynchronously after HTTP 202. */
export function classifyAppEventResponse(
  status: number, body: unknown, retryAfter?: string, nowMs = Date.now()
): TransportResult {
  if (status === 202) {
    const parsed = body !== null && typeof body === 'object' ? body as Record<string, unknown> : null;
    return { kind: parsed?.success === true ? 'RECEIVED' : 'UNKNOWN_RESPONSE' };
  }
  if (status === 400) return { kind: 'VALIDATION_ERROR' };
  if (status === 401 || status === 403) return { kind: 'AUTH_ERROR' };
  if (status === 409) return { kind: 'CONFLICT' };
  if (status === 429) {
    let retryAfterMs: number | undefined;
    if (retryAfter && /^\d+$/.test(retryAfter)) retryAfterMs = Number(retryAfter) * 1_000;
    else if (retryAfter && Number.isFinite(Date.parse(retryAfter)))
      retryAfterMs = Math.max(0, Date.parse(retryAfter) - nowMs);
    return retryAfterMs === undefined || !Number.isSafeInteger(retryAfterMs)
      ? { kind: 'RATE_LIMITED' } : { kind: 'RATE_LIMITED', retryAfterMs };
  }
  if (status >= 500 && status <= 599) return { kind: 'SERVER_ERROR' };
  return { kind: 'UNKNOWN_RESPONSE' };
}

/** Local scripted transport. It never opens a network connection. */
export class FakeAppEvents implements AppEventsTransport {
  readonly attempts: AppEvent[] = [];
  readonly received = new Map<string, AppEvent>();
  private readonly script: Array<TransportKind | TransportResult | 'TIMEOUT_AFTER_RECEIPT'>;

  constructor(script: readonly (TransportKind | TransportResult | 'TIMEOUT_AFTER_RECEIPT')[] = []) {
    this.script = [...script];
  }

  async send(event: AppEvent): Promise<TransportResult> {
    encodeAppEvent(event);
    this.attempts.push(structuredClone(event));
    const scripted = this.script.shift() ?? 'RECEIVED';
    const result: TransportResult = typeof scripted === 'string'
      ? { kind: scripted === 'TIMEOUT_AFTER_RECEIPT' ? 'TIMEOUT' : scripted } : scripted;
    if (result.kind === 'RECEIVED' || scripted === 'TIMEOUT_AFTER_RECEIPT')
      this.received.set(event.idempotency_key, structuredClone(event));
    return result;
  }

  /** Simulates later billing processing. All cents are artificial fixture amounts. */
  processCycle(appId: string, shopId: string, cycleFrom: string, cycleUntil: string,
      plan: TestPlan): FakeAggregate {
    const from = Date.parse(cycleFrom), until = Date.parse(cycleUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until ||
        !Number.isSafeInteger(plan.includedOrders) || plan.includedOrders < 0 ||
        !Number.isSafeInteger(plan.mockOverageCents) || plan.mockOverageCents < 0)
      throw new Error('Invalid fake cycle or tariff');
    let quantity = 0;
    const failedKeys: string[] = [];
    for (const event of this.received.values()) {
      if (event.shop_id !== shopId) continue;
      const at = Date.parse(event.timestamp);
      if (at < from || at >= until) failedKeys.push(event.idempotency_key);
      else quantity += event.attributes.value;
    }
    const mockCostCents = Math.max(0, quantity - plan.includedOrders) * plan.mockOverageCents;
    if (!Number.isSafeInteger(mockCostCents)) throw new Error('Mock tariff overflow');
    return { source: 'FAKE_PROCESSED_AGGREGATE', appId, planHandle: plan.handle,
      shopId, cycleFrom, cycleUntil,
      quantity, mockCostCents, failedKeys };
  }
}
