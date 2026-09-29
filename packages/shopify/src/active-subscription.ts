/** Shopify Partner API 2026-07 activeSubscription read contract; the access token is injected at runtime. */
export const PARTNER_API_VERSION = '2026-07' as const;
export const ACTIVE_SUBSCRIPTION_SCHEMA_VERSION = 'm4-active-subscription-v1' as const;

export type PartnerSubscriptionFailureKind =
  | 'invalid_request'
  | 'auth_or_permission'
  | 'app_not_public'
  | 'shop_not_found'
  | 'feature_unavailable'
  | 'rate_limited'
  | 'network_or_timeout'
  | 'provider_error'
  | 'malformed_response';
export class PartnerSubscriptionError extends Error {
  constructor(readonly kind: PartnerSubscriptionFailureKind) {
    super(`Partner active subscription read failed: ${kind}`);
    this.name = 'PartnerSubscriptionError';
  }
}
export type SubscriptionPrice =
  | { kind: 'flat'; providerTypename: 'FlatRatePrice'; active: boolean; currency: string; amount: string }
  | {
      kind: 'tiered';
      providerTypename: 'TieredPrice';
      active: boolean;
      currency: string;
      tiersMode: 'VOLUME' | 'GRADUATED';
      tiers: { upTo: number | null; amountPerUnit: string; amount: string }[];
    };
export type SubscriptionItem = {
  handle: string;
  price: SubscriptionPrice;
  discount: {
    amount: string | null;
    percentage: string | null;
    originalDiscountCycles: number | null;
    remainingDiscountCycles: number | null;
    discountEndsAt: string | null;
  } | null;
  usage: { quantity: string; cost: { amount: string; currencyCode: string } } | null;
};
export type ActiveSubscriptionSnapshot = {
  schemaVersion: typeof ACTIVE_SUBSCRIPTION_SCHEMA_VERSION;
  sourceApiVersion: typeof PARTNER_API_VERSION;
  appId: string;
  shopId: string;
  observedAt: string;
  active: boolean;
  billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS' | null;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: SubscriptionItem[];
  pendingUpdate: { billingPeriod: 'ANNUAL' | 'EVERY_30_DAYS'; itemHandles: string[] } | null;
};
export interface PartnerGraphqlTransport {
  query(input: { query: string; variables: { appId: string; shopId: string } }): Promise<string>;
}

export const ACTIVE_SUBSCRIPTION_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    app { id } shop { id } billingPeriod cancelAtEndOfCycle trialEndsAt
    currentBillingCycle { startTime endTime }
    items {
      handle price { __typename active currency
        ... on FlatRatePrice { amount }
        ... on TieredPrice { tiersMode tiers { upTo amountPerUnit amount } }
      }
      discount { amount percentage originalDiscountCycles remainingDiscountCycles discountEndsAt }
      usage { quantity cost { amount currencyCode } }
    }
    pendingUpdate { billingPeriod items { handle } }
  }
}`;
const malformed = (): never => {
  throw new PartnerSubscriptionError('malformed_response');
};
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || hasControlCharacters(value)) return malformed();
  return value;
}
function gid(value: unknown, type: 'App' | 'Shop'): string {
  const id = nonempty(value);
  if (!new RegExp(`^gid://shopify/${type}/[0-9]+$`).test(id)) return malformed();
  return id;
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 128) return malformed();
  return value;
}
function floatDecimal(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('#number:')) return malformed();
  const lexical = value.slice(8);
  const parts = lexical.match(/^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!parts || lexical.length > 128) return malformed();
  const integerPart = parts[1];
  if (!integerPart) return malformed();
  if (!parts[3]) return lexical;
  const exponent = Number(parts[3]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 128) return malformed();
  const digits = integerPart + (parts[2] ?? '');
  const point = integerPart.length + exponent;
  const expanded =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${'0'.repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  if (expanded.length > 256) return malformed();
  return expanded.replace(/^0+(?=\d)/, '');
}
function optionalDecimal(value: unknown): string | null {
  return value == null ? null : decimal(value);
}
function integer(value: unknown): number {
  if (typeof value !== 'string' || !/^#number:(?:0|[1-9]\d*)$/.test(value)) return malformed();
  const number = Number(value.slice(8));
  if (!Number.isSafeInteger(number)) return malformed();
  return number;
}
function optionalInteger(value: unknown): number | null {
  return value == null ? null : integer(value);
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    return malformed();
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    return malformed();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return malformed();
  return date.toISOString();
}
function optionalTimestamp(value: unknown): string | null {
  return value == null ? null : timestamp(value);
}
function period(value: unknown): 'ANNUAL' | 'EVERY_30_DAYS' {
  if (value !== 'ANNUAL' && value !== 'EVERY_30_DAYS') return malformed();
  return value;
}
function currency(value: unknown): string {
  const code = nonempty(value);
  if (!/^[A-Z]{3}$/.test(code)) return malformed();
  return code;
}
function handle(value: unknown): string {
  const id = nonempty(value);
  if (id.trim() !== id) return malformed();
  return id;
}
function price(value: unknown): SubscriptionPrice {
  const p = record(value);
  if (typeof p.active !== 'boolean') return malformed();
  const code = currency(p.currency);
  if (p.__typename === 'FlatRatePrice')
    return {
      kind: 'flat',
      providerTypename: 'FlatRatePrice',
      active: p.active,
      currency: code,
      amount: decimal(p.amount),
    };
  if (
    p.__typename !== 'TieredPrice' ||
    (p.tiersMode !== 'VOLUME' && p.tiersMode !== 'GRADUATED') ||
    !Array.isArray(p.tiers) ||
    p.tiers.length === 0 ||
    p.tiers.length > 100
  )
    return malformed();
  const tiers = p.tiers.map((raw: unknown) => {
    const tier = record(raw);
    return {
      upTo: optionalInteger(tier.upTo),
      amountPerUnit: decimal(tier.amountPerUnit),
      amount: decimal(tier.amount),
    };
  });
  for (let i = 0; i < tiers.length; i++) {
    const current = tiers[i];
    if (!current) return malformed();
    const previous = tiers[i - 1];
    if (
      (current.upTo === null && i !== tiers.length - 1) ||
      (current.upTo !== null &&
        (current.upTo === 0 ||
          (previous?.upTo !== undefined && previous.upTo !== null && current.upTo <= previous.upTo)))
    )
      return malformed();
  }
  return {
    kind: 'tiered',
    providerTypename: 'TieredPrice',
    active: p.active,
    currency: code,
    tiersMode: p.tiersMode,
    tiers,
  };
}
function item(value: unknown): SubscriptionItem {
  const raw = record(value);
  const parsedPrice = price(raw.price);
  const discount =
    raw.discount == null
      ? null
      : (() => {
          const d = record(raw.discount);
          const amount = optionalDecimal(d.amount);
          const percentage = d.percentage == null ? null : floatDecimal(d.percentage);
          if (amount === null && percentage === null) return malformed();
          const originalDiscountCycles = optionalInteger(d.originalDiscountCycles);
          const remainingDiscountCycles = optionalInteger(d.remainingDiscountCycles);
          if (
            originalDiscountCycles !== null &&
            remainingDiscountCycles !== null &&
            remainingDiscountCycles > originalDiscountCycles
          )
            return malformed();
          return {
            amount,
            percentage,
            originalDiscountCycles,
            remainingDiscountCycles,
            discountEndsAt: optionalTimestamp(d.discountEndsAt),
          };
        })();
  const usage =
    raw.usage == null
      ? null
      : (() => {
          if (parsedPrice.kind !== 'tiered') return malformed();
          const u = record(raw.usage);
          const cost = record(u.cost);
          const currencyCode = currency(cost.currencyCode);
          if (currencyCode !== parsedPrice.currency) return malformed();
          return { quantity: floatDecimal(u.quantity), cost: { amount: decimal(cost.amount), currencyCode } };
        })();
  return { handle: handle(raw.handle), price: parsedPrice, discount, usage };
}
function distinctHandles(items: SubscriptionItem[]): void {
  if (new Set(items.map((entry) => entry.handle)).size !== items.length) malformed();
}
/** Quote JSON numeric tokens so GraphQL Float values retain their exact wire representation. */
function parseProviderJson(body: string): unknown {
  if (typeof body !== 'string' || body.length > 256 * 1024) return malformed();
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === '-' || /[0-9]/.test(ch)) {
      const match = body.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) return malformed();
      result += `"#number:${match[0]}"`;
      i += match[0].length - 1;
    } else result += ch;
  }
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return malformed();
  }
}
async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 256 * 1024) {
        await reader.cancel().catch(() => {});
        return malformed();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length).toString('utf8');
}
function classifyGraphql(errors: unknown): PartnerSubscriptionFailureKind {
  if (!Array.isArray(errors) || errors.length === 0) return 'malformed_response';
  const first = record(errors[0]);
  const message = typeof first.message === 'string' ? first.message : '';
  const code =
    first.extensions && typeof first.extensions === 'object'
      ? (first.extensions as Record<string, unknown>).code
      : null;
  if (message === 'Only public apps can access active subscription') return 'app_not_public';
  if (message === 'Shop not found') return 'shop_not_found';
  if (/feature.*not enabled/i.test(message)) return 'feature_unavailable';
  if (code === '401' || code === '403') return 'auth_or_permission';
  if (code === '429') return 'rate_limited';
  if (/access denied|forbidden|permission|unauthorized/i.test(message)) return 'auth_or_permission';
  return 'provider_error';
}
export function createActiveSubscriptionClient(config: { transport: PartnerGraphqlTransport; now?: () => Date }) {
  return {
    async read(input: { appId: string; shopId: string }): Promise<ActiveSubscriptionSnapshot> {
      if (!/^gid:\/\/shopify\/App\/[0-9]+$/.test(input.appId) || !/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(input.shopId))
        throw new PartnerSubscriptionError('invalid_request');
      const observedAt = (config.now ?? (() => new Date()))();
      if (!Number.isFinite(observedAt.getTime())) throw new PartnerSubscriptionError('invalid_request');
      let body: string;
      try {
        body = await config.transport.query({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: input });
      } catch (error) {
        if (error instanceof PartnerSubscriptionError) throw error;
        throw new PartnerSubscriptionError('network_or_timeout');
      }
      const envelope = record(parseProviderJson(body));
      if (envelope.errors != null) throw new PartnerSubscriptionError(classifyGraphql(envelope.errors));
      const data = record(envelope.data);
      const shared = {
        schemaVersion: ACTIVE_SUBSCRIPTION_SCHEMA_VERSION,
        sourceApiVersion: PARTNER_API_VERSION,
        appId: input.appId,
        shopId: input.shopId,
        observedAt: observedAt.toISOString(),
      };
      if (data.activeSubscription === null)
        return {
          ...shared,
          active: false,
          billingPeriod: null,
          cancelAtEndOfCycle: false,
          trialEndsAt: null,
          currentBillingCycle: null,
          items: [],
          pendingUpdate: null,
        };
      const subscription = record(data.activeSubscription);
      if (
        gid(record(subscription.app).id, 'App') !== input.appId ||
        gid(record(subscription.shop).id, 'Shop') !== input.shopId ||
        typeof subscription.cancelAtEndOfCycle !== 'boolean'
      )
        return malformed();
      const trialEndsAt = optionalTimestamp(subscription.trialEndsAt);
      const cycle =
        subscription.currentBillingCycle === null
          ? null
          : (() => {
              const c = record(subscription.currentBillingCycle);
              const startTime = timestamp(c.startTime);
              const endTime = timestamp(c.endTime);
              if (startTime >= endTime) return malformed();
              return { startTime, endTime };
            })();
      if ((trialEndsAt === null) === (cycle === null) || (trialEndsAt !== null && trialEndsAt <= shared.observedAt))
        return malformed();
      if (!Array.isArray(subscription.items) || subscription.items.length === 0 || subscription.items.length > 100)
        return malformed();
      const items = subscription.items.map(item);
      distinctHandles(items);
      items.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
      const pendingUpdate =
        subscription.pendingUpdate == null
          ? null
          : (() => {
              const p = record(subscription.pendingUpdate);
              if (!Array.isArray(p.items) || p.items.length === 0 || p.items.length > 100) return malformed();
              const itemHandles = p.items.map((raw: unknown) => handle(record(raw).handle)).sort();
              if (new Set(itemHandles).size !== itemHandles.length) return malformed();
              return { billingPeriod: period(p.billingPeriod), itemHandles };
            })();
      return {
        ...shared,
        active: true,
        billingPeriod: period(subscription.billingPeriod),
        cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
        trialEndsAt,
        currentBillingCycle: cycle,
        items,
        pendingUpdate,
      };
    },
  };
}

export function createPartnerGraphqlTransport(config: {
  organizationId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): PartnerGraphqlTransport {
  if (
    !/^[0-9]+$/.test(config.organizationId) ||
    !config.accessToken ||
    config.accessToken.length > 8192 ||
    hasControlCharacters(config.accessToken) ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
  )
    throw new PartnerSubscriptionError('invalid_request');
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async query(input) {
      if (
        input.query !== ACTIVE_SUBSCRIPTION_QUERY ||
        !/^gid:\/\/shopify\/App\/[0-9]+$/.test(input.variables.appId) ||
        !/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(input.variables.shopId)
      )
        throw new PartnerSubscriptionError('invalid_request');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8_000);
      try {
        const response = await fetchImpl(
          `https://partners.shopify.com/${config.organizationId}/api/${PARTNER_API_VERSION}/graphql.json`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-shopify-access-token': config.accessToken },
            body: JSON.stringify(input),
            signal: controller.signal,
            redirect: 'error',
          },
        );
        if (response.status === 401 || response.status === 403)
          throw new PartnerSubscriptionError('auth_or_permission');
        if (response.status === 429) throw new PartnerSubscriptionError('rate_limited');
        if (!response.ok) throw new PartnerSubscriptionError('provider_error');
        return await readBoundedBody(response);
      } catch (error) {
        if (error instanceof PartnerSubscriptionError) throw error;
        throw new PartnerSubscriptionError('network_or_timeout');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
