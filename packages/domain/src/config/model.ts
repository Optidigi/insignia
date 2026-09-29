// Published pricing values are resolved snapshots. No catalog lookup is performed here.
export const PUBLISHED_CONFIG_VERSION = 'm2-published-config-v1' as const;

export interface ComponentAmount {
  shopDecimal: string;
  presentmentOverrides: { currency: string; decimal: string }[];
}

export type PricingScope =
  | { kind: 'general' }
  | { kind: 'method'; methodId: string }
  | { kind: 'placement'; placementId: string; methodId?: string }
  | { kind: 'step'; placementId: string; stepId: string; methodId?: string };

export type PricingRate =
  | { kind: 'fixed'; amount: ComponentAmount }
  | { kind: 'allUnits'; tiers: { minQuantity: number; amount: ComponentAmount }[] };

export interface PricingRule {
  id: string;
  scope: PricingScope;
  role: 'setup' | 'unit';
  methodUnitMultiplicity?: 'perGarment' | 'perPlacement';
  rate: PricingRate;
}

export interface PublishedConfig {
  version: typeof PUBLISHED_CONFIG_VERSION;
  shopId: string;
  productId: string;
  revisionId: string;
  revisionContentHash: string;
  shopCurrency: string;
  methods: { id: string }[];
  placements: { id: string; allowedMethodIds: string[]; allowedStepIds: string[]; logoLaterAllowed: boolean }[];
  productionOptions: { id: string; allowedValueIds: string[] }[];
  pricingRules: PricingRule[];
}

function assertId(id: string, label: string): void {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error(`invalid ${label}`);
}

function assertUnique(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    assertId(id, label);
    if (seen.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function assertDecimal(value: string, signed: boolean): void {
  if (
    typeof value !== 'string' ||
    value.length > 25 ||
    !/^-?(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(value) ||
    (!signed && value.startsWith('-'))
  ) {
    throw new Error('invalid component decimal');
  }
  // An amount cannot exceed the bounded u64 minor representation at any supported exponent.
  const [whole = '', fraction = ''] = value.replace('-', '').split('.');
  const minorAtThree = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  if (minorAtThree > (1n << 64n) - 1n) throw new Error('component amount overflows u64');
}

function validateAmount(amount: ComponentAmount, signed: boolean, shopCurrency: string): void {
  if (!amount || typeof amount !== 'object' || !Array.isArray(amount.presentmentOverrides))
    throw new Error('invalid component amount');
  assertDecimal(amount.shopDecimal, signed);
  const currencies = new Set<string>();
  for (const override of amount.presentmentOverrides) {
    if (
      !override ||
      !/^[A-Z]{3}$/.test(override.currency) ||
      override.currency === shopCurrency ||
      currencies.has(override.currency)
    ) {
      throw new Error('invalid or duplicate presentment override currency');
    }
    currencies.add(override.currency);
    assertDecimal(override.decimal, signed);
  }
}

function cloneFrozen<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((part) => cloneFrozen(part))) as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, part]) => [key, cloneFrozen(part)]);
    return Object.freeze(Object.fromEntries(entries)) as T;
  }
  return value;
}

function scopeKey(scope: PricingScope): string {
  switch (scope.kind) {
    case 'general':
      return JSON.stringify(['general']);
    case 'method':
      return JSON.stringify(['method', scope.methodId]);
    case 'placement':
      return JSON.stringify(['placement', scope.placementId, scope.methodId ?? null]);
    case 'step':
      return JSON.stringify(['step', scope.placementId, scope.stepId, scope.methodId ?? null]);
    default:
      throw new Error('unsupported pricing scope');
  }
}

export function publishConfigValue(input: PublishedConfig): PublishedConfig {
  if (!input || input.version !== PUBLISHED_CONFIG_VERSION) throw new Error('unsupported published config version');
  assertId(input.shopId, 'shop ID');
  assertId(input.productId, 'product ID');
  assertId(input.revisionId, 'revision ID');
  if (typeof input.revisionContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.revisionContentHash))
    throw new Error('invalid published revision content hash');
  if (!/^[A-Z]{3}$/.test(input.shopCurrency)) throw new Error('invalid shop currency');
  if (
    !Array.isArray(input.methods) ||
    !Array.isArray(input.placements) ||
    !Array.isArray(input.productionOptions) ||
    !Array.isArray(input.pricingRules)
  )
    throw new Error('invalid published config lists');
  assertUnique(
    input.methods.map((item) => item.id),
    'method ID',
  );
  assertUnique(
    input.placements.map((item) => item.id),
    'placement ID',
  );
  assertUnique(
    input.productionOptions.map((item) => item.id),
    'production option ID',
  );
  const methods = new Set(input.methods.map((item) => item.id));
  const placements = new Map(input.placements.map((item) => [item.id, item]));
  for (const placement of input.placements) {
    assertUnique(placement.allowedMethodIds, 'allowed method ID');
    assertUnique(placement.allowedStepIds, 'allowed step ID');
    if (
      placement.allowedMethodIds.length === 0 ||
      placement.allowedStepIds.length === 0 ||
      typeof placement.logoLaterAllowed !== 'boolean'
    )
      throw new Error('invalid placement policy');
    for (const id of placement.allowedMethodIds) if (!methods.has(id)) throw new Error(`unknown method: ${id}`);
  }
  for (const option of input.productionOptions) {
    assertUnique(option.allowedValueIds, 'production option value ID');
    if (option.allowedValueIds.length === 0) throw new Error('empty production option values');
  }
  assertUnique(
    input.pricingRules.map((rule) => rule.id),
    'pricing rule ID',
  );
  const semanticRules = new Set<string>();
  for (const rule of input.pricingRules) {
    if (rule.role !== 'setup' && rule.role !== 'unit') throw new Error('unsupported pricing role');
    const scope = rule.scope;
    if (!scope || !['general', 'method', 'placement', 'step'].includes(scope.kind))
      throw new Error('unsupported pricing scope');
    if (scope.kind === 'general' && rule.role === 'unit') throw new Error('general unit pricing is unsupported');
    if (scope.kind === 'method' && !methods.has(scope.methodId)) throw new Error('unknown method pricing reference');
    if (scope.kind === 'placement' || scope.kind === 'step') {
      const placement = placements.get(scope.placementId);
      if (!placement) throw new Error('unknown placement pricing reference');
      if (scope.methodId && !placement.allowedMethodIds.includes(scope.methodId))
        throw new Error('invalid method-specific pricing reference');
      if (scope.kind === 'step' && !placement.allowedStepIds.includes(scope.stepId))
        throw new Error('unknown step pricing reference');
    }
    const semanticKey = `${rule.role}:${scopeKey(scope)}`;
    if (semanticRules.has(semanticKey)) throw new Error('duplicate pricing rule scope');
    semanticRules.add(semanticKey);
    if (scope.kind === 'method' && rule.role === 'unit') {
      if (rule.methodUnitMultiplicity !== 'perGarment' && rule.methodUnitMultiplicity !== 'perPlacement')
        throw new Error('method unit multiplicity required');
    } else if (rule.methodUnitMultiplicity !== undefined)
      throw new Error('method unit multiplicity applies only to method unit rules');
    const signed = rule.role === 'unit' && (scope.kind === 'placement' || scope.kind === 'step');
    if (rule.rate.kind === 'fixed') validateAmount(rule.rate.amount, signed, input.shopCurrency);
    else if (rule.rate.kind === 'allUnits') {
      if (rule.role === 'setup') throw new Error('setup tiers unsupported');
      if (!Array.isArray(rule.rate.tiers) || rule.rate.tiers.length === 0 || rule.rate.tiers[0]?.minQuantity !== 1)
        throw new Error('tier schedule must start at one');
      let previous = 0;
      for (const tier of rule.rate.tiers) {
        if (!Number.isSafeInteger(tier.minQuantity) || tier.minQuantity <= previous)
          throw new Error('tier schedule must be strictly ascending');
        previous = tier.minQuantity;
        validateAmount(tier.amount, signed, input.shopCurrency);
      }
    } else throw new Error('unsupported pricing rate');
  }
  return cloneFrozen(input);
}

export const validatePublishedConfig = publishConfigValue;
