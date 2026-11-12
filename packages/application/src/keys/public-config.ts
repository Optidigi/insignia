import { createHash } from 'node:crypto';
import { admitPublicKey, type KeyScope } from './crypto.js';

/**
 * Owner decision, 11 November 2026: signing keys do not expire routinely. A new key's last valid
 * day is this sentinel (the largest PostgreSQL integer; the Functions read it as u32). A key loses
 * it only when it is retired (rotation, revocation or reinstall): its window is then shortened so
 * outstanding 3-day offers keep verifying and destruction can follow. Epoch bump remains the
 * immediate emergency revocation.
 */
export const NON_EXPIRING_LAST_DAY = 0x7fffffff;
/** A retired key verifies through its retirement shop day + 3 (3-day offers plus one day of slack). */
export const RETIREMENT_GRACE_DAYS = 3;

export type PublicSigningKey = {
  id: number;
  publicKey: Uint8Array;
  state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
  firstDay: number;
  lastDay: number;
};
export type PublicConfig = {
  value: string;
  digest: string;
  scope: KeyScope;
  /**
   * Destroyed keys whose window has closed (UTC day − 1 rule). A published copy may still list them
   * until the next publication: they admit nothing, so `publishedConfigMatches` tolerates them.
   */
  closedDestroyed: readonly PublicSigningKey[];
  keys: readonly {
    id: number;
    publicHex: string;
    revoked: boolean;
    firstDay: number;
    lastDay: number;
    state: PublicSigningKey['state'];
  }[];
};

/** Exact JSON field order is deliberate; the Rust parser admits at most four keys. */
export function buildPublicConfig(input: {
  scope: KeyScope;
  keys: readonly PublicSigningKey[];
  /** When given, destroyed keys whose window closed before this instant are recorded as tolerable extras. */
  now?: Date;
}): PublicConfig {
  const { scope } = input;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scope.authorizationGeneration) ||
    !Number.isInteger(scope.authorizationEpoch) ||
    scope.authorizationEpoch < 0 ||
    scope.authorizationEpoch > 0xffffffff
  )
    throw new TypeError('Invalid authorization identity');
  // A pending key must be visible to both Functions before it can be selected for issuance.
  const ordered = [...input.keys].filter((key) => key.state !== 'destroyed').sort((a, b) => a.id - b.id);
  if (ordered.length < 1 || ordered.length > 4) throw new Error('Function key count is out of bounds');
  const seen = new Set<number>();
  const keys = ordered.map((key) => {
    if (
      !Number.isInteger(key.id) ||
      key.id < 1 ||
      key.id > 65535 ||
      seen.has(key.id) ||
      !Number.isInteger(key.firstDay) ||
      !Number.isInteger(key.lastDay) ||
      key.firstDay < 0 ||
      key.lastDay > NON_EXPIRING_LAST_DAY ||
      key.firstDay > key.lastDay
    )
      throw new TypeError('Invalid Function key');
    seen.add(key.id);
    return {
      id: key.id,
      publicHex: admitPublicKey(key.publicKey).toString('hex'),
      revoked: key.state === 'revoked',
      firstDay: key.firstDay,
      lastDay: key.lastDay,
      state: key.state,
    };
  });
  const value = JSON.stringify({
    generationHex: scope.authorizationGeneration.replaceAll('-', ''),
    epoch: scope.authorizationEpoch,
    maxBuckets: 32,
    maxPhysicalQuantity: 10000,
    allowNoMarket: false,
    keys: keys.map(({ state: _state, ...visible }) => visible),
  });
  if (Buffer.byteLength(value) > 8000) throw new Error('Function config exceeds publication headroom');
  const utcDay = input.now ? Math.floor(input.now.getTime() / 86_400_000) : undefined;
  const closedDestroyed =
    utcDay === undefined
      ? []
      : input.keys.filter(
          (key) => key.state === 'destroyed' && Number.isInteger(key.lastDay) && key.lastDay < utcDay - 1,
        );
  return { value, digest: createHash('sha256').update(value).digest('hex'), scope, keys, closedDestroyed };
}

/**
 * The one comparison between a published Function config and the expected projection. It matches
 * when the published value is exactly the expected one, or exactly the expected one plus entries
 * for keys that are destroyed in the database and whose window has closed (byte-identical public
 * key and window; only their `revoked` flag is taken from the published copy). Any other
 * difference — an unknown key, a destroyed key with an open window, a missing key, or any other
 * field — does not match.
 */
export function publishedConfigMatches(desired: PublicConfig, publishedValue: string | null | undefined): boolean {
  if (typeof publishedValue !== 'string') return false;
  if (publishedValue === desired.value) return true;
  if (!desired.closedDestroyed.length) return false;
  let published: { keys?: unknown };
  try {
    published = JSON.parse(publishedValue);
  } catch {
    return false;
  }
  if (!published || typeof published !== 'object' || !Array.isArray(published.keys)) return false;
  const expected = JSON.parse(desired.value) as { keys: { id: number }[] } & Record<string, unknown>;
  const expectedIds = new Set(expected.keys.map((key) => key.id));
  const closed = new Map(desired.closedDestroyed.map((key) => [key.id, key]));
  const extras: { id: number; publicHex: string; revoked: boolean; firstDay: number; lastDay: number }[] = [];
  for (const entry of published.keys as { id?: unknown; revoked?: unknown }[]) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'number' || expectedIds.has(entry.id)) continue;
    const key = closed.get(entry.id);
    if (!key || typeof entry.revoked !== 'boolean') return false;
    extras.push({
      id: key.id,
      publicHex: Buffer.from(key.publicKey).toString('hex'),
      revoked: entry.revoked,
      firstDay: key.firstDay,
      lastDay: key.lastDay,
    });
  }
  if (!extras.length) return false;
  const rebuilt = JSON.stringify({
    ...expected,
    keys: [...expected.keys, ...extras].sort((a, b) => a.id - b.id),
  });
  return rebuilt === publishedValue;
}

/**
 * Owner-rotation pre-check only; quote readiness stays on `publishedConfigMatches`. A published
 * config may be replaced (compare-and-set) by the expected one when it matches, or when it is an
 * earlier publication the database has since only tightened, which is what a stopped rotation or
 * an emergency change leaves behind:
 * - the published epoch is lower (an epoch bump);
 * - the pending key `pendingKeyId` of this rotation's plan is not published yet;
 * - a key the database has revoked is not published at all (for example an abandoned pending
 *   key): the Functions reject a key they do not list;
 * - a key's published window ends later (rotation and revocation only shorten windows);
 * - a key is not yet published as revoked.
 * Nothing else may differ: a published value stricter than the database, an unknown or swapped
 * key, or any other field still stops the rotation. Returns the tolerated differences (empty when
 * the published config matches), or null when the rotation must stop.
 */
export function rotationRepublishDifferences(
  desired: PublicConfig,
  publishedValue: string | null | undefined,
  pendingKeyId: number,
): string[] | null {
  if (publishedValue === desired.value) return [];
  const pending = desired.keys.find((key) => key.id === pendingKeyId && key.state === 'pending');
  // Nothing published yet (a first provisioning stopped before publishing): every stored key must
  // be this plan's pending key or a revoked one.
  if (publishedValue === null || publishedValue === undefined)
    return pending && desired.keys.every((key) => key.id === pending.id || key.revoked)
      ? desired.keys.map((key) =>
          key.revoked ? `revoked key ${key.id} not published` : `pending key ${key.id} not published`,
        )
      : null;
  let published: { epoch?: unknown; keys?: unknown };
  try {
    published = JSON.parse(publishedValue);
  } catch {
    return null;
  }
  if (!published || typeof published !== 'object' || !Array.isArray(published.keys)) return null;
  type Entry = { id?: unknown; lastDay?: unknown; revoked?: unknown };
  const publishedKeys = new Map(
    (published.keys as Entry[]).filter((entry) => entry && typeof entry === 'object').map((entry) => [entry.id, entry]),
  );
  const earlier = JSON.parse(desired.value) as {
    epoch: number;
    keys: { id: number; revoked: boolean; firstDay: number; lastDay: number }[];
  };
  const differences: string[] = [];
  const publishedEpoch = published.epoch;
  if (
    typeof publishedEpoch === 'number' &&
    Number.isInteger(publishedEpoch) &&
    publishedEpoch >= 0 &&
    publishedEpoch < earlier.epoch
  ) {
    earlier.epoch = publishedEpoch;
    differences.push(`epoch ${publishedEpoch} published`);
  }
  if (pending && !publishedKeys.has(pending.id)) {
    earlier.keys = earlier.keys.filter((key) => key.id !== pending.id);
    differences.push(`pending key ${pending.id} not published`);
  }
  earlier.keys = earlier.keys.filter((key) => {
    if (!key.revoked || publishedKeys.has(key.id)) return true;
    differences.push(`revoked key ${key.id} not published`);
    return false;
  });
  for (const key of earlier.keys) {
    const entry = publishedKeys.get(key.id);
    const lastDay = entry?.lastDay;
    if (
      typeof lastDay === 'number' &&
      Number.isInteger(lastDay) &&
      lastDay > key.lastDay &&
      lastDay <= NON_EXPIRING_LAST_DAY
    ) {
      key.lastDay = lastDay;
      differences.push(`key ${key.id} published through day ${lastDay}`);
    }
    if (key.revoked && entry?.revoked === false) {
      key.revoked = false;
      differences.push(`key ${key.id} revocation not published`);
    }
  }
  if (!earlier.keys.length) return null;
  const value = JSON.stringify(earlier);
  if (!publishedConfigMatches({ ...desired, value }, publishedValue)) return null;
  if (value !== publishedValue) differences.push('destroyed keys with closed windows still published');
  return differences;
}

export function requireIssuanceReady(input: { config: PublicConfig; keyId: number; acceptedDay: number }): void {
  if (!Number.isInteger(input.acceptedDay) || input.acceptedDay < 0 || input.acceptedDay > NON_EXPIRING_LAST_DAY - 2)
    throw new Error('Invalid accepted day');
  const key = input.config.keys.find((candidate) => candidate.id === input.keyId);
  if (key?.state !== 'active' || key.revoked || key.firstDay > input.acceptedDay || key.lastDay < input.acceptedDay + 2)
    throw new Error('Signing key is not issuance ready');
}
