import { parseBuyerResponse } from '@insignia/contracts';
import { type GeometryV1, projectScene, validateGeometry } from '@insignia/visualizer/geometry';
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
  variants: { id: string; label: string; available: boolean }[];
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
export function formatMinor(value: string, currency: string, exponent: number): string {
  if (
    !/^(0|-?[1-9][0-9]*)$/.test(value) ||
    !Number.isInteger(exponent) ||
    exponent < 0 ||
    exponent > 3 ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw new Error('Invalid money');
  const amount = BigInt(value);
  const digits = (amount < 0n ? -amount : amount).toString().padStart(exponent + 1, '0');
  return `${currency} ${amount < 0n ? '-' : ''}${exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits}`;
}
export function replaceGroup(groups: DesiredGroup[], group: DesiredGroup, index?: number): DesiredGroup[] {
  if (index === undefined) return [...groups, group];
  if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error('Unknown group');
  return groups.map((old, i) => (i === index ? group : old));
}
export function createRequestLane() {
  let generation = 0;
  let controller: AbortController | undefined;
  return {
    next() {
      controller?.abort();
      controller = new AbortController();
      return { id: ++generation, signal: controller.signal };
    },
    current(id: number) {
      return generation === id && !controller?.signal.aborted;
    },
    cancel() {
      controller?.abort();
      generation++;
    },
  };
}
type Session = { capability: string; sessionId: string; expiresAt: string };
const pendingSessions = new WeakMap<Pick<Storage, 'getItem' | 'setItem'>, Map<string, Promise<Session>>>();
export function createBuyerApi({
  proxyBase,
  productId,
  fetchImpl = fetch,
  storage,
}: {
  proxyBase: string;
  productId: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*apps\/[a-z0-9-]{1,64}$/.test(proxyBase) || !/^[1-9][0-9]{0,19}$/.test(productId))
    throw new Error('Buyer configuration unavailable');
  let session: Promise<{ capability: string; sessionId: string; expiresAt: string }> | undefined;
  async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      // Shopify's storefront access gate needs its same-origin cookie.
      // Proxy signature and private capability still authorize Insignia requests.
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(typeof error.message === 'string' ? error.message : 'Customization request unavailable'),
        { status: response.status, code: error.code },
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
    const storageKey = `insignia-buyer-session:${sessionMount}`;
    if (!session && storage) {
      const saved = storage.getItem(storageKey);
      if (saved) {
        try {
          const value = JSON.parse(saved);
          if (
            typeof value.capability === 'string' &&
            typeof value.sessionId === 'string' &&
            Date.parse(value.expiresAt) > Date.now()
          )
            session = Promise.resolve({
              capability: value.capability,
              sessionId: value.sessionId,
              expiresAt: value.expiresAt,
            });
        } catch {
          /* Invalid local hints do not become authority. */
        }
      }
    }
    let shared = storage ? pendingSessions.get(storage) : undefined;
    if (storage && !shared) {
      shared = new Map();
      pendingSessions.set(storage, shared);
    }
    session ??= shared?.get(sessionMount);
    session ??= request<{ capability: string; sessionId: string; expiresAt: string }>(
      `${proxyBase}/v1/sessions?productId=${productId}`,
      {},
    ).catch((error) => {
      session = undefined;
      shared?.delete(sessionMount);
      throw error;
    });
    shared?.set(sessionMount, session);
    const value = await session;
    if (
      typeof value.capability !== 'string' ||
      value.capability.length > 2048 ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      session = undefined;
      shared?.delete(sessionMount);
      throw new Error('Customization session expired. Reopen customization.');
    }
    storage?.setItem(
      storageKey,
      JSON.stringify({ capability: value.capability, sessionId: value.sessionId, expiresAt: value.expiresAt }),
    );
    return value;
  }
  return {
    config: (signal?: AbortSignal, targetProduct = productId) => {
      if (!/^[1-9][0-9]{0,19}$/.test(targetProduct)) throw new Error('Invalid product');
      return request<BuyerConfig>(`${proxyBase}/v1/config?productId=${targetProduct}`, undefined, signal);
    },
    async private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
      if (!/^[a-z-]+(?:\/[a-zA-Z0-9-]+)*(?:\/[a-z-]+)?$/.test(path)) throw new Error('Invalid buyer action');
      const token = await grant();
      return request<T>(`${proxyBase}/v1/${path}`, { ...body, capability: token.capability }, signal);
    },
    artwork: async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!/^\/api\/artwork(?:\/[a-f0-9-]+\/(?:complete|status|preview))?$/.test(path))
        throw new Error('Invalid artwork action');
      const token = await grant();
      return request<T>(
        `${proxyBase}/guest${path.slice('/api/artwork'.length)}`,
        { ...(init.body ? JSON.parse(String(init.body)) : {}), capability: token.capability },
        init.signal ?? undefined,
      );
    },
  };
}
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
export function sizeControlKind(count: number): 'slider' | 'cards' | 'preview' {
  if (!Number.isInteger(count) || count < 0) throw new Error('Invalid step count');
  return count >= 3 ? 'slider' : count === 2 ? 'cards' : 'preview';
}
export function applyDefaultArtwork(
  group: DesiredGroup,
  artwork: DesiredGroup['design']['placements'][number]['artwork'],
  overrides: ReadonlySet<string>,
): DesiredGroup {
  return {
    ...group,
    design: {
      ...group.design,
      placements: group.design.placements.map((placement) =>
        overrides.has(placement.placementId) ? placement : { ...placement, artwork },
      ),
    },
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

export function buildBuyerScene(input: {
  geometry: GeometryV1;
  viewId: string;
  variantId?: string;
  selectedPlacementId?: string;
  placements: ReadonlyArray<Pick<DesiredGroup['design']['placements'][number], 'placementId' | 'stepId' | 'artwork'>>;
  previews: Readonly<Record<string, { url: string; aspectRatio: number }>>;
  imageUrls: Readonly<Record<string, string>>;
}) {
  const viewport = { width: 450, height: 350, pixelRatio: 1 };
  const visible = input.geometry.views.find((view) => view.id === input.viewId)?.placements ?? [];
  const base = projectScene(
    {
      version: 0,
      geometry: input.geometry,
      viewId: input.viewId,
      variantId: input.variantId,
      selectedPlacementId: visible.some((p) => p.id === input.selectedPlacementId)
        ? input.selectedPlacementId
        : undefined,
      artwork: { kind: 'none' },
    },
    viewport,
    input.imageUrls,
  );
  const artworks = input.placements.flatMap((placement) => {
    const preview = placement.artwork.kind === 'revision' ? input.previews[placement.artwork.revisionId] : undefined;
    const artwork =
      placement.artwork.kind === 'deferred'
        ? { kind: 'logo-later' as const }
        : preview
          ? { kind: 'raster' as const, url: preview.url, aspectRatio: preview.aspectRatio }
          : { kind: 'none' as const };
    const scene = projectScene(
      {
        version: 0,
        geometry: input.geometry,
        viewId: input.viewId,
        variantId: input.variantId,
        selectedPlacementId: placement.placementId,
        selectedStepId: placement.stepId,
        artwork,
      },
      viewport,
      input.imageUrls,
    );
    return scene.status === 'ready' && scene.artwork ? [{ placementId: placement.placementId, ...scene.artwork }] : [];
  });
  return { ...base, artworks };
}
