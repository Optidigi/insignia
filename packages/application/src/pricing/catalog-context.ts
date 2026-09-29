/** Application-facing catalog pricing authority, independent of provider transport. */
export type CatalogCountryContext = { country: string };

export type CatalogContextRequest = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  variantIds: readonly string[];
  context: CatalogCountryContext;
};

export type CatalogVariantContextSnapshot = {
  shopId: string;
  installationGeneration: string;
  productId: string;
  variantId: string;
  productIdVerified: true;
  context: CatalogCountryContext;
  /** Final contextual garment price, represented without binary floating point. */
  amount: string;
  currencyCode: string;
  sourceApiVersion: string;
  observedAt: string;
  freshUntil: string;
  correlation: { requestId: string | null };
};

export interface CatalogContextPort {
  resolveVariantContext(input: CatalogContextRequest): Promise<CatalogVariantContextSnapshot[]>;
}

export class CatalogContextUnavailable extends Error {
  constructor(readonly reason: 'missing' | 'stale' | 'wrong_identity' | 'invalid') {
    super(`Catalog context unavailable: ${reason}`);
    this.name = 'CatalogContextUnavailable';
  }
}

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_AGE_MS = 5 * 60 * 1000;

function instant(value: string): number {
  const date = Date.parse(value);
  if (!UTC.test(value) || !Number.isFinite(date) || new Date(date).toISOString() !== value)
    throw new CatalogContextUnavailable('invalid');
  return date;
}

/** Quote construction must use one complete, current observation for its exact target vector. */
export async function resolveFreshCatalogContext(
  port: CatalogContextPort,
  input: CatalogContextRequest,
  now: () => Date,
): Promise<CatalogVariantContextSnapshot[]> {
  if (
    !input.shopId ||
    !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
    !input.productId ||
    !/^[A-Z]{2}$/.test(input.context.country) ||
    !Array.isArray(input.variantIds) ||
    input.variantIds.length === 0 ||
    input.variantIds.length > 100 ||
    new Set(input.variantIds).size !== input.variantIds.length
  )
    throw new CatalogContextUnavailable('invalid');
  const snapshots = await port.resolveVariantContext(input);
  const current = now().getTime();
  if (!Number.isFinite(current)) throw new CatalogContextUnavailable('invalid');
  if (!Array.isArray(snapshots) || snapshots.length !== input.variantIds.length)
    throw new CatalogContextUnavailable('missing');
  const byId = new Map<string, CatalogVariantContextSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot || byId.has(snapshot.variantId)) throw new CatalogContextUnavailable('invalid');
    if (
      snapshot.shopId !== input.shopId ||
      snapshot.installationGeneration !== input.installationGeneration ||
      snapshot.productId !== input.productId ||
      snapshot.productIdVerified !== true ||
      snapshot.context.country !== input.context.country ||
      !input.variantIds.includes(snapshot.variantId)
    )
      throw new CatalogContextUnavailable('wrong_identity');
    if (
      !DECIMAL.test(snapshot.amount) ||
      snapshot.amount.length > 64 ||
      !/^[A-Z]{3}$/.test(snapshot.currencyCode) ||
      snapshot.sourceApiVersion !== '2026-07'
    )
      throw new CatalogContextUnavailable('invalid');
    const observed = instant(snapshot.observedAt);
    const freshUntil = instant(snapshot.freshUntil);
    if (observed > current || current >= freshUntil || freshUntil <= observed || freshUntil - observed > MAX_AGE_MS)
      throw new CatalogContextUnavailable('stale');
    byId.set(snapshot.variantId, snapshot);
  }
  return input.variantIds.map((id) => {
    const snapshot = byId.get(id);
    if (!snapshot) throw new CatalogContextUnavailable('missing');
    return snapshot;
  });
}
