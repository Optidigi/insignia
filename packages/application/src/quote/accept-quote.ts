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
export type QuoteArtworkChoice = { kind: 'revision' | 'deferred'; id: string };
export type QuoteArtworkStatus = QuoteArtworkChoice & {
  shopId: string;
  installationGeneration: string;
  status: 'usable' | 'unavailable';
  /** Last complete shop-local civil day before deletion/expiry, derived by the trusted artwork store. */
  lastFullyUsableLocalDay: number;
  observedAt: string;
};
export interface QuoteArtworkPort {
  readUsability(input: {
    shopId: string;
    installationGeneration: string;
    shopTimezone: string;
    choices: readonly QuoteArtworkChoice[];
  }): Promise<readonly QuoteArtworkStatus[]>;
}
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
export type AcceptedQuoteEconomics = Omit<ProposalEconomics, 'version' | 'groups' | 'lines'> & {
  version: 'm4-quote-economics-v1';
  groups: readonly (Omit<ProposalEconomics['groups'][number], 'canonicalIdentity'> & {
    canonicalIdentitySha256: string;
  })[];
  lines: readonly (Omit<ProposalEconomics['lines'][number], 'canonicalIdentity'> & {
    canonicalIdentitySha256: string;
  })[];
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
  physicalGroups: readonly {
    productId: string;
    configRevisionId: string;
    revisionContentHash: string;
    canonicalIdentitySha256: string;
    variants: readonly { variantId: string; quantity: number }[];
  }[];
  artworkChecks: readonly {
    choiceSha256: string;
    kind: QuoteArtworkChoice['kind'];
    lastFullyUsableLocalDay: number;
    observedAt: string;
  }[];
  effectiveRevisions: readonly {
    configId: string;
    operationId: string;
    productId: string;
    revisionId: string;
    contentHash: string;
  }[];
  catalogSnapshots: readonly CatalogVariantContextSnapshot[];
  fxSnapshot: CustomizationFxSnapshot | null;
  economics: AcceptedQuoteEconomics;
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
  artwork: QuoteArtworkPort;
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
  if (typeof value !== 'string' || value.length > 64) throw new Error('invalid desired Market ID');
  const numeric = value.startsWith('gid://shopify/Market/') ? value.slice('gid://shopify/Market/'.length) : value;
  if (!/^[1-9][0-9]*$/.test(numeric) || BigInt(numeric) > (1n << 64n) - 1n)
    throw new Error('invalid desired Market ID');
  return numeric;
}

// ISO 3166-1 alpha-2 snapshot: IANA tzdb iso3166.tab, whose country-code
// column cites ISO/TC 46 N1127 (2024-02-29). The source file SHA-256 is
// 837c80785080c8433fd9d4ea87e78f161ac7a40389301c5153d4f90198baeb2a.
// Keep this finite: Shopify's CountryCode transport is a context input, not
// a reason to admit reserved or unknown two-letter values into a signed quote.
const ISO_COUNTRIES = new Set(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ
BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR
CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ
MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF
PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR
TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/),
);

export function isIsoCountry(value: unknown): value is string {
  return typeof value === 'string' && ISO_COUNTRIES.has(value);
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

/** Bound hostile nested JSON before canonicalizing or reading any provider. */
function boundedRequestBytes(value: unknown): number {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if (++nodes > 4096 || entry.depth > 16)
      throw new Error('candidate request complexity exceeded before provider reads');
    const item = entry.value;
    if (typeof item === 'string') {
      if (item.length > 128_000) throw new Error('candidate request bytes exceeded before provider reads');
      bytes += Buffer.byteLength(item, 'utf8') + 2;
    } else if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('invalid candidate request number');
      bytes += 24;
    } else if (typeof item === 'object') {
      bytes += 2;
      if (Array.isArray(item)) {
        if (item.length > 4096) throw new Error('candidate request complexity exceeded before provider reads');
        for (const child of item) stack.push({ value: child, depth: entry.depth + 1 });
        bytes += item.length;
      } else {
        let keys = 0;
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          if (++keys > 64) throw new Error('candidate request complexity exceeded before provider reads');
          if (key.length > 128_000) throw new Error('candidate request bytes exceeded before provider reads');
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          stack.push({ value: (item as Record<string, unknown>)[key], depth: entry.depth + 1 });
        }
      }
    } else {
      throw new Error('invalid candidate request value');
    }
    if (bytes > 128_000) throw new Error('candidate request bytes exceeded before provider reads');
  }
  return bytes;
}

function identityDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keep the priced monetary breakdown and bucket order without retaining an artwork-linked identity. */
function acceptedEconomics(value: ProposalEconomics): AcceptedQuoteEconomics {
  return {
    ...value,
    version: 'm4-quote-economics-v1',
    groups: value.groups.map(({ canonicalIdentity, ...group }) => ({
      ...group,
      canonicalIdentitySha256: identityDigest(canonicalIdentity),
    })),
    lines: value.lines.map(({ canonicalIdentity, ...line }) => ({
      ...line,
      canonicalIdentitySha256: identityDigest(canonicalIdentity),
    })),
  };
}

function artworkChoices(groups: readonly CustomizationGroup[]): QuoteArtworkChoice[] {
  const choices = new Map<string, QuoteArtworkChoice>();
  for (const group of groups) {
    for (const placement of group.design.placements) {
      const { artwork } = placement;
      const id = artwork.kind === 'revision' ? artwork.revisionId : artwork.intentId;
      choices.set(`${artwork.kind}:${id}`, { kind: artwork.kind, id });
      if (choices.size > 256) throw new Error('artwork candidate capacity exceeded');
    }
  }
  return [...choices.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

async function usableArtwork(
  port: QuoteArtworkPort,
  request: QuoteRequest,
  timezone: string,
  choices: readonly QuoteArtworkChoice[],
  throughDay: number,
  now: Date,
): Promise<AcceptedQuote['artworkChecks']> {
  const result = await port.readUsability({
    shopId: request.shopId,
    installationGeneration: request.installationGeneration,
    shopTimezone: timezone,
    choices,
  });
  if (!Array.isArray(result) || result.length !== choices.length)
    throw new Error('complete artwork usability required');
  const checks: AcceptedQuote['artworkChecks'][number][] = [];
  for (const [index, choice] of choices.entries()) {
    const item = result[index];
    const observed = item && new Date(item.observedAt).getTime();
    if (
      !item ||
      item.shopId !== request.shopId ||
      item.installationGeneration !== request.installationGeneration ||
      item.kind !== choice.kind ||
      item.id !== choice.id ||
      item.status !== 'usable' ||
      !Number.isSafeInteger(item.lastFullyUsableLocalDay) ||
      item.lastFullyUsableLocalDay < throughDay ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.observedAt) ||
      !Number.isFinite(observed) ||
      observed > now.getTime() ||
      now.getTime() - observed > 5 * 60 * 1000
    )
      throw new Error('artwork unavailable through complete quote window');
    checks.push({
      choiceSha256: identityDigest(`${choice.kind}:${choice.id}`),
      kind: choice.kind,
      lastFullyUsableLocalDay: item.lastFullyUsableLocalDay,
      observedAt: item.observedAt,
    });
  }
  return checks;
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
    !isIsoCountry(request.country) ||
    !Array.isArray(request.groups) ||
    request.groups.length === 0
  )
    throw new Error('invalid quote request');
  if (
    request.groups.length > 32 ||
    !request.capacity ||
    !Number.isSafeInteger(request.capacity.ordinaryLineCount) ||
    request.capacity.ordinaryLineCount < 0 ||
    request.capacity.ordinaryLineCount > 200 ||
    !Number.isSafeInteger(request.capacity.inputBytes) ||
    request.capacity.inputBytes < 0 ||
    request.capacity.inputBytes > 128_000
  )
    throw new Error('candidate capacity exceeded before provider reads');
  let requestedVariants = 0;
  let requestedQuantity = 0;
  for (const entry of request.groups) {
    if (
      !entry?.group ||
      typeof entry.group.productId !== 'string' ||
      !Array.isArray(entry.group.variants) ||
      entry.group.variants.length === 0
    )
      throw new Error('invalid quote group');
    requestedVariants += entry.group.variants.length;
    if (requestedVariants > 32) throw new Error('candidate capacity exceeded before provider reads');
    for (const variant of entry.group.variants) {
      if (!variant || !Number.isSafeInteger(variant.quantity) || variant.quantity < 1)
        throw new Error('invalid quote physical quantity');
      requestedQuantity += variant.quantity;
    }
    if (requestedQuantity > 10000) throw new Error('candidate capacity exceeded before provider reads');
  }
  boundedRequestBytes(request);
  const marketId = normalizeMarketId(request.marketId);
  if (request.groups.some((entry) => entry.sellingPlanId !== undefined && entry.sellingPlanId !== null))
    throw new Error('paid customization with selling plan');
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
  const choices = artworkChoices(groups);
  const artworkChecks = await usableArtwork(
    ports.artwork,
    request,
    shop.timezone,
    choices,
    day.ordinal + 2,
    acceptedInstant,
  );
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
    physicalGroups: economics.groups.map((group) => ({
      productId: group.productId,
      configRevisionId: group.configRevisionId,
      revisionContentHash: group.revisionContentHash,
      canonicalIdentitySha256: identityDigest(group.canonicalIdentity),
      variants: group.variants.map((variant) => ({ variantId: variant.variantId, quantity: variant.quantity })),
    })),
    artworkChecks,
    effectiveRevisions: revisions.map(({ config, configId, operationId }) => ({
      configId,
      operationId,
      productId: config.productId,
      revisionId: config.revisionId,
      contentHash: config.revisionContentHash,
    })),
    catalogSnapshots,
    fxSnapshot,
    economics: acceptedEconomics(economics),
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
      await usableArtwork(ports.artwork, request, shop.timezone, choices, quote.validThroughDay, ports.clock());
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
      const finalTenant = requireTenant(
        await ports.tenant.getActive(request.shopId, request.installationGeneration),
        request,
      );
      if (
        finalTenant.authorizationGeneration !== tenant.authorizationGeneration ||
        finalTenant.authorizationEpoch !== tenant.authorizationEpoch
      )
        throw new Error('installation authorization identity changed');
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
