/** A quote freezes this provider observation before M2 consumes its decimal rate. */
export interface CustomizationFxSnapshot {
  readonly version: 'm4-customization-fx-v1';
  readonly shopId: string;
  readonly installationGeneration: string;
  readonly shopCurrency: string;
  readonly presentmentCurrency: string;
  /** Presentment currency units per one shop currency unit; never a JS number. */
  readonly rateDecimal: string;
  readonly source: string;
  readonly sourceVersion: string;
  /** Provider's stable quote/rate identifier or digest for later audit. */
  readonly provenance: string;
  readonly observedAt: string;
  readonly effectiveAt: string;
  readonly expiresAt: string;
}

export interface CustomizationFxProvider {
  resolve(input: {
    shopId: string;
    installationGeneration: string;
    shopCurrency: string;
    presentmentCurrency: string;
  }): Promise<CustomizationFxSnapshot>;
}

export class CustomizationFxUnavailable extends Error {
  constructor(readonly reason: 'missing' | 'stale' | 'invalid' | 'wrong_identity') {
    super(`Customization FX unavailable: ${reason}`);
    this.name = 'CustomizationFxUnavailable';
  }
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function instant(value: string): number {
  if (!UTC.test(value)) throw new CustomizationFxUnavailable('invalid');
  const time = Date.parse(value);
  const canonical = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical)
    throw new CustomizationFxUnavailable('invalid');
  return time;
}

/** Call at quote construction. A cached rate cannot silently remain authoritative. */
export function requireUsableCustomizationFx(
  snapshot: CustomizationFxSnapshot | null,
  request: {
    shopId: string;
    installationGeneration: string;
    shopCurrency: string;
    presentmentCurrency: string;
    now: string;
    /** Caller-selected source policy; never trust provider expiry alone. */
    maxAgeMs: number;
  },
): CustomizationFxSnapshot {
  if (!snapshot) throw new CustomizationFxUnavailable('missing');
  if (!Number.isSafeInteger(request.maxAgeMs) || request.maxAgeMs <= 0 || request.maxAgeMs > 7 * 24 * 60 * 60 * 1000)
    throw new CustomizationFxUnavailable('invalid');
  if (
    snapshot.shopId !== request.shopId ||
    snapshot.installationGeneration !== request.installationGeneration ||
    snapshot.shopCurrency !== request.shopCurrency ||
    snapshot.presentmentCurrency !== request.presentmentCurrency
  )
    throw new CustomizationFxUnavailable('wrong_identity');
  if (
    snapshot.version !== 'm4-customization-fx-v1' ||
    !/^[1-9][0-9]*$/.test(snapshot.installationGeneration) ||
    !CURRENCY.test(snapshot.shopCurrency) ||
    !CURRENCY.test(snapshot.presentmentCurrency) ||
    snapshot.shopCurrency === snapshot.presentmentCurrency ||
    !DECIMAL.test(snapshot.rateDecimal) ||
    !/[1-9]/.test(snapshot.rateDecimal) ||
    snapshot.rateDecimal.length > 128 ||
    !snapshot.source ||
    !snapshot.sourceVersion ||
    !snapshot.provenance ||
    snapshot.source.length > 128 ||
    snapshot.sourceVersion.length > 128 ||
    snapshot.provenance.length > 512
  )
    throw new CustomizationFxUnavailable('invalid');
  const now = instant(request.now);
  const observed = instant(snapshot.observedAt);
  const effective = instant(snapshot.effectiveAt);
  const expiry = instant(snapshot.expiresAt);
  if (
    observed > now ||
    effective > now ||
    now >= expiry ||
    observed > expiry ||
    effective > expiry ||
    now - effective > request.maxAgeMs
  )
    throw new CustomizationFxUnavailable('stale');
  return snapshot;
}
