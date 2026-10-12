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
  fingerprint: string;
};
export type CartApplication = {
  status: 'applied' | 'review_required';
  cart: CartSnapshot | null;
  reason?: 'cart_changed' | 'mutation_unresolved' | 'vector_mismatch' | 'cart_unavailable' | 'busy';
};
const QUOTE = '_insignia_quote_v2';
const MEMBER = '_insignia_member_v2';
const owned = (line: { properties: Record<string, unknown> }) =>
  Object.hasOwn(line.properties, QUOTE) || Object.hasOwn(line.properties, MEMBER);
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
function normalized(lines: CartLine[] | CartBucket[], keys = false): string {
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
  return {
    items,
    customized: items.filter(owned),
    ordinary: items.filter((item) => !owned(item)),
    currency,
    fingerprint: JSON.stringify([currency, normalized(items, true)]),
  };
}
export type CartMutationJournal = { readUnresolved(): boolean; writeUnresolved(value: boolean): void };
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
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`${root}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Cart request failed');
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
  const read = async () => snapshot(await request('cart.js'));
  async function applyUnlocked(
    buckets: CartBucket[],
    { expectedFingerprint }: { expectedFingerprint: string },
  ): Promise<CartApplication> {
    if (applying) return { status: 'review_required', cart: null, reason: 'busy' };
    if (unresolved || journal?.readUnresolved()) {
      let observed: CartSnapshot | null;
      try {
        observed = await read();
      } catch {
        observed = null;
      }
      return { status: 'review_required', cart: observed, reason: 'mutation_unresolved' };
    }
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
          !bucket.properties[QUOTE] ||
          !bucket.properties[MEMBER],
      ) ||
      new Set(desired.map((bucket) => bucket.properties[MEMBER])).size !== desired.length ||
      new Set(desired.map((bucket) => bucket.properties[QUOTE])).size > 1 ||
      desired.reduce((sum, bucket) => sum + bucket.quantity, 0) > 10000
    )
      throw new Error('Invalid accepted cart vector');
    if (new TextEncoder().encode(JSON.stringify(desired)).byteLength > 65536)
      throw new Error('Accepted cart payload too large');
    applying = true;
    let current: CartSnapshot | null = null;
    let dispatched = false;
    try {
      current = await read();
      if (current.fingerprint !== expectedFingerprint)
        return { status: 'review_required', cart: current, reason: 'cart_changed' };
      const ordinary = normalized(current.ordinary);
      if (normalized(current.customized) === normalized(desired)) return { status: 'applied', cart: current };
      if (current.customized.length) {
        journal?.writeUnresolved(true);
        unresolved = true;
        dispatched = true;
        await request('cart/update.js', {
          updates: Object.fromEntries(current.customized.map((item) => [item.key, 0])),
        });
        current = await read();
        if (current.customized.length || normalized(current.ordinary) !== ordinary) {
          journal?.writeUnresolved(false);
          unresolved = false;
          return { status: 'review_required', cart: current, reason: 'cart_changed' };
        }
      }
      if (desired.length) {
        journal?.writeUnresolved(true);
        unresolved = true;
        dispatched = true;
        await request('cart/add.js', {
          items: desired.map((bucket) => ({
            id: bucket.variantId,
            quantity: bucket.quantity,
            properties: bucket.properties,
          })),
        });
        current = await read();
      }
      journal?.writeUnresolved(false);
      unresolved = false;
      if (normalized(current.customized) !== normalized(desired) || normalized(current.ordinary) !== ordinary)
        return { status: 'review_required', cart: current, reason: 'vector_mismatch' };
      return { status: 'applied', cart: current };
    } catch {
      unresolved = dispatched;
      // Read-only reconciliation, including after non-2xx: a failed Ajax mutation may have effects.
      try {
        current = await read();
      } catch {
        current = null;
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
  async function apply(buckets: CartBucket[], options: { expectedFingerprint: string }): Promise<CartApplication> {
    // Lock acquisition is asynchronous too: capture reviewed input first.
    const captured = buckets.map((bucket) => ({
      variantId: bucket.variantId,
      quantity: bucket.quantity,
      properties: { ...bucket.properties },
    }));
    const fingerprint = options.expectedFingerprint;
    return (
      (await lock.run(() => applyUnlocked(captured, { expectedFingerprint: fingerprint }))) ?? {
        status: 'review_required',
        cart: null,
        reason: 'busy',
      }
    );
  }
  return { read, apply };
}
