import type { ComponentAmount, PricingRule, PublishedConfig } from '../config/model.js';
import type { CustomizationGroup } from '../customization/identity.js';
import { canonicalCustomizationKey, normalizeCustomizationGroups } from '../customization/identity.js';
import {
  checkedMinor,
  parseMinor,
  parsePositiveDecimalRational,
  parseSignedMinor,
  roundHalfEven,
  U64_MAX,
} from '../money.js';

export const PRICING_ENGINE_VERSION = 'm2-pricing-v1' as const;
export const CURRENCY_RESOLUTION_VERSION = 'm2-currency-resolution-v1' as const;
export const FX_RESOLUTION_VERSION = 'm2-fx-resolution-v1' as const;
export const ROUNDING_POLICY_VERSION = 'm2-half-even-v1' as const;
// Known exponent assertions catch accidental mismatch. The versioned resolution
// is supplied by the application; its source and full ISO coverage are outside
// this pure pricing slice.
export const KNOWN_CURRENCY_EXPONENTS = Object.freeze({ EUR: 2, USD: 2, GBP: 2, JPY: 0, KWD: 3, BHD: 3 });

export interface CurrencyResolution {
  readonly version: typeof CURRENCY_RESOLUTION_VERSION;
  readonly presentmentCurrency: string;
  readonly exponents: Readonly<Record<string, number>>;
}

export interface FxResolution {
  readonly version: typeof FX_RESOLUTION_VERSION;
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rateDecimal: string;
  readonly sourceId: string;
  readonly rateVersion: string;
  readonly asOf: string;
  readonly validUntil: string;
}

export interface ContextualBase {
  readonly shopId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly currency: string;
  readonly minor: string;
  readonly contextId: string;
}

export interface PricingInput {
  readonly shopId: string;
  readonly groups: readonly CustomizationGroup[];
  readonly configs: readonly PublishedConfig[];
  readonly bases: readonly ContextualBase[];
  readonly currency: CurrencyResolution;
  readonly fx?: FxResolution;
  readonly effectiveAt: string;
  readonly marketContext: string;
  readonly roundingPolicy: typeof ROUNDING_POLICY_VERSION;
}

export interface ResolvedComponent {
  readonly ruleId: string;
  readonly applicabilityKey: string;
  readonly role: 'setup' | 'unit';
  readonly selectedMinQuantity: number | null;
  readonly multiplicity: number;
  readonly sourceDecimal: string;
  readonly resolvedMinor: string;
  readonly resolution: 'shop-currency' | 'override' | 'fx';
}

export interface PriceBucket {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitOrdinalStart: number;
  readonly unitOrdinalEnd: number;
  readonly setupPerUnitMinor: string;
  readonly unitPriceMinor: string;
  readonly lineTotalMinor: string;
}

export interface PricedVariant {
  readonly variantId: string;
  readonly quantity: number;
  readonly contextualBaseMinor: string;
  readonly contextId: string;
  readonly buckets: readonly PriceBucket[];
}

export interface PricedGroup {
  readonly canonicalIdentity: string;
  readonly shopId: string;
  readonly productId: string;
  readonly configRevisionId: string;
  readonly revisionContentHash: string;
  readonly quantity: number;
  readonly setupComponents: readonly ResolvedComponent[];
  readonly unitComponents: readonly ResolvedComponent[];
  readonly setupMinor: string;
  readonly customizationUnitMinor: string;
  readonly baseTotalMinor: string;
  readonly totalMinor: string;
  readonly variants: readonly PricedVariant[];
}

export interface ProposalEconomics {
  readonly version: 'm2-proposal-economics-v1';
  readonly shopId: string;
  readonly pricingEngineVersion: typeof PRICING_ENGINE_VERSION;
  readonly roundingPolicy: typeof ROUNDING_POLICY_VERSION;
  readonly currency: CurrencyResolution;
  readonly fx: FxResolution | null;
  readonly effectiveAt: string;
  readonly marketContext: string;
  readonly customizedQuantity: number;
  readonly totalMinor: string;
  readonly groups: readonly PricedGroup[];
  readonly lines: readonly (PriceBucket & {
    readonly lineIndex: number;
    readonly canonicalIdentity: string;
    readonly shopId: string;
    readonly productId: string;
    readonly configRevisionId: string;
    readonly revisionContentHash: string;
  })[];
}

function fail(message: string): never {
  throw new Error(message);
}
function nonempty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is required`);
}
function compareId(a: string, b: string): number {
  const ac = [...a];
  const bc = [...b];
  for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
    const delta = (ac[i]?.codePointAt(0) ?? 0) - (bc[i]?.codePointAt(0) ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return Math.sign(ac.length - bc.length);
}
function checkedQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail('physical quantity must be a positive safe integer');
  return value;
}
function safeQuantitySum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('physical quantity overflows safe integer');
  return result;
}
function exponentFor(resolution: CurrencyResolution, code: string): number {
  if (!/^[A-Z]{3}$/.test(code)) fail('invalid currency code');
  const value = resolution.exponents[code];
  const known = KNOWN_CURRENCY_EXPONENTS[code as keyof typeof KNOWN_CURRENCY_EXPONENTS];
  if (
    !Number.isInteger(value) ||
    value === undefined ||
    value < 0 ||
    value > 3 ||
    (known !== undefined && value !== known)
  )
    fail(`unsupported currency exponent: ${code}`);
  return value;
}
function validateCurrency(resolution: CurrencyResolution): void {
  if (resolution.version !== CURRENCY_RESOLUTION_VERSION) fail('unsupported currency resolution version');
  exponentFor(resolution, resolution.presentmentCurrency);
  for (const currency of Object.keys(resolution.exponents)) exponentFor(resolution, currency);
}
const FIXED_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
function validUtc(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = FIXED_UTC.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] ?? 0);
}
function validateFx(input: PricingInput): void {
  if (!validUtc(input.effectiveAt)) fail('effectiveAt must be valid fixed-width UTC');
  if (!input.fx) return;
  const fx = input.fx;
  if (fx.version !== FX_RESOLUTION_VERSION || fx.toCurrency !== input.currency.presentmentCurrency)
    fail('unsupported FX resolution or currency pair');
  nonempty(fx.sourceId, 'FX source');
  nonempty(fx.rateVersion, 'FX rate version');
  if (
    !validUtc(fx.asOf) ||
    !validUtc(fx.validUntil) ||
    fx.asOf > input.effectiveAt ||
    input.effectiveAt > fx.validUntil
  )
    fail('FX outside explicit validity window');
  parsePositiveDecimalRational(fx.rateDecimal);
  exponentFor(input.currency, fx.fromCurrency);
}
function ruleAmount(
  rule: PricingRule,
  quantity: number,
): { amount: ComponentAmount; selectedMinQuantity: number | null } {
  if (rule.rate.kind === 'fixed') return { amount: rule.rate.amount, selectedMinQuantity: null };
  if (rule.role === 'setup') fail('setup tiers are unsupported');
  const tiers = rule.rate.tiers;
  if (tiers.length === 0 || tiers[0]?.minQuantity !== 1) fail('tier schedule must start at one');
  let chosen = tiers[0];
  let previous = 0;
  for (const tier of tiers) {
    if (!Number.isSafeInteger(tier.minQuantity) || tier.minQuantity <= previous) fail('invalid tier schedule');
    previous = tier.minQuantity;
    if (tier.minQuantity <= quantity) chosen = tier;
  }
  if (!chosen) fail('missing tier');
  return { amount: chosen.amount, selectedMinQuantity: chosen.minQuantity };
}
function resolveAmount(
  amount: ComponentAmount,
  config: PublishedConfig,
  input: PricingInput,
  allowSigned: boolean,
): { minor: bigint; resolution: ResolvedComponent['resolution']; sourceDecimal: string } {
  const sourceExponent = exponentFor(input.currency, config.shopCurrency);
  const targetExponent = exponentFor(input.currency, input.currency.presentmentCurrency);
  const sourceMinor = allowSigned
    ? parseSignedMinor(amount.shopDecimal, sourceExponent)
    : parseMinor(amount.shopDecimal, sourceExponent);
  const overrides = amount.presentmentOverrides;
  const seen = new Set<string>();
  for (const override of overrides) {
    if (seen.has(override.currency)) fail('duplicate presentment override');
    seen.add(override.currency);
  }
  const override = overrides.find((candidate) => candidate.currency === input.currency.presentmentCurrency);
  if (override)
    return {
      minor: allowSigned
        ? parseSignedMinor(override.decimal, targetExponent)
        : parseMinor(override.decimal, targetExponent),
      resolution: 'override',
      sourceDecimal: override.decimal,
    };
  if (config.shopCurrency === input.currency.presentmentCurrency)
    return { minor: sourceMinor, resolution: 'shop-currency', sourceDecimal: amount.shopDecimal };
  const fx = input.fx;
  if (!fx || fx.fromCurrency !== config.shopCurrency)
    fail(`missing FX for ${config.shopCurrency} to ${input.currency.presentmentCurrency}`);
  const rate = parsePositiveDecimalRational(fx.rateDecimal);
  const scaled = sourceMinor * rate.numerator * 10n ** BigInt(targetExponent);
  const minor = roundHalfEven(scaled, rate.denominator * 10n ** BigInt(sourceExponent));
  if (!allowSigned) checkedMinor(minor);
  return { minor, resolution: 'fx', sourceDecimal: amount.shopDecimal };
}
function pickRule(
  config: PublishedConfig,
  role: PricingRule['role'],
  kind: PricingRule['scope']['kind'],
  placementId?: string,
  stepId?: string,
  methodId?: string,
): PricingRule | undefined {
  const matches = config.pricingRules.filter((rule) => {
    if (rule.role !== role || rule.scope.kind !== kind) return false;
    const scope = rule.scope;
    if (scope.kind === 'general') return true;
    if (scope.kind === 'method') return scope.methodId === methodId;
    if (scope.placementId !== placementId) return false;
    if (scope.kind === 'step' && scope.stepId !== stepId) return false;
    return scope.methodId === methodId;
  });
  if (matches.length > 1) fail('duplicate pricing scope');
  return matches[0];
}
function applicable(
  config: PublishedConfig,
  role: 'setup' | 'unit',
  placements: CustomizationGroup['design']['placements'],
): { rule: PricingRule; key: string; multiplicity: number }[] {
  const found: { rule: PricingRule; key: string; multiplicity: number }[] = [];
  const general = pickRule(config, role, 'general');
  if (general) found.push({ rule: general, key: 'general', multiplicity: 1 });
  const methods = [...new Set(placements.map((p) => p.methodId))].sort(compareId);
  for (const methodId of methods) {
    const rule = pickRule(config, role, 'method', undefined, undefined, methodId);
    if (rule) {
      const multiplicity =
        role === 'unit' && rule.methodUnitMultiplicity === 'perPlacement'
          ? placements.filter((p) => p.methodId === methodId).length
          : 1;
      found.push({ rule, key: `method:${methodId}`, multiplicity });
    }
  }
  for (const placement of placements) {
    for (const kind of ['placement', 'step'] as const) {
      const exact = pickRule(config, role, kind, placement.placementId, placement.stepId, placement.methodId);
      const inherited = pickRule(config, role, kind, placement.placementId, placement.stepId);
      const rule = exact ?? inherited;
      if (rule)
        found.push({
          rule,
          key:
            kind === 'step'
              ? `step:${placement.placementId}:${placement.stepId}`
              : `placement:${placement.placementId}`,
          multiplicity: 1,
        });
    }
  }
  return found;
}
function resolveComponents(
  config: PublishedConfig,
  role: 'setup' | 'unit',
  placements: CustomizationGroup['design']['placements'],
  quantity: number,
  input: PricingInput,
): { components: ResolvedComponent[]; minor: bigint } {
  const components: ResolvedComponent[] = [];
  let minor = 0n;
  for (const entry of applicable(config, role, placements)) {
    const { amount, selectedMinQuantity } = ruleAmount(entry.rule, quantity);
    const signed = role === 'unit' && (entry.rule.scope.kind === 'placement' || entry.rule.scope.kind === 'step');
    const resolved = resolveAmount(amount, config, input, signed);
    const value = resolved.minor * BigInt(entry.multiplicity);
    if (value > U64_MAX || value < -U64_MAX) fail('component amount overflows u64');
    minor += value;
    components.push({
      ruleId: entry.rule.id,
      applicabilityKey: entry.key,
      role,
      selectedMinQuantity,
      multiplicity: entry.multiplicity,
      sourceDecimal: resolved.sourceDecimal,
      resolvedMinor: value.toString(),
      resolution: resolved.resolution,
    });
  }
  if (minor < 0n) fail('negative aggregate customization amount');
  checkedMinor(minor);
  return { components, minor };
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function priceProposal(input: PricingInput): ProposalEconomics {
  if (input.roundingPolicy !== ROUNDING_POLICY_VERSION) fail('unsupported rounding policy');
  validateCurrency(input.currency);
  validateFx(input);
  nonempty(input.shopId, 'shop ID');
  nonempty(input.marketContext, 'market context');
  for (const config of input.configs) if (config.shopId !== input.shopId) fail('mixed-shop pricing input');
  for (const group of input.groups) if (group.shopId !== input.shopId) fail('mixed-shop pricing input');
  const normalized = normalizeCustomizationGroups([...input.groups], [...input.configs]);
  if (normalized.length === 0) fail('customized proposal must contain at least one group');
  const configMap = new Map<string, PublishedConfig>();
  for (const config of input.configs) {
    const key = `${config.productId}\u0000${config.revisionId}`;
    if (configMap.has(key)) fail('duplicate published configuration');
    configMap.set(key, config);
  }
  const baseMap = new Map<string, ContextualBase>();
  for (const base of input.bases) {
    if (base.shopId !== input.shopId) fail('mixed-shop contextual base');
    nonempty(base.productId, 'base product ID');
    nonempty(base.variantId, 'base variant ID');
    nonempty(base.contextId, 'base context ID');
    const key = `${base.productId}\u0000${base.variantId}`;
    if (baseMap.has(key)) fail('duplicate contextual base');
    baseMap.set(key, base);
  }
  let quantity = 0;
  for (const group of normalized)
    for (const variant of group.variants) quantity = safeQuantitySum(quantity, checkedQuantity(variant.quantity));
  const presentment = input.currency.presentmentCurrency;
  const groups: PricedGroup[] = [];
  const lines: ProposalEconomics['lines'][number][] = [];
  let proposalTotal = 0n;
  for (const group of normalized) {
    const config = configMap.get(`${group.productId}\u0000${group.configRevisionId}`);
    if (!config) fail('missing published configuration');
    const canonicalIdentity = canonicalCustomizationKey(group);
    const setup = resolveComponents(config, 'setup', group.design.placements, quantity, input);
    const unit = resolveComponents(config, 'unit', group.design.placements, quantity, input);
    const groupQuantity = group.variants.reduce((sum, variant) => safeQuantitySum(sum, variant.quantity), 0);
    const n = BigInt(groupQuantity);
    const baseSetup = setup.minor / n;
    let extras = setup.minor % n;
    const variants: PricedVariant[] = [];
    let baseTotal = 0n;
    let groupTotal = 0n;
    for (const variant of [...group.variants].sort((a, b) => compareId(a.variantId, b.variantId))) {
      const base = baseMap.get(`${group.productId}\u0000${variant.variantId}`);
      if (!base || base.currency !== presentment) fail('missing contextual presentment base');
      const baseMinor = parseMinor(base.minor, 0);
      const beforeSetup = checkedMinor(baseMinor + unit.minor);
      baseTotal = checkedMinor(baseTotal + baseMinor * BigInt(variant.quantity));
      const extraCount = Number(extras < BigInt(variant.quantity) ? extras : BigInt(variant.quantity));
      extras -= BigInt(extraCount);
      const buckets: PriceBucket[] = [];
      for (const [count, extra, start] of [
        [extraCount, 1n, 1],
        [variant.quantity - extraCount, 0n, extraCount + 1],
      ] as const) {
        if (count === 0) continue;
        const unitPrice = checkedMinor(beforeSetup + baseSetup + extra);
        const lineTotal = checkedMinor(unitPrice * BigInt(count));
        groupTotal = checkedMinor(groupTotal + lineTotal);
        const bucket: PriceBucket = {
          variantId: variant.variantId,
          quantity: count,
          unitOrdinalStart: start,
          unitOrdinalEnd: start + count - 1,
          setupPerUnitMinor: (baseSetup + extra).toString(),
          unitPriceMinor: unitPrice.toString(),
          lineTotalMinor: lineTotal.toString(),
        };
        buckets.push(bucket);
        lines.push({
          ...bucket,
          lineIndex: lines.length,
          canonicalIdentity,
          shopId: input.shopId,
          productId: group.productId,
          configRevisionId: group.configRevisionId,
          revisionContentHash: config.revisionContentHash,
        });
      }
      variants.push({
        variantId: variant.variantId,
        quantity: variant.quantity,
        contextualBaseMinor: baseMinor.toString(),
        contextId: base.contextId,
        buckets,
      });
    }
    const expected = checkedMinor(baseTotal + unit.minor * n + setup.minor);
    if (extras !== 0n || groupTotal !== expected) fail('allocation conservation failure');
    proposalTotal = checkedMinor(proposalTotal + groupTotal);
    groups.push({
      canonicalIdentity,
      shopId: input.shopId,
      productId: group.productId,
      configRevisionId: group.configRevisionId,
      revisionContentHash: config.revisionContentHash,
      quantity: groupQuantity,
      setupComponents: setup.components,
      unitComponents: unit.components,
      setupMinor: setup.minor.toString(),
      customizationUnitMinor: unit.minor.toString(),
      baseTotalMinor: baseTotal.toString(),
      totalMinor: groupTotal.toString(),
      variants,
    });
  }
  return freezeDeep({
    version: 'm2-proposal-economics-v1',
    shopId: input.shopId,
    pricingEngineVersion: PRICING_ENGINE_VERSION,
    roundingPolicy: ROUNDING_POLICY_VERSION,
    currency: {
      version: input.currency.version,
      presentmentCurrency: presentment,
      exponents: { ...input.currency.exponents },
    },
    fx: input.fx ? { ...input.fx } : null,
    effectiveAt: input.effectiveAt,
    marketContext: input.marketContext,
    customizedQuantity: quantity,
    totalMinor: proposalTotal.toString(),
    groups,
    lines,
  });
}
