import assert from 'node:assert/strict';
import type { AdminActor } from './contracts.js';
import {
  hash,
  provisionSigningKey,
  qualifySigningProvisionPlan,
  type SigningProvisionJournal,
  type SigningProvisionPlan,
  type SigningProvisionPorts,
  type SigningProvisionResult,
} from './signing-provision.ts';

/** Owner decision, 11 November 2026: signing keys do not expire routinely. */
export const NON_EXPIRING_LAST_DAY = 0x7fffffff;

export type AutomaticSigningState = 'READY' | 'PROVISIONED' | 'STOPPED' | 'ROTATION_REQUIRED';

/** One run's in-memory journal. The durable truth is the key row and the published config: a stopped
 * run leaves at most a pending key, which the next run resumes with the same plan (#334). */
export function memorySigningJournal(plan: SigningProvisionPlan): SigningProvisionJournal & {
  entries: readonly string[];
  result(): SigningProvisionResult | null;
} {
  const entries: string[] = [];
  const reserved = new Set<string>();
  let finished: SigningProvisionResult | null = null;
  return {
    planSha256: hash(qualifySigningProvisionPlan(plan)),
    entries,
    async reserve(operation) {
      assert.ok(!reserved.has(operation));
      reserved.add(operation);
      entries.push(operation);
      return { durable: true, operation };
    },
    async settle(operation, outcome) {
      assert.ok(reserved.has(operation));
      entries.push(`${operation}:${outcome}`);
    },
    async record(name) {
      entries.push(`record:${name}`);
    },
    async finish(result) {
      finished = result;
    },
    result: () => finished,
  };
}

/**
 * Gives a store its first signing key when it first publishes. A store with an active key that
 * covers today needs nothing. A store without any active key gets a non-expiring key through the
 * maintained provisioning flow (signer creates it, the public config is published and read back,
 * then the key activates), bound to the publishing staff member's own verified session. Rotation of
 * an existing key stays an owner operation and is never started here.
 */
export function createAutomaticSigningProvision(ports: Omit<SigningProvisionPorts, 'journal'>) {
  const running = new Map<string, Promise<AutomaticSigningState>>();
  async function run(actor: AdminActor, idToken: string, ianaTimezone: string): Promise<AutomaticSigningState> {
    const scope = await ports.core.signingKeys.getActiveScope(actor.tenantShopId, actor.installationGeneration);
    assert.ok(scope, 'Signing installation unavailable');
    const rows = await ports.core.signingKeys.list(scope);
    const day = ports.app.localDay(ports.now(), ianaTimezone).ordinal;
    const active = rows.find((row) => row.state === 'active');
    if (active) return active.firstDay <= day && active.lastDay >= day + 2 ? 'READY' : 'ROTATION_REQUIRED';
    // A stopped earlier run left its pending key: resume with exactly its plan.
    const pending = rows.find((row) => row.state === 'pending');
    const plan = qualifySigningProvisionPlan(
      pending
        ? { keyId: pending.id, firstDay: pending.firstDay, lastDay: pending.lastDay }
        : {
            keyId: Math.max(0, ...rows.map((row) => row.id)) + 1,
            // A day of slack keeps the key valid if the staff member's and the store's calendars differ.
            firstDay: Math.max(0, day - 1),
            lastDay: NON_EXPIRING_LAST_DAY,
          },
    );
    const journal = memorySigningJournal(plan);
    const result = await provisionSigningKey(plan, idToken, {
      ...ports,
      journal,
      identity: {
        // The session token must be this publishing staff member's, on this store.
        async verify(token) {
          const verified = await ports.identity.verify(token);
          for (const field of ['shop', 'staffId', 'sessionId'] as const) assert.equal(verified[field], actor[field]);
          return verified;
        },
        exchangeOnline: (token, verified) => ports.identity.exchangeOnline(token, verified),
        async readInstallation(grant) {
          const observed = await ports.identity.readInstallation(grant);
          for (const field of ['shop', 'shopId', 'installationId'] as const)
            assert.equal(observed[field], actor[field]);
          return observed;
        },
      },
    });
    return result.classification === 'SIGNING_KEY_CONFIG_PROVISIONED' ? 'PROVISIONED' : 'STOPPED';
  }
  return {
    /** Concurrent publishes on one store share one run; another store runs independently. */
    ensure(actor: AdminActor, idToken: string, ianaTimezone: string): Promise<AutomaticSigningState> {
      assert.ok(actor.canRead && actor.canEdit, 'Signing action unavailable');
      assert.ok(typeof idToken === 'string' && /^[^\s]{1,8192}$/.test(idToken), 'Signing action unavailable');
      const key = `${actor.tenantShopId}:${actor.installationGeneration}`;
      let pending = running.get(key);
      if (!pending) {
        pending = run(actor, idToken, ianaTimezone).finally(() => running.delete(key));
        running.set(key, pending);
      }
      return pending;
    },
  };
}
