/** Ajax is a non-transactional transport. Only Shopify Functions authorize purchase. */
export type CartBucket = { variantId: string; quantity: number; properties: Record<string, string> };
export type CartProperty = string | boolean | number | null;
export type CartLine = Omit<CartBucket, 'properties'> & {
  properties: Record<string, CartProperty>;
  key: string;
  sellingPlan: string | null;
};
export type CartSnapshot = {
  items: CartLine[];
  customized: CartLine[];
  ordinary: CartLine[];
  currency: string;
  attributes: Record<string, string>;
  fingerprint: string;
};
export type CartApplication = {
  status: 'applied' | 'review_required';
  cart: CartSnapshot | null;
  recovery?: 'late_effects_possible';
  /** `rejected`: Shopify refused a write (4xx); every write was acknowledged, so nothing is left pending. */
  reason?: 'cart_changed' | 'mutation_unresolved' | 'vector_mismatch' | 'cart_unavailable' | 'busy' | 'rejected';
};
/** Per-line v3 authorization (layout owner: packages/cart-authorization/src/line-v3.ts). */
const LINE = '_insignia_line_v3';
/** Shared signed header + signature: the first 236 characters of every line carrier of one set. */
const PREFIX_CHARS = 236;
/** Historical v2 carriers. Never written any more; an apply replaces leftover lines and clears the attribute. */
const LEGACY_QUOTE = '_insignia_quote_v2';
const LEGACY_MEMBER = '_insignia_member_v2';
const owned = (line: { properties: Record<string, unknown> }) =>
  Object.hasOwn(line.properties, LINE) ||
  Object.hasOwn(line.properties, LEGACY_QUOTE) ||
  Object.hasOwn(line.properties, LEGACY_MEMBER);
const prefixOf = (carrier: unknown) => (typeof carrier === 'string' ? carrier.slice(0, PREFIX_CHARS) : '');
const stableProperties = <T>(properties: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)));
function variantId(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0))
    throw new Error('Invalid cart variant');
  const id = String(value).replace(/^gid:\/\/shopify\/ProductVariant\//, '');
  if (!/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) throw new Error('Invalid cart variant');
  return id;
}
function properties(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cart properties');
  const entries = Object.entries(value);
  if (
    entries.length > 64 ||
    entries.some(([key, val]) => typeof val !== 'string' || key.length > 256 || val.length > 16384)
  )
    throw new Error('Invalid cart properties');
  return stableProperties(Object.fromEntries(entries));
}
function cartProperties(value: unknown): Record<string, CartProperty> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cart properties');
  const entries = Object.entries(value);
  if (
    entries.length > 64 ||
    entries.some(
      ([key, val]) =>
        key.length > 256 ||
        (typeof val === 'string'
          ? val.length > 16384
          : val !== null && typeof val !== 'boolean' && !(typeof val === 'number' && Number.isFinite(val))),
    )
  )
    throw new Error('Invalid cart properties');
  return stableProperties(Object.fromEntries(entries)) as Record<string, CartProperty>;
}
function normalized(lines: readonly (CartLine | CartBucket)[], keys = false): string {
  return JSON.stringify(
    lines
      .map((line) => ({
        variantId: variantId(line.variantId),
        quantity: line.quantity,
        properties: stableProperties(line.properties),
        sellingPlan: 'sellingPlan' in line ? line.sellingPlan : null,
        ...(keys && 'key' in line ? { key: line.key } : {}),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
function snapshot(value: unknown): CartSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 500
  )
    throw new Error('Invalid cart');
  const items: CartLine[] = value.items.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.key !== 'string' ||
      !item.key ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    )
      throw new Error('Invalid cart line');
    const plan = item.selling_plan_allocation?.selling_plan?.id;
    return {
      key: item.key,
      variantId: variantId(item.variant_id ?? item.id),
      quantity: item.quantity,
      properties: cartProperties(item.properties),
      sellingPlan: plan == null ? null : variantId(plan),
    };
  });
  if (new Set(items.map((item) => item.key)).size !== items.length) throw new Error('Duplicate cart key');
  const currency = 'currency' in value && typeof value.currency === 'string' ? value.currency : '';
  const attributes = properties('attributes' in value ? value.attributes : {});
  if (attributes[LEGACY_QUOTE] === '') delete attributes[LEGACY_QUOTE];
  return {
    items,
    customized: items.filter(owned),
    ordinary: items.filter((item) => !owned(item)),
    currency,
    attributes,
    fingerprint: JSON.stringify([currency, normalized(items, true), attributes]),
  };
}
export type CartMutationIntent = {
  version: 1;
  phase: 'pending' | 'abandoned';
  before: string;
  goal: string;
  quote: string;
  abandoned: string[];
};
export function parseCartMutationIntent(value: unknown): CartMutationIntent | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cart recovery state');
  const input = value as CartMutationIntent;
  if (
    Object.keys(input).sort().join(',') !== 'abandoned,before,goal,phase,quote,version' ||
    input.version !== 1 ||
    !['pending', 'abandoned'].includes(input.phase) ||
    ![input.before, input.goal, input.quote].every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) ||
    !Array.isArray(input.abandoned) ||
    input.abandoned.length > 4 ||
    input.abandoned.some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) ||
    new Set(input.abandoned).size !== input.abandoned.length
  )
    throw new Error('Invalid cart recovery state');
  return structuredClone(input);
}
export type CartMutationJournal = {
  readUnresolved(): boolean;
  writeUnresolved(value: boolean): void;
  readIntent?(): unknown;
  writeIntent?(value: CartMutationIntent | null): void;
};
const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
const otherAttributes = (cart: CartSnapshot) =>
  JSON.stringify(
    stableProperties(Object.fromEntries(Object.entries(cart.attributes).filter(([key]) => key !== LEGACY_QUOTE))),
  );
const logicalState = (cart: CartSnapshot) => JSON.stringify([cart.currency, normalized(cart.items), cart.attributes]);
export type CartApplicationLock = { run<T>(action: () => Promise<T>): Promise<T | null> };
let samePageLocked = false;
const defaultCartLock: CartApplicationLock = {
  async run<T>(action: () => Promise<T>): Promise<T | null> {
    // Browser Locks are origin scoped, so locales/instances/tabs share one cart.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('insignia-customized-cart-v2', { ifAvailable: true }, (lock) =>
        lock ? action() : null,
      );
    }
    // A local UX fallback cannot serialize other tabs or external theme writes.
    if (samePageLocked) return null;
    samePageLocked = true;
    try {
      return await action();
    } finally {
      samePageLocked = false;
    }
  },
};
export function createAjaxCartAdapter({
  root,
  fetchImpl = fetch,
  journal,
  lock = defaultCartLock,
}: {
  root: string;
  fetchImpl?: typeof fetch;
  journal?: CartMutationJournal;
  lock?: CartApplicationLock;
}) {
  // Shopify.routes.root is a same-origin locale path, never a remote URL.
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(root)) throw new Error('Invalid locale cart root');
  let applying = false;
  let unresolved = false;
  let intent: CartMutationIntent | null = null;
  const loadIntent = () => (journal?.readIntent ? parseCartMutationIntent(journal.readIntent()) : intent);
  function saveIntent(value: CartMutationIntent | null) {
    journal?.writeIntent?.(value);
    journal?.writeUnresolved(value !== null);
    intent = value;
    unresolved = value !== null;
  }
  function settle(value: CartMutationIntent) {
    saveIntent(value.abandoned.length ? { ...value, phase: 'abandoned', quote: value.abandoned[0]! } : null);
  }
  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetchImpl(`${root}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // A status is an acknowledged outcome; only a thrown fetch (network, abort, timeout) leaves it unknown.
    if (!response.ok) throw Object.assign(new Error('Cart request failed'), { status: response.status });
    if (!response.body) throw new Error('Missing cart response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bodyText = '';
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1048576) {
          void reader.cancel().catch(() => {});
          throw new Error('Cart response too large');
        }
        bodyText += decoder.decode(value, { stream: true });
      }
      bodyText += decoder.decode();
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object' && 'errors' in parsed && parsed.errors)
        throw new Error('Cart response error');
      return parsed;
    } finally {
      reader.releaseLock();
    }
  }
  const read = async (signal?: AbortSignal) => snapshot(await request('cart.js', undefined, signal));
  async function applyUnlocked(
    buckets: CartBucket[],
    { expectedFingerprint, repair = false }: { expectedFingerprint: string; repair?: boolean },
  ): Promise<CartApplication> {
    if (applying) return { status: 'review_required', cart: null, reason: 'busy' };
    // Validate the captured vector before dispatch.
    const desired = buckets.map((bucket) => ({
      variantId: variantId(bucket.variantId),
      quantity: bucket.quantity,
      properties: properties(bucket.properties),
    }));
    if (
      desired.length > 32 ||
      desired.some(
        (bucket) =>
          !Number.isSafeInteger(bucket.quantity) ||
          bucket.quantity < 1 ||
          bucket.quantity > 10000 ||
          Object.keys(bucket.properties).join() !== LINE ||
          (bucket.properties[LINE]?.length ?? 0) <= PREFIX_CHARS,
      ) ||
      new Set(desired.map((bucket) => bucket.properties[LINE])).size !== desired.length ||
      new Set(desired.map((bucket) => prefixOf(bucket.properties[LINE]))).size > 1 ||
      desired.reduce((sum, bucket) => sum + bucket.quantity, 0) > 10000
    )
      throw new Error('Invalid accepted cart vector');
    if (new TextEncoder().encode(JSON.stringify(desired)).byteLength > 65536)
      throw new Error('Accepted cart payload too large');
    if (repair && desired.length) throw new Error('Repair removes observed customization only');
    applying = true;
    let current: CartSnapshot | null = null;
    let dispatched = false;
    let pending: CartMutationIntent | null = null;
    try {
      current = await read();
      let prior = loadIntent();
      const observed = await digest(logicalState(current));
      if (prior?.phase === 'pending' && observed === prior.goal) {
        settle(prior);
        const same =
          normalized(current.customized) === normalized(desired) && current.attributes[LEGACY_QUOTE] === undefined;
        if (!repair)
          return {
            status: same ? 'applied' : 'review_required',
            cart: current,
            ...(!same ? { reason: 'cart_changed' as const } : {}),
            ...(prior.abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
          };
        prior = loadIntent();
      }
      if (current.fingerprint !== expectedFingerprint)
        return { status: 'review_required', cart: current, reason: 'cart_changed' };
      // The journal identifies an effect by its signed set: the shared v3 prefix.
      const quote = prefixOf(desired[0]?.properties[LINE]);
      const quoteDigest = await digest(quote);
      let abandoned = prior?.abandoned ?? [];
      if (prior?.phase === 'pending' || ((unresolved || journal?.readUnresolved()) && !prior)) {
        if (!repair) return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
        if (prior && prior.quote !== (await digest(''))) abandoned = [...new Set([...abandoned, prior.quote])];
        // A legacy boolean has no carrier identity. Retain an empty-carrier
        // digest as an unknown-effect tombstone; observed removal cannot close it.
        if (!prior) abandoned = [...new Set([...abandoned, await digest('')])];
      }
      if (!repair && prior?.phase === 'abandoned') {
        const carriers = [
          current.attributes[LEGACY_QUOTE],
          ...current.customized.map((line) => line.properties[LEGACY_QUOTE]),
          ...current.customized.map((line) =>
            Object.hasOwn(line.properties, LINE) ? prefixOf(line.properties[LINE]) : undefined,
          ),
        ].filter((v) => typeof v === 'string');
        const carrierHashes = await Promise.all(carriers.map((v) => digest(String(v))));
        if (
          !abandoned.length ||
          abandoned.includes(await digest('')) ||
          abandoned.includes(quoteDigest) ||
          carrierHashes.some((v) => abandoned.includes(v)) ||
          abandoned.length >= 4
        )
          return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
      }
      if (abandoned.length > 4) return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
      const ordinary = normalized(current.ordinary),
        foreign = otherAttributes(current),
        currency = current.currency;
      // v3 writes no cart attribute; a leftover v2 quote attribute is cleared with the removal.
      const attrs = { ...current.attributes };
      delete attrs[LEGACY_QUOTE];
      const goal = await digest(
        JSON.stringify([current.currency, normalized([...current.ordinary, ...desired]), stableProperties(attrs)]),
      );
      pending = { version: 1, phase: 'pending', before: observed, goal, quote: quoteDigest, abandoned };
      if (observed === goal) {
        if (repair && (prior || abandoned.length)) saveIntent({ ...pending, phase: 'abandoned' });
        return {
          status: 'applied',
          cart: current,
          ...(prior || abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
        };
      }
      saveIntent(pending); // Closed digest-only intent is durable before any mutation.
      // Add before remove (#339): a refused or interrupted add never costs the buyer the lines they had.
      // Old and new sets side by side are a valid cart-interaction state (spec §6.3); checkout validation
      // still requires one set. A line already carrying a desired carrier is kept and only resized: adding
      // identical properties again would merge into it, and keeping it avoids line-key churn.
      const start = current;
      const keptLine = (bucket: CartBucket) =>
        start.customized.find(
          (line) =>
            line.variantId === bucket.variantId &&
            line.sellingPlan === null &&
            JSON.stringify(line.properties) === JSON.stringify(bucket.properties),
        );
      const kept = new Map(
        desired.flatMap((bucket) => {
          const line = keptLine(bucket);
          return line ? [[line.key, bucket.quantity] as const] : [];
        }),
      );
      const additions = desired.filter((bucket) => !keptLine(bucket));
      const updates = Object.fromEntries(
        start.customized.flatMap((line) => {
          const quantity = kept.get(line.key) ?? 0;
          return quantity === line.quantity ? [] : [[line.key, quantity] as const];
        }),
      );
      const legacyQuote = start.attributes[LEGACY_QUOTE] !== undefined;
      let verdict: CartApplication['reason'];
      if (additions.length) {
        dispatched = true;
        await request('cart/add.js', {
          items: additions.map((bucket) => ({
            id: bucket.variantId,
            quantity: bucket.quantity,
            properties: bucket.properties,
          })),
        });
        current = await read();
        // Remove nothing unless the witness shows exactly the added lines beside the untouched old ones.
        if (normalized(current.customized) !== normalized([...start.customized, ...additions]))
          verdict = 'vector_mismatch';
      }
      let removed = false;
      if (!verdict && (Object.keys(updates).length || legacyQuote)) {
        dispatched = true;
        removed = true;
        // update.js returns the complete post-mutation cart, so it is its own witness. Only a leftover v2
        // quote attribute is cleared here, in the same request.
        current = snapshot(
          await request('cart/update.js', {
            updates,
            ...(legacyQuote ? { attributes: { [LEGACY_QUOTE]: '' } } : {}),
          }),
        );
      }
      if (
        !verdict &&
        (current.attributes[LEGACY_QUOTE] !== undefined || normalized(current.customized) !== normalized(desired))
      )
        verdict = 'vector_mismatch';
      if (
        !verdict &&
        (current.currency !== currency ||
          normalized(current.ordinary) !== ordinary ||
          otherAttributes(current) !== foreign)
      )
        verdict = removed ? 'cart_changed' : 'vector_mismatch';
      if (!verdict && (await digest(logicalState(current))) !== goal) verdict = 'vector_mismatch';
      // Every write above was acknowledged: no effect is in flight, so the intent never outlives this call.
      settle(pending);
      if (verdict) return { status: 'review_required', cart: current, reason: verdict };
      return {
        status: 'applied',
        cart: current,
        ...(abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
      };
    } catch (error) {
      try {
        current = await read();
      } catch {
        current = null;
      }
      if (dispatched && pending && current && (await digest(logicalState(current))) === pending.goal) {
        settle(pending);
        return {
          status: 'applied',
          cart: current,
          ...(pending.abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
        };
      }
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      if (pending && status >= 400 && status < 500) {
        // Shopify refused the write (stock, limits): a definite outcome. Earlier writes were acknowledged too.
        settle(pending);
        return { status: 'review_required', cart: current, reason: 'rejected' };
      }
      return {
        status: 'review_required',
        cart: current,
        reason: dispatched ? 'mutation_unresolved' : 'cart_unavailable',
      };
    } finally {
      applying = false;
    }
  }
  async function apply(
    buckets: CartBucket[],
    options: { expectedFingerprint: string; repair?: boolean },
  ): Promise<CartApplication> {
    // Lock acquisition is asynchronous too: capture reviewed input first.
    const captured = buckets.map((bucket) => ({
      variantId: bucket.variantId,
      quantity: bucket.quantity,
      properties: { ...bucket.properties },
    }));
    const fingerprint = options.expectedFingerprint;
    const repair = options.repair === true;
    return (
      (await lock.run(() => applyUnlocked(captured, { expectedFingerprint: fingerprint, repair }))) ?? {
        status: 'review_required',
        cart: null,
        reason: 'busy',
      }
    );
  }
  async function reconcile(): Promise<CartApplication> {
    return (
      (await lock.run(async () => {
        let current: CartSnapshot | null = null;
        try {
          current = await read();
          const pending = loadIntent();
          if (pending?.phase === 'pending' && (await digest(logicalState(current))) === pending.goal) {
            settle(pending);
            return {
              status: 'applied' as const,
              cart: current,
              ...(pending.abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
            };
          }
        } catch {}
        return { status: 'review_required' as const, cart: current, reason: 'mutation_unresolved' as const };
      })) ?? { status: 'review_required', cart: null, reason: 'busy' }
    );
  }
  return { read, apply, reconcile };
}
