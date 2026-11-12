import { type MerchantCustomerWordingView, parseBuyerResponse, type SelectedProductSetup } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import {
  adoptTabSession,
  type BuyerSessionGrant,
  type BuyerSessionStorage,
  forgetBuyerSession,
  readBuyerSession,
  sharedBuyerStorage,
  withBuyerSessionLock,
  writeBuyerSession,
} from './buyer-session.ts';
import { type CartBucket, type CartMutationIntent, parseCartMutationIntent } from './cart.ts';
export type DesiredGroup = {
  productId: string;
  configRevisionId: string;
  revisionContentHash: string;
  design: {
    placements: {
      placementId: string;
      methodId: string;
      stepId: string;
      artwork: { kind: 'revision'; revisionId: string } | { kind: 'deferred'; intentId: string };
      position?: { xMicros: number; yMicros: number };
    }[];
    options: { optionId: string; valueId: string }[];
  };
  variants: { variantId: string; quantity: number }[];
};
export type BuyerConfig = {
  version: 'm7-config-v1';
  productId: string;
  revisionId: string;
  contentHash: string;
  methods: { id: string; label: string }[];
  placements: {
    id: string;
    label: string;
    allowedMethodIds: string[];
    allowedStepIds: string[];
    logoLaterAllowed: boolean;
  }[];
  steps: { id: string; label: string }[];
  options: { id: string; label: string; values: { id: string; label: string }[] }[];
  variants: {
    id: string;
    label: string;
    available: boolean;
    selectedOptions?: { name: string; value: string; swatch?: { color: string } }[];
    baseUnitMinor?: string;
  }[];
  selectedSetup?: SelectedProductSetup;
  wording?: MerchantCustomerWordingView;
  shopCurrency?: 'USD' | 'EUR';
  title?: string;
  decorationPrices?: { placementId: string; methodId: string; stepId: string; minor: string }[];
  geometry: GeometryV1;
  imageUrls: Record<string, string>;
  ready: boolean;
};
export type QuoteProposal = {
  proposalId: string;
  hash: string;
  expiresAt: string;
  currency: string;
  exponent: number;
  customizedQuantity: number;
  totalMinor: string;
  groups: {
    productId: string;
    canonicalIdentitySha256?: string;
    selection?: DesiredGroup;
    quantity: number;
    setupMinor: string;
    customizationUnitMinor: string;
    baseTotalMinor: string;
    totalMinor: string;
  }[];
  changedGroups: string[];
};
export type AcceptedCart = {
  quoteId: string;
  setId: string;
  validThroughDay: number;
  applicationId: string;
  buckets: CartBucket[];
  desired: DesiredGroup[];
};
export function replaceGroup(groups: DesiredGroup[], group: DesiredGroup, index?: number): DesiredGroup[] {
  if (index === undefined) return [...groups, group];
  if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error('Unknown group');
  return groups.map((old, i) => (i === index ? group : old));
}
type Session = BuyerSessionGrant;
const pendingSessions = new WeakMap<BuyerSessionStorage, Map<string, Promise<Session>>>();
const usable = (value: Session) =>
  typeof value.capability === 'string' &&
  value.capability.length <= 2048 &&
  Number.isFinite(Date.parse(value.expiresAt)) &&
  Date.parse(value.expiresAt) > Date.now();

export function createBuyerApi({
  proxyBase,
  productId,
  fetchImpl = fetch,
  storage = sharedBuyerStorage(),
  country,
}: {
  proxyBase: string;
  productId: string;
  country?: string;
  fetchImpl?: typeof fetch;
  /** Where the session capability lives; by default the store every tab shares (buyer-session.ts). */
  storage?: BuyerSessionStorage;
}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*apps\/[a-z0-9-]{1,64}$/.test(proxyBase) || !/^[1-9][0-9]{0,19}$/.test(productId))
    throw new Error('Buyer configuration unavailable');
  let session: Promise<Session> | undefined;
  /** Capability of the session this instance last used. */
  let current: string | undefined;
  async function request<T>(
    url: string,
    body?: unknown,
    signal?: AbortSignal,
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<T> {
    const response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : method,
      // Shopify's storefront access gate needs its same-origin cookie.
      // Proxy signature and private capability still authorize Insignia requests.
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(typeof error?.message === 'string' ? error.message : 'Customization request unavailable'),
        {
          status: response.status,
          code: error?.code,
          retryAfter: Number(response.headers.get('Retry-After')) || 0,
          ...(response.status === 409 && error?.code === 'REVIEW_REQUIRED' && error?.acceptanceOutcome === 'declined'
            ? { acceptanceOutcome: 'declined' as const }
            : {}),
          // The cart's signed set belongs to a session this browser no longer holds (#340).
          ...(response.status === 409 &&
          error?.code === 'REVIEW_REQUIRED' &&
          ['NOT_OWNED', 'NOT_OWNED_EXPIRED'].includes(error?.details?.reason)
            ? { notOwned: error.details.reason === 'NOT_OWNED' ? ('valid' as const) : ('expired' as const) }
            : {}),
        },
      );
    }
    const text = await response.text();
    if (text.length > 1048576) throw new Error('Response too large');
    const parsed: unknown = JSON.parse(text);
    const route = new URL(url, 'https://storefront.invalid').pathname.split('/v1/')[1];
    if (!route) return parsed as T;
    let validated: unknown;
    try {
      validated = parseBuyerResponse(route, parsed);
    } catch {
      throw new Error('Customization response unavailable. Reopen the customizer.');
    }
    if (route === 'config') {
      const config = validated as BuyerConfig;
      config.geometry = normalizeBuyerGeometry(config.geometry);
      validateGeometry(config.geometry);
    }
    return validated as T;
  }
  async function grant() {
    const sessionMount = proxyBase.slice(proxyBase.lastIndexOf('/apps/'));
    // Every tab follows the stored session, so the cart's accepted sets keep one owner.
    const stored = readBuyerSession(storage, proxyBase);
    if (stored && stored.capability !== current) session = Promise.resolve(stored);
    let shared = storage ? pendingSessions.get(storage) : undefined;
    if (storage && !shared) {
      shared = new Map();
      pendingSessions.set(storage, shared);
    }
    session ??= shared?.get(sessionMount);
    session ??= withBuyerSessionLock(proxyBase, async () => {
      // Another tab may have created the session while this one waited.
      const created = readBuyerSession(storage, proxyBase) ?? adoptTabSession(storage, proxyBase);
      if (created) return created;
      const value = await request<Session>(`${proxyBase}/v1/sessions?productId=${productId}`, {});
      if (usable(value)) writeBuyerSession(storage, proxyBase, value);
      return value;
    }).catch((error) => {
      session = undefined;
      shared?.delete(sessionMount);
      throw error;
    });
    shared?.set(sessionMount, session);
    const value = await session;
    if (!usable(value)) {
      session = undefined;
      shared?.delete(sessionMount);
      throw new Error('Customization session expired. Reopen customization.');
    }
    current = value.capability;
    return value;
  }
  /**
   * The server expires a session that never stored a design or proposal after 24 hours, before
   * its capability does. A 401 is returned before any command runs, so mint one replacement.
   */
  async function authorized<T>(run: (capability: string) => Promise<T>): Promise<T> {
    const token = await grant();
    const held = session;
    try {
      return await run(token.capability);
    } catch (error) {
      if ((error as { status?: unknown }).status !== 401) throw error;
      const sessionMount = proxyBase.slice(proxyBase.lastIndexOf('/apps/'));
      if (session === held) session = undefined;
      const shared = storage ? pendingSessions.get(storage) : undefined;
      if (shared && shared.get(sessionMount) === held) shared.delete(sessionMount);
      // Another tab may already have stored a replacement; only the rejected session is forgotten.
      forgetBuyerSession(storage, proxyBase, token.capability);
      return run((await grant()).capability);
    }
  }
  return {
    /** Create or reuse the browser's shared session ahead of the first private call; failures retry on that call. */
    warmSession: () =>
      grant().then(
        () => {},
        () => {},
      ),
    config: (signal?: AbortSignal, targetProduct = productId) => {
      if (!/^[1-9][0-9]{0,19}$/.test(targetProduct)) throw new Error('Invalid product');
      return request<BuyerConfig>(
        `${proxyBase}/v1/config?productId=${targetProduct}${country && /^[A-Z]{2}$/.test(country) ? `&country=${country}` : ''}`,
        undefined,
        signal,
      );
    },
    async private<T>(
      path: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
      method: 'POST' | 'PUT' = 'POST',
    ) {
      if (!/^[a-z-]+(?:\/[a-zA-Z0-9-]+)*(?:\/[a-z-]+)?$/.test(path)) throw new Error('Invalid buyer action');
      const send = () =>
        authorized((capability) => request<T>(`${proxyBase}/v1/${path}`, { ...body, capability }, signal, method));
      if (!/^quote-proposals\/[a-zA-Z0-9-]+\/accept$/.test(path)) return send();
      // Acceptance is idempotent by its key: a transient BUSY (signing fence, provider throttling)
      // repeats the same command up to twice, after Retry-After plus jitter. Nothing else retries.
      for (let attempt = 0; ; attempt++) {
        try {
          return await send();
        } catch (error) {
          const { status, code, retryAfter } = error as { status?: unknown; code?: unknown; retryAfter?: number };
          if (attempt >= 2 || status !== 409 || code !== 'BUSY') throw error;
          // At least 1 s even when a proxy strips Retry-After: the server's lock_timeout is 2 s.
          await waitFor(Math.min(Math.max(retryAfter ?? 0, 1), 10) * 1000 + Math.random() * 250, signal);
        }
      }
    },
    async confirmCartApplication(id: string, body: Record<string, unknown>): Promise<void> {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error('Invalid cart application');
      const token = await grant();
      const value = { ...body, capability: token.capability };
      const encoded = JSON.stringify(value);
      const url = `${proxyBase}/v1/cart-applications/${id}/confirm`;
      if (new TextEncoder().encode(encoded).byteLength > 48 * 1024) {
        await request(url, value);
        return;
      }
      // UX reconciliation only: the Ajax cart is already verified. Dispatch
      // before returning and let the bounded request survive native navigation.
      void fetchImpl(url, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        keepalive: true,
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: encoded,
      }).catch(() => {});
    },
    artwork: async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!/^\/api\/artwork(?:\/[a-f0-9-]+\/(?:complete|status|preview))?$/.test(path))
        throw new Error('Invalid artwork action');
      return authorized((capability) =>
        request<T>(
          `${proxyBase}/guest${path.slice('/api/artwork'.length)}`,
          { ...(init.body ? JSON.parse(String(init.body)) : {}), capability },
          init.signal ?? undefined,
        ),
      );
    },
  };
}
function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
/**
 * A cart-state refusal because an earlier session, not this one, accepted the cart's customized lines:
 * `valid` lines can still be checked out as they are, `expired` ones only removed.
 */
export function earlierSessionCart(error: unknown): EarlierSessionCart | undefined {
  const value = error && typeof error === 'object' && 'notOwned' in error ? error.notOwned : undefined;
  return value === 'valid' || value === 'expired' ? value : undefined;
}
export type EarlierSessionCart = 'valid' | 'expired';
export function cartJournal(storage: Pick<Storage, 'getItem' | 'setItem'>, root: string) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(root)) throw new Error('Invalid cart root');
  const key = 'insignia-cart-unresolved-v2';
  const intentKey = 'insignia-cart-intent-v1';
  return {
    readUnresolved: () => storage.getItem(key) === '1',
    writeUnresolved: (value: boolean) => storage.setItem(key, value ? '1' : '0'),
    readIntent: () => {
      const text = storage.getItem(intentKey);
      if (text && text.length > 1024) throw new Error('Invalid cart recovery state');
      return parseCartMutationIntent(text ? JSON.parse(text) : null);
    },
    writeIntent: (value: CartMutationIntent | null) =>
      storage.setItem(intentKey, JSON.stringify(parseCartMutationIntent(value))),
  };
}
export async function advisoryFingerprint(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function normalizeBuyerGeometry(geometry: GeometryV1): GeometryV1 {
  const normalize = (id: string) => id.replace(/^gid:\/\/shopify\/ProductVariant\//, '');
  return {
    ...geometry,
    views: geometry.views.map((view) => ({
      ...view,
      variantImages: view.variantImages.map((value) => ({ ...value, variantId: normalize(value.variantId) })),
      placements: view.placements.map((placement) => ({
        ...placement,
        ...(placement.variantOverrides
          ? {
              variantOverrides: placement.variantOverrides.map((value) => ({
                ...value,
                variantId: normalize(value.variantId),
              })),
            }
          : {}),
      })),
    })),
  };
}
