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
  /**
   * `rejected`: Shopify refused a write with a 4xx (typically stock) and the cart is back at its starting
   * customized lines, so nothing is left pending. `detail` carries Shopify's own explanation when it gave one.
   */
  reason?: 'cart_changed' | 'mutation_unresolved' | 'vector_mismatch' | 'cart_unavailable' | 'busy' | 'rejected';
  /** The HTTP status of the refusal behind `rejected` (422 is Shopify's stock/limit refusal). */
  refusal?: number;
  detail?: string;
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
/**
 * An abandoned signed set whose write had an unknown outcome and might still land: the digest of its shared v3
 * prefix (`LEGACY_SET` for an identity-free legacy uncertainty) and when this tab wrote it (epoch milliseconds).
 */
export type CartTombstone = { set: string; at: number };
export type CartMutationIntent = {
  version: 2;
  phase: 'pending' | 'abandoned';
  before: string;
  goal: string;
  quote: string;
  abandoned: CartTombstone[];
};
/** A journal holds at most this many tombstones; a full journal refuses new sets until an explicit repair. */
const TOMBSTONES = 4;
/** A signed line is never valid after D+2 (CART-LINE-V3), so three days after a tombstone was written its set can no longer be admitted anywhere. */
const TOMBSTONE_LIFETIME_MS = 3 * 86_400_000;
/** SHA-256 of the empty string: the tombstone of a legacy boolean-only uncertainty, which has no carrier identity. */
const LEGACY_SET = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const isDigest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/**
 * Validates a journal entry. A version-1 entry predates dated tombstones: each of its tombstones counts as written
 * at `now`, so a caller that persists the result lets it expire three days after this first read.
 */
export function parseCartMutationIntent(value: unknown, now = Date.now()): CartMutationIntent | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cart recovery state');
  const input = value as Omit<CartMutationIntent, 'version' | 'abandoned'> & { version: unknown; abandoned: unknown };
  const abandoned: unknown[] = Array.isArray(input.abandoned) ? input.abandoned : [];
  const entries =
    input.version === 1
      ? abandoned.map((set) => ({ set, at: now }))
      : abandoned.map((entry) =>
          entry && typeof entry === 'object' && Object.keys(entry).sort().join(',') === 'at,set'
            ? (entry as { set: unknown; at: unknown })
            : { set: null, at: null },
        );
  if (
    Object.keys(input).sort().join(',') !== 'abandoned,before,goal,phase,quote,version' ||
    (input.version !== 1 && input.version !== 2) ||
    !['pending', 'abandoned'].includes(input.phase) ||
    ![input.before, input.goal, input.quote].every(isDigest) ||
    !Array.isArray(input.abandoned) ||
    entries.length > TOMBSTONES ||
    entries.some((entry) => !isDigest(entry.set) || !Number.isSafeInteger(entry.at) || Number(entry.at) < 0) ||
    new Set(entries.map((entry) => entry.set)).size !== entries.length
  )
    throw new Error('Invalid cart recovery state');
  return structuredClone({ ...input, version: 2, abandoned: entries as CartTombstone[] });
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
/** Digests of every signed set with a carrier in the cart: v3 prefixes and historical v2 quotes. */
async function observedSets(cart: CartSnapshot): Promise<Set<string>> {
  const carriers = [
    cart.attributes[LEGACY_QUOTE],
    ...cart.customized.map((line) => line.properties[LEGACY_QUOTE]),
    ...cart.customized.map((line) =>
      Object.hasOwn(line.properties, LINE) ? prefixOf(line.properties[LINE]) : undefined,
    ),
  ].filter((v) => typeof v === 'string');
  return new Set(await Promise.all(carriers.map((v) => digest(String(v)))));
}
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
  now = Date.now,
}: {
  root: string;
  fetchImpl?: typeof fetch;
  journal?: CartMutationJournal;
  lock?: CartApplicationLock;
  now?: () => number;
}) {
  // Shopify.routes.root is a same-origin locale path, never a remote URL.
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(root)) throw new Error('Invalid locale cart root');
  let applying = false;
  let unresolved = false;
  let intent: CartMutationIntent | null = null;
  function loadIntent() {
    if (!journal?.readIntent) return intent;
    const stored = journal.readIntent();
    const value = parseCartMutationIntent(stored, now());
    // An entry written before tombstones carried a date is dated by this first read, so it expires three days later.
    if (value && (stored as { version?: unknown }).version !== value.version) saveIntent(value);
    return value;
  }
  function saveIntent(value: CartMutationIntent | null) {
    journal?.writeIntent?.(value);
    journal?.writeUnresolved(value !== null);
    intent = value;
    unresolved = value !== null;
  }
  function settle(value: CartMutationIntent) {
    saveIntent(value.abandoned[0] ? { ...value, phase: 'abandoned', quote: value.abandoned[0].set } : null);
  }
  /**
   * Owner decision, 12 November 2026 (#371): a tombstone is kept while a line of its set may be in `cart` (any
   * customized line for the identity-free legacy one). Otherwise it is dropped three days after it was written, or
   * when it is in `retired`: the tombstones a successful explicit repair or removal found when it began.
   */
  async function prune(list: CartTombstone[], cart: CartSnapshot, retired: ReadonlySet<string> = new Set()) {
    const sets = await observedSets(cart);
    const time = now();
    return list.filter(
      (entry) =>
        (entry.set === LEGACY_SET ? cart.customized.length > 0 : sets.has(entry.set)) ||
        (time - entry.at < TOMBSTONE_LIFETIME_MS && !retired.has(entry.set)),
    );
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
    if (!response.ok) {
      // A 4xx refusal is a definite outcome; Shopify explains it (e.g. stock) in `description`, shown as plain
      // text without control or bidi/format characters.
      const failure: unknown = await bounded(response).then(JSON.parse, () => null);
      const text =
        failure && typeof failure === 'object' && 'description' in failure && typeof failure.description === 'string'
          ? failure.description
              .replace(/\p{Cf}+/gu, '')
              .replace(/\p{Cc}+/gu, ' ')
              .trim()
              .slice(0, 300)
          : '';
      throw Object.assign(new Error('Cart request failed'), {
        status: response.status,
        ...(text ? { description: text } : {}),
      });
    }
    const parsed: unknown = JSON.parse(await bounded(response));
    if (parsed && typeof parsed === 'object' && 'errors' in parsed && parsed.errors)
      throw new Error('Cart response error');
    return parsed;
  }
  /** Reads a response body as text, refusing more than 1 MiB. */
  async function bounded(response: Response): Promise<string> {
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
      return bodyText + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const read = async (signal?: AbortSignal) => snapshot(await request('cart.js', undefined, signal));
  async function applyUnlocked(
    buckets: CartBucket[],
    {
      expectedFingerprint,
      repair = false,
      removal = false,
    }: { expectedFingerprint: string; repair?: boolean; removal?: boolean },
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
    /** Explicit repair or removal of customized lines: on success it retires the tombstones it found (#371). */
    const explicit = repair || removal;
    let inherited: ReadonlySet<string> = new Set();
    /** The intent to settle on success: an explicit operation drops the tombstones it may clear in `cart`. */
    const succeeded = async (value: CartMutationIntent, cart: CartSnapshot) =>
      explicit ? { ...value, abandoned: await prune(value.abandoned, cart, inherited) } : value;
    try {
      current = await read();
      let prior = loadIntent();
      if (prior) {
        const kept = await prune(prior.abandoned, current);
        if (kept.length !== prior.abandoned.length) {
          const first = kept[0];
          prior =
            prior.phase === 'pending'
              ? { ...prior, abandoned: kept }
              : first
                ? { ...prior, abandoned: kept, quote: first.set }
                : null;
          saveIntent(prior);
        }
      }
      inherited = new Set(prior?.abandoned.map((entry) => entry.set));
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
      const tombstone = (set: string) =>
        abandoned.some((entry) => entry.set === set) ? abandoned : [...abandoned, { set, at: now() }];
      if (prior?.phase === 'pending' || ((unresolved || journal?.readUnresolved()) && !prior)) {
        if (!repair) return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
        if (prior && prior.quote !== LEGACY_SET) abandoned = tombstone(prior.quote);
        // A legacy boolean has no carrier identity. Retain an empty-carrier digest as an unknown-effect
        // tombstone; only a later successful explicit repair that observes no customized line clears it.
        if (!prior) abandoned = tombstone(LEGACY_SET);
      }
      if (!repair && prior?.phase === 'abandoned') {
        const carrierHashes = await observedSets(current);
        if (
          !abandoned.length ||
          abandoned.some(
            (entry) => entry.set === LEGACY_SET || entry.set === quoteDigest || carrierHashes.has(entry.set),
          ) ||
          abandoned.length >= TOMBSTONES
        )
          return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
      }
      if (abandoned.length > TOMBSTONES)
        return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
      const currency = current.currency;
      // v3 writes no cart attribute; a leftover v2 quote attribute is cleared with the removal.
      const attrs = { ...current.attributes };
      delete attrs[LEGACY_QUOTE];
      const goal = await digest(
        JSON.stringify([current.currency, normalized([...current.ordinary, ...desired]), stableProperties(attrs)]),
      );
      pending = { version: 2, phase: 'pending', before: observed, goal, quote: quoteDigest, abandoned };
      if (observed === goal) {
        if (explicit && (prior || abandoned.length)) settle(await succeeded(pending, current));
        return {
          status: 'applied',
          cart: current,
          ...(prior || abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
        };
      }
      saveIntent(pending); // Closed digest-only intent is durable before any mutation.
      const own = pending;
      // Add before remove (#339): a refused or interrupted add never costs the buyer the lines they had.
      // Old and new sets side by side are a tolerated transient state (spec §6.3: cart interaction stays
      // possible, checkout requires one set). A line already carrying a desired carrier is kept and only
      // resized: adding identical properties again would merge into it.
      const start = current;
      const startKeys = new Set(start.customized.map((line) => line.key));
      const sameLine = (line: CartLine, bucket: CartBucket) =>
        line.variantId === bucket.variantId &&
        line.sellingPlan === null &&
        JSON.stringify(line.properties) === JSON.stringify(bucket.properties);
      const keptLine = (bucket: CartBucket) => start.customized.find((line) => sameLine(line, bucket));
      const kept = new Map(
        desired.flatMap((bucket) => {
          const line = keptLine(bucket);
          return line ? [[line.key, bucket.quantity] as const] : [];
        }),
      );
      const additions = desired.filter((bucket) => !keptLine(bucket));
      const legacyQuote = start.attributes[LEGACY_QUOTE] !== undefined;
      const items = (buckets: CartBucket[]) => ({
        items: buckets.map((bucket) => ({
          id: bucket.variantId,
          quantity: bucket.quantity,
          properties: bucket.properties,
        })),
      });
      type Refusal = { status: number; detail?: string };
      /** A 4xx is a definite refusal; any other failure (network, abort, timeout) stays unknown and propagates. */
      const refusal = (error: unknown): Refusal => {
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
        if (status < 400 || status >= 500) throw error;
        return error && typeof error === 'object' && 'description' in error && typeof error.description === 'string'
          ? { status, detail: error.description }
          : { status };
      };
      /** Buckets this application sends with add.js; only their lines are ever removed by compensation. */
      let created: CartBucket[] = additions;
      /** Old lines replaced in place by the stock fallback, newest last. */
      const swapped: { line: CartLine; bucket: CartBucket }[] = [];
      // After a definite failure, undo this application's own writes (B1): swapped lines get their old carrier
      // back, then the lines it added go in one write. If any swapped line cannot be restored, nothing is removed
      // (B3). Only a cart whose customized lines are back at the start settles the intent; anything else stays
      // unresolved for explicit repair.
      const failed = async (reason: 'rejected' | 'vector_mismatch', refused?: Refusal): Promise<CartApplication> => {
        let restored = false;
        try {
          let now = await read();
          let lost = false;
          for (const { line, bucket } of swapped.reverse()) {
            const replaced = now.customized.find((candidate) => sameLine(candidate, bucket));
            if (!replaced) {
              lost = true;
              continue;
            }
            now = snapshot(
              await request('cart/change.js', {
                id: replaced.key,
                quantity: line.quantity,
                properties: line.properties,
              }),
            );
          }
          swapped.length = 0;
          if (lost) throw new Error('A swapped line could not be restored');
          const added = now.customized.filter(
            (line) => !startKeys.has(line.key) && created.some((bucket) => sameLine(line, bucket)),
          );
          if (added.length)
            now = snapshot(
              await request('cart/update.js', { updates: Object.fromEntries(added.map((line) => [line.key, 0])) }),
            );
          current = now;
          restored = normalized(now.customized) === normalized(start.customized);
        } catch {
          /* The compensation's own outcome is unknown, or it could not restore every line. */
        }
        if (!restored) return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
        settle(own);
        return {
          status: 'review_required',
          cart: current,
          reason,
          ...(refused ? { refusal: refused.status } : {}),
          ...(refused?.detail ? { detail: refused.detail } : {}),
        };
      };
      let removals = start.customized.filter((line) => !kept.has(line.key));
      if (additions.length) {
        dispatched = true;
        let refused: Refusal | undefined;
        try {
          await request('cart/add.js', items(additions));
        } catch (error) {
          refused = refusal(error);
        }
        if (!refused) {
          try {
            current = await read();
          } catch (error) {
            return failed('rejected', refusal(error));
          }
          // Remove nothing unless the witness shows exactly the added lines beside the untouched old ones.
          if (normalized(current.customized) !== normalized([...start.customized, ...additions]))
            return failed('vector_mismatch');
        } else {
          // Shopify checks stock against the variant's whole cart quantity, so a re-signed set needs the old
          // lines' stock twice. Fall back once to replacing old lines of the same variant in place (change.js
          // keeps the line and needs stock only for an increase), after undoing any partial add. The largest
          // lines pair first and decreases run before increases, so a swap rarely needs stock still held elsewhere.
          const byQuantity = <T extends { quantity: number }>(list: T[]) =>
            [...list].sort((a, b) => b.quantity - a.quantity);
          const pool = byQuantity(removals);
          const pairs: { line: CartLine; bucket: CartBucket }[] = [];
          const rest: CartBucket[] = [];
          for (const bucket of byQuantity(additions)) {
            const index = pool.findIndex((line) => line.variantId === bucket.variantId && line.sellingPlan === null);
            if (index < 0) rest.push(bucket);
            else pairs.push({ line: pool.splice(index, 1)[0] as CartLine, bucket });
          }
          pairs.sort((a, b) => a.bucket.quantity - a.line.quantity - (b.bucket.quantity - b.line.quantity));
          if (refused.status !== 422 || !pairs.length) return failed('rejected', refused);
          const undone = await failed('rejected', refused);
          if (undone.reason !== 'rejected') return undone;
          saveIntent(own); // The same intent covers the fallback.
          created = rest;
          try {
            for (const pair of pairs) {
              await request('cart/change.js', {
                id: pair.line.key,
                quantity: pair.bucket.quantity,
                properties: pair.bucket.properties,
              });
              swapped.push(pair);
            }
            if (rest.length) await request('cart/add.js', items(rest));
            current = await read();
          } catch (error) {
            const again = refusal(error);
            return failed('rejected', again.detail ? again : { ...again, detail: refused.detail });
          }
          const expected = [
            ...start.customized.map((line) => pairs.find((pair) => pair.line === line)?.bucket ?? line),
            ...rest,
          ];
          if (normalized(current.customized) !== normalized(expected)) return failed('vector_mismatch');
          removals = pool;
        }
      }
      const updates = Object.fromEntries([
        ...removals.map((line) => [line.key, 0] as const),
        ...start.customized.flatMap((line) => {
          const quantity = kept.get(line.key);
          return quantity !== undefined && quantity !== line.quantity ? [[line.key, quantity] as const] : [];
        }),
      ]);
      if (Object.keys(updates).length || legacyQuote) {
        dispatched = true;
        try {
          // update.js returns the complete post-mutation cart, so it is its own witness. Only a leftover v2
          // quote attribute is cleared here, in the same request.
          current = snapshot(
            await request('cart/update.js', {
              updates,
              ...(legacyQuote ? { attributes: { [LEGACY_QUOTE]: '' } } : {}),
            }),
          );
        } catch (error) {
          return failed('rejected', refusal(error));
        }
      }
      // An old line that survived an acknowledged removal leaves two signed sets: explicit repair (NB1).
      if (desired.length && current.customized.some((line) => prefixOf(line.properties[LINE]) !== quote))
        return { status: 'review_required', cart: current, reason: 'mutation_unresolved' };
      // Every write above was acknowledged: nothing is in flight. The customized lines are what this
      // application owns; ordinary lines and foreign attributes may change meanwhile (theme drawer, other tab).
      const mismatch =
        current.attributes[LEGACY_QUOTE] !== undefined ||
        current.currency !== currency ||
        normalized(current.customized) !== normalized(desired);
      settle(mismatch ? own : await succeeded(own, current));
      if (mismatch) return { status: 'review_required', cart: current, reason: 'vector_mismatch' };
      return {
        status: 'applied',
        cart: current,
        ...(abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
      };
    } catch {
      try {
        current = await read();
      } catch {
        current = null;
      }
      if (dispatched && pending && current && (await digest(logicalState(current))) === pending.goal) {
        settle(await succeeded(pending, current));
        return {
          status: 'applied',
          cart: current,
          ...(pending.abandoned.length ? { recovery: 'late_effects_possible' as const } : {}),
        };
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
    options: { expectedFingerprint: string; repair?: boolean; removal?: boolean },
  ): Promise<CartApplication> {
    // Lock acquisition is asynchronous too: capture reviewed input first.
    const captured = buckets.map((bucket) => ({
      variantId: bucket.variantId,
      quantity: bucket.quantity,
      properties: { ...bucket.properties },
    }));
    const fingerprint = options.expectedFingerprint;
    const repair = options.repair === true;
    const removal = options.removal === true;
    return (
      (await lock.run(() => applyUnlocked(captured, { expectedFingerprint: fingerprint, repair, removal }))) ?? {
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
