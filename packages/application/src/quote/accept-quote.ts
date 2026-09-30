import { createHash } from 'node:crypto';
import {
  CURRENCY_RESOLUTION_VERSION,
  type CustomizationGroup,
  FX_RESOLUTION_VERSION,
  type FxResolution,
  type ProposalEconomics,
  type PublishedConfig,
  parseMinor,
  priceProposal,
  ROUNDING_POLICY_VERSION,
} from '@insignia/domain';
import {
  type CatalogContextPort,
  type CatalogVariantContextSnapshot,
  resolveFreshCatalogContext,
} from '../pricing/catalog-context.js';
import {
  type CustomizationFxProvider,
  type CustomizationFxSnapshot,
  requireUsableCustomizationFx,
} from '../pricing/customization-fx.js';

export type ActiveQuoteTenant = {
  shopId: string;
  installationGeneration: string;
  shopifyShopGid: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
};
export type ShopQuoteContext = {
  shopId: string;
  installationGeneration: string;
  shopifyShopGid: string;
  currency: string;
  timezone: string;
};
export type EffectiveQuoteRevision = { config: PublishedConfig; configId: string; operationId: string };
export type QuoteEntitlement = {
  active: boolean;
  freshness: 'fresh' | 'stale' | 'missing';
  recognizedPolicyId: string | null;
  policyVersion: string;
  trial: boolean;
  qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME' | 'WAIVE_TRIAL' | 'DENY';
};
export type QuoteRequest = {
  shopId: string;
  installationGeneration: string;
  idempotencyKey: string;
  country: string;
  marketId: string;
  groups: readonly { group: CustomizationGroup; sellingPlanId?: string | null }[];
  capacity: { ordinaryLineCount: number; inputBytes: number };
};
export type AcceptedQuote = {
  schemaVersion: 'm4-accepted-quote-v1';
  quoteId: string;
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  acceptedAt: string;
  acceptedDate: string;
  acceptedDay: number;
  validThroughDay: number;
  country: string;
  marketId: string;
  shopCurrency: string;
  shopTimezone: string;
  presentmentCurrency: string;
  presentmentExponent: number;
  policyVersion: string;
  recognizedPolicyId: string;
  trial: boolean;
  qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME' | 'WAIVE_TRIAL';
  desiredGroups: readonly CustomizationGroup[];
  effectiveRevisions: readonly {
    configId: string;
    operationId: string;
    productId: string;
    revisionId: string;
    contentHash: string;
  }[];
  catalogSnapshots: readonly CatalogVariantContextSnapshot[];
  fxSnapshot: CustomizationFxSnapshot | null;
  economics: ProposalEconomics;
};
export type QuoteAuthorizationSet = {
  setId: string;
  keyId: string;
  publicKeyFingerprint: string;
  /** Signer key validity, covering the fixed offer window. */
  firstValidDay: number;
  lastValidDay: number;
  validThroughDay: number;
  envelopeCarrier: string;
  members: readonly { lineIndex: number; carrier: string }[];
};
export type AcceptedQuoteResult = { quote: AcceptedQuote; authorization: QuoteAuthorizationSet };

/** The store serializes the command, locks the active installation and effective revisions,
 * then calls commit in the same transaction. It atomically stores both returned records. */
export interface QuoteAcceptanceStore {
  findCompleted(input: {
    shopId: string;
    installationGeneration: string;
    authorizationGeneration: string;
    authorizationEpoch: number;
    idempotencyKey: string;
    requestDigest: string;
  }): Promise<AcceptedQuoteResult | null>;
  accept(
    input: {
      shopId: string;
      installationGeneration: string;
      authorizationGeneration: string;
      authorizationEpoch: number;
      idempotencyKey: string;
      requestDigest: string;
      effectiveRevisions: AcceptedQuote['effectiveRevisions'];
    },
    commit: () => Promise<AcceptedQuoteResult>,
  ): Promise<AcceptedQuoteResult>;
}

/** Inject the production whole-quote package here during integration. It receives the complete
 * M2 economics, performs candidate admission, and emits exact protocol carriers. */
export interface CartAuthorizationPort {
  admit(input: { economics: ProposalEconomics; capacity: QuoteRequest['capacity'] }): void;
  issue(input: { quote: AcceptedQuote }): Promise<QuoteAuthorizationSet>;
}

export interface QuoteAuthorityPorts {
  clock(): Date;
  ids: { quoteId(): string };
  tenant: { getActive(shopId: string, installationGeneration: string): Promise<ActiveQuoteTenant | null> };
  shop: { getContext(tenant: ActiveQuoteTenant): Promise<ShopQuoteContext> };
  entitlement: { getFresh(tenant: ActiveQuoteTenant): Promise<QuoteEntitlement> };
  publication: { getEffective(shopId: string, productId: string): Promise<EffectiveQuoteRevision | null> };
  catalog: CatalogContextPort;
  currency: { exponent(code: string): number | null };
  fx: CustomizationFxProvider;
  authorization: CartAuthorizationPort;
  store: QuoteAcceptanceStore;
}

function requireTenant(value: ActiveQuoteTenant | null, request: QuoteRequest): ActiveQuoteTenant {
  if (
    !value ||
    value.shopId !== request.shopId ||
    value.installationGeneration !== request.installationGeneration ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(value.shopifyShopGid) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.authorizationGeneration) ||
    !Number.isInteger(value.authorizationEpoch) ||
    value.authorizationEpoch < 0 ||
    value.authorizationEpoch > 0xffffffff
  )
    throw new Error('inactive tenant or installation');
  return value;
}

function requireEntitlement(value: QuoteEntitlement): asserts value is QuoteEntitlement & {
  recognizedPolicyId: string;
  qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME' | 'WAIVE_TRIAL';
} {
  if (
    !value.active ||
    value.freshness !== 'fresh' ||
    !value.recognizedPolicyId ||
    !value.policyVersion ||
    value.qualifyingUsageDisposition === 'DENY'
  )
    throw new Error('fresh recognized entitlement required');
}

export function normalizeMarketId(value: string): string {
  const numeric = value.startsWith('gid://shopify/Market/') ? value.slice('gid://shopify/Market/'.length) : value;
  if (!/^[1-9][0-9]*$/.test(numeric) || BigInt(numeric) > (1n << 64n) - 1n)
    throw new Error('invalid desired Market ID');
  return numeric;
}

/** Civil day ordinal is independent of server timezone and elapsed 24-hour periods. */
export function localDay(instant: Date, timezone: string): { date: string; ordinal: number } {
  if (!Number.isFinite(instant.getTime())) throw new Error('invalid acceptance instant');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (part: string) => parts.find((value) => value.type === part)?.value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day))
    throw new Error('invalid shop timezone');
  return {
    date: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    ordinal: Math.floor(Date.UTC(year, month - 1, day) / 86400000),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function validAuthorization(quote: AcceptedQuote, set: QuoteAuthorizationSet): void {
  if (
    !set.setId ||
    !set.keyId ||
    !set.publicKeyFingerprint ||
    !set.envelopeCarrier ||
    set.firstValidDay > quote.acceptedDay ||
    set.lastValidDay < quote.validThroughDay ||
    set.validThroughDay !== quote.validThroughDay ||
    !Number.isInteger(set.firstValidDay) ||
    !Number.isInteger(set.lastValidDay) ||
    set.members.length !== quote.economics.lines.length ||
    set.members.some((member, index) => member.lineIndex !== index || !member.carrier)
  )
    throw new Error('incomplete or invalid whole-quote authorization');
}

export async function acceptQuote(request: QuoteRequest, ports: QuoteAuthorityPorts): Promise<AcceptedQuoteResult> {
  if (
    !request.shopId ||
    !/^[1-9][0-9]*$/.test(request.installationGeneration) ||
    !request.idempotencyKey ||
    request.idempotencyKey.length > 128 ||
    !/^[A-Z]{2}$/.test(request.country) ||
    !Array.isArray(request.groups) ||
    request.groups.length === 0
  )
    throw new Error('invalid quote request');
  const marketId = normalizeMarketId(request.marketId);
  if (request.groups.some((entry) => entry.sellingPlanId)) throw new Error('paid customization with selling plan');
  const requestDigest = createHash('sha256')
    .update(canonical({ ...request, marketId }))
    .digest('hex');
  const tenant = requireTenant(await ports.tenant.getActive(request.shopId, request.installationGeneration), request);
  const completed = await ports.store.findCompleted({
    shopId: request.shopId,
    installationGeneration: request.installationGeneration,
    authorizationGeneration: tenant.authorizationGeneration,
    authorizationEpoch: tenant.authorizationEpoch,
    idempotencyKey: request.idempotencyKey,
    requestDigest,
  });
  if (completed) return completed;
  const entitlement = await ports.entitlement.getFresh(tenant);
  requireEntitlement(entitlement);
  const shop = await ports.shop.getContext(tenant);
  if (
    shop.shopId !== tenant.shopId ||
    shop.installationGeneration !== tenant.installationGeneration ||
    shop.shopifyShopGid !== tenant.shopifyShopGid ||
    !/^[A-Z]{3}$/.test(shop.currency)
  )
    throw new Error('shop context identity or currency mismatch');
  const groups = request.groups.map((entry) => entry.group);
  const products = [...new Set(groups.map((group) => group.productId))];
  const revisions: EffectiveQuoteRevision[] = [];
  for (const product of products) {
    const revision = await ports.publication.getEffective(request.shopId, product);
    if (
      !revision ||
      revision.config.shopId !== request.shopId ||
      revision.config.productId !== product ||
      !revision.configId ||
      !revision.operationId ||
      groups.some(
        (group) =>
          group.productId === product &&
          (group.configRevisionId !== revision.config.revisionId ||
            group.revisionContentHash !== revision.config.revisionContentHash),
      )
    )
      throw new Error('no effective published revision for requested product');
    revisions.push(revision);
  }
  const catalogSnapshots: CatalogVariantContextSnapshot[] = [];
  for (const product of products) {
    const variantIds = [
      ...new Set(
        groups
          .filter((group) => group.productId === product)
          .flatMap((group) => group.variants.map((variant: { variantId: string }) => variant.variantId)),
      ),
    ];
    catalogSnapshots.push(
      ...(await resolveFreshCatalogContext(
        ports.catalog,
        {
          shopId: request.shopId,
          installationGeneration: request.installationGeneration,
          productId: product,
          variantIds,
          context: { country: request.country },
        },
        ports.clock,
      )),
    );
  }
  const presentment = catalogSnapshots[0]?.currencyCode;
  if (!presentment || catalogSnapshots.some((snapshot) => snapshot.currencyCode !== presentment))
    throw new Error('mixed presentment currency');
  const exponent = ports.currency.exponent(presentment);
  const shopExponent = ports.currency.exponent(shop.currency);
  if (exponent === null || shopExponent === null || ![0, 2, 3].includes(exponent) || ![0, 2, 3].includes(shopExponent))
    throw new Error('unsupported currency exponent');
  if (revisions.some((revision) => revision.config.shopCurrency !== shop.currency))
    throw new Error('published shop currency mismatch');
  // Resolve FX only when at least one applicable source amount lacks a presentment override.
  const pricing = {
    shopId: request.shopId,
    groups,
    configs: revisions.map((entry) => entry.config),
    bases: catalogSnapshots.map((snapshot) => ({
      shopId: request.shopId,
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      currency: presentment,
      minor: parseMinor(snapshot.amount, exponent).toString(),
      contextId: `${request.country}:${marketId}:${snapshot.observedAt}:${snapshot.correlation.requestId ?? ''}`,
    })),
    currency: {
      version: CURRENCY_RESOLUTION_VERSION as typeof CURRENCY_RESOLUTION_VERSION,
      presentmentCurrency: presentment,
      exponents: { [presentment]: exponent, [shop.currency]: shopExponent },
    },
    effectiveAt: ports.clock().toISOString(),
    marketContext: `${request.country}:${marketId}`,
    roundingPolicy: ROUNDING_POLICY_VERSION as typeof ROUNDING_POLICY_VERSION,
  };
  let fxSnapshot: CustomizationFxSnapshot | null = null;
  let economics: ProposalEconomics;
  try {
    economics = priceProposal(pricing);
  } catch (error) {
    if (shop.currency === presentment || !(error instanceof Error) || !error.message.startsWith('missing FX for '))
      throw error;
    fxSnapshot = requireUsableCustomizationFx(
      await ports.fx.resolve({
        shopId: request.shopId,
        installationGeneration: request.installationGeneration,
        shopCurrency: shop.currency,
        presentmentCurrency: presentment,
      }),
      {
        shopId: request.shopId,
        installationGeneration: request.installationGeneration,
        shopCurrency: shop.currency,
        presentmentCurrency: presentment,
        now: ports.clock().toISOString(),
        maxAgeMs: 5 * 60 * 1000,
      },
    );
    const fx: FxResolution = {
      version: FX_RESOLUTION_VERSION,
      fromCurrency: shop.currency,
      toCurrency: presentment,
      rateDecimal: fxSnapshot.rateDecimal,
      sourceId: fxSnapshot.source,
      rateVersion: fxSnapshot.sourceVersion,
      asOf: new Date(fxSnapshot.effectiveAt).toISOString(),
      validUntil: new Date(fxSnapshot.expiresAt).toISOString(),
    };
    economics = priceProposal({ ...pricing, fx });
  }
  if (
    economics.lines.length > 32 ||
    economics.customizedQuantity > 10000 ||
    !Number.isSafeInteger(request.capacity.ordinaryLineCount) ||
    request.capacity.ordinaryLineCount < 0 ||
    !Number.isSafeInteger(request.capacity.inputBytes) ||
    request.capacity.inputBytes < 0 ||
    economics.lines.length + request.capacity.ordinaryLineCount > 200
  )
    throw new Error('candidate capacity exceeded');
  ports.authorization.admit({ economics, capacity: request.capacity });
  const acceptedInstant = ports.clock();
  const day = localDay(acceptedInstant, shop.timezone);
  const quote: AcceptedQuote = {
    schemaVersion: 'm4-accepted-quote-v1',
    quoteId: ports.ids.quoteId(),
    shopId: request.shopId,
    installationGeneration: request.installationGeneration,
    authorizationGeneration: tenant.authorizationGeneration,
    authorizationEpoch: tenant.authorizationEpoch,
    acceptedAt: acceptedInstant.toISOString(),
    acceptedDate: day.date,
    acceptedDay: day.ordinal,
    validThroughDay: day.ordinal + 2,
    country: request.country,
    marketId,
    shopCurrency: shop.currency,
    shopTimezone: shop.timezone,
    presentmentCurrency: presentment,
    presentmentExponent: exponent,
    policyVersion: entitlement.policyVersion,
    recognizedPolicyId: entitlement.recognizedPolicyId,
    trial: entitlement.trial,
    qualifyingUsageDisposition: entitlement.qualifyingUsageDisposition,
    desiredGroups: groups,
    effectiveRevisions: revisions.map(({ config, configId, operationId }) => ({
      configId,
      operationId,
      productId: config.productId,
      revisionId: config.revisionId,
      contentHash: config.revisionContentHash,
    })),
    catalogSnapshots,
    fxSnapshot,
    economics,
  };
  return ports.store.accept(
    {
      shopId: request.shopId,
      installationGeneration: request.installationGeneration,
      authorizationGeneration: tenant.authorizationGeneration,
      authorizationEpoch: tenant.authorizationEpoch,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      effectiveRevisions: quote.effectiveRevisions,
    },
    async () => {
      const current = requireTenant(
        await ports.tenant.getActive(request.shopId, request.installationGeneration),
        request,
      );
      if (
        current.authorizationGeneration !== tenant.authorizationGeneration ||
        current.authorizationEpoch !== tenant.authorizationEpoch
      )
        throw new Error('installation authorization identity changed');
      if (localDay(ports.clock(), shop.timezone).ordinal !== quote.acceptedDay)
        throw new Error('shop-local acceptance day changed before signing');
      const currentEntitlement = await ports.entitlement.getFresh(current);
      requireEntitlement(currentEntitlement);
      if (
        currentEntitlement.policyVersion !== entitlement.policyVersion ||
        currentEntitlement.recognizedPolicyId !== entitlement.recognizedPolicyId ||
        currentEntitlement.trial !== entitlement.trial ||
        currentEntitlement.qualifyingUsageDisposition !== entitlement.qualifyingUsageDisposition
      )
        throw new Error('entitlement changed during quote acceptance');
      for (const product of products) {
        const snapshots = catalogSnapshots.filter((snapshot) => snapshot.productId === product);
        await resolveFreshCatalogContext(
          { resolveVariantContext: async () => snapshots },
          {
            shopId: request.shopId,
            installationGeneration: request.installationGeneration,
            productId: product,
            variantIds: snapshots.map((snapshot) => snapshot.variantId),
            context: { country: request.country },
          },
          ports.clock,
        );
      }
      if (fxSnapshot)
        requireUsableCustomizationFx(fxSnapshot, {
          shopId: request.shopId,
          installationGeneration: request.installationGeneration,
          shopCurrency: shop.currency,
          presentmentCurrency: presentment,
          now: ports.clock().toISOString(),
          maxAgeMs: 5 * 60 * 1000,
        });
      const authorization = await ports.authorization.issue({ quote });
      validAuthorization(quote, authorization);
      return { quote, authorization };
    },
  );
}
