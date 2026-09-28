/** Extracted from PR #14 source, not a complete checkout. Type-only wrappers differ. */
function instant(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)) return null;
  const n = Date.parse(s);
  return Number.isFinite(n) && new Date(n).toISOString() === s ? n : null;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function zero(value: unknown): boolean { return typeof value === 'string' && /^0(?:\.0{1,9})?$/.test(value); }
export class ExtractedGuard {
  ports: any;
  constructor(ports: any) { this.ports = ports; }
  allowed(event: any, activeResponse: unknown, observedAt: string): boolean {
    const p = this.ports, m = p.manifest;
    const now = instant(p.now());
    if (!m || !p.journal || !p.partner || !now || m.mode !== 'LIVE_ZERO_PRICE_TEST' ||
      m.appId !== p.appId || m.shopId !== p.shopId || m.shopId !== event.shop_id ||
      m.meterHandle !== event.event_handle || m.meterHandle !== 'customized_order_paid' ||
      m.zeroPrice !== true || m.appGidVerified !== true ||
      m.meterVerified !== true || m.installationVerified !== true ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(m.runId) || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.planHandle)) return false;
    const observed = instant(observedAt), approved = instant(m.approvedAt);
    const from = instant(m.cycleFrom), until = instant(m.cycleUntil), at = instant(event.timestamp);
    const baseline = instant(m.observedAt);
    if (baseline === null || observed === null || observed < baseline || approved === null || from === null || until === null || at === null ||
      observed > now || now - observed > 60_000 || now - baseline > 600_000 || approved > now ||
      from > now || now >= until || at < from || at >= until || at > now + 300_000) return false;
    const subscription = object(object(activeResponse)?.data)?.activeSubscription;
    const active = object(subscription), app = object(active?.app), shop = object(active?.shop);
    const cycle = object(active?.currentBillingCycle);
    if (!active || 'errors' in (object(activeResponse) ?? {}) ||
      app?.id !== p.appId || shop?.id !== p.shopId ||
      active.billingPeriod !== 'EVERY_30_DAYS' || active.cancelAtEndOfCycle !== false ||
      active.trialEndsAt !== null || active.pendingUpdate !== null ||
      cycle?.startTime !== m.cycleFrom || cycle?.endTime !== m.cycleUntil ||
      !Array.isArray(active.items) || active.items.length !== 2) return false;
    const [flat, meter] = active.items.map(object);
    const flatPrice = object(flat?.price), meterPrice = object(meter?.price);
    if (flat?.handle !== m.planHandle || flatPrice?.__typename !== 'FlatRatePrice' ||
      flatPrice.active !== true || !zero(flatPrice.amount) ||
      meter?.handle !== m.meterHandle || meterPrice?.__typename !== 'TieredPrice' ||
      meterPrice.active !== true || meterPrice.tiersMode !== 'GRADUATED' ||
      flatPrice.currency !== meterPrice.currency || typeof flatPrice.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(flatPrice.currency) || !Array.isArray(meterPrice.tiers) ||
      meterPrice.tiers.length !== 2) return false;
    const usage = object(meter?.usage), usageCost = object(usage?.cost);
    if (!usage || !Number.isSafeInteger(usage.quantity) || Number(usage.quantity) < 0 ||
      !usageCost || !zero(usageCost.amount) || usageCost.currencyCode !== flatPrice.currency)
      return false;
    const [first, second] = meterPrice.tiers.map(object);
    return !!first && !!second && Number.isSafeInteger(first.upTo) && Number(first.upTo) >= 1 &&
      second.upTo === null && [first.amount, first.amountPerUnit, second.amount,
        second.amountPerUnit].every(zero);
  }
}
