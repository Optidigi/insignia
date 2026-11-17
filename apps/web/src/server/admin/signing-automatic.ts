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

export type AutomaticSigningState = 'READY' | 'PROVISIONED' | 'STOPPED' | 'OWNER_ACTION_REQUIRED';

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
 * covers today needs nothing. A store that has never had a key gets one non-expiring key through the
 * maintained provisioning flow (signer creates it, the public config is published and read back,
 * then the key activates), bound to the publishing staff member's own verified session; a run that
 * stopped is resumed with its own pending key. Everything else (an active key that no longer covers
 * today, keys the owner revoked or retired, an owner's pending rotation) stays an owner operation.
 */
export function createAutomaticSigningProvision(
  ports: Omit<SigningProvisionPorts, 'journal'>,
  options: {
    /** A nonsecret step name (`SIGNING_<STEP>`) for every run that does not end READY or PROVISIONED. */
    onStopped?(stage: string): void;
  } = {},
) {
  const running = new Map<string, Promise<AutomaticSigningState>>();
  function stopped<S extends AutomaticSigningState>(state: S, stage: string): S {
    try {
      options.onStopped?.(`SIGNING_${stage}`);
    } catch {
      /* Reporting never changes the outcome. */
    }
    return state;
  }
  async function run(actor: AdminActor, idToken: string, ianaTimezone: string): Promise<AutomaticSigningState> {
    const scope = await ports.core.signingKeys.getActiveScope(actor.tenantShopId, actor.installationGeneration);
    if (!scope) return stopped('STOPPED', 'NO_ACTIVE_SCOPE');
    const rows = await ports.core.signingKeys.list(scope);
    const day = ports.app.localDay(ports.now(), ianaTimezone).ordinal;
    const active = rows.find((row) => row.state === 'active');
    if (active)
      return active.firstDay <= day && active.lastDay >= day + 2
        ? 'READY'
        : stopped('OWNER_ACTION_REQUIRED', 'ACTIVE_KEY_WINDOW');
    const [only] = rows;
    // Only this flow's own stopped run (one pending, non-expiring key) is resumed, with exactly its plan.
    const resumable = rows.length === 1 && only?.state === 'pending' && only.lastDay === NON_EXPIRING_LAST_DAY;
    if (rows.length && !resumable) return stopped('OWNER_ACTION_REQUIRED', 'OWNER_KEYS');
    const plan = qualifySigningProvisionPlan(
      resumable && only
        ? { keyId: only.id, firstDay: only.firstDay, lastDay: only.lastDay }
        : {
            keyId: 1,
            // A day of slack keeps the key valid if the staff member's and the store's calendars differ.
            firstDay: Math.max(0, day - 1),
            lastDay: NON_EXPIRING_LAST_DAY,
          },
    );
    const journal = memorySigningJournal(plan);
    let step = 'PLAN';
    const result = await provisionSigningKey(plan, idToken, {
      ...ports,
      journal,
      observeStep: (entered) => {
        step = entered;
      },
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
    return result.classification === 'SIGNING_KEY_CONFIG_PROVISIONED' ? 'PROVISIONED' : stopped('STOPPED', step);
  }
  return {
    /** Concurrent publishes on one store share one run; another store runs independently. */
    ensure(actor: AdminActor, idToken: string, ianaTimezone: string): Promise<AutomaticSigningState> {
      assert.ok(actor.canRead && actor.canEdit, 'Signing action unavailable');
      assert.ok(typeof idToken === 'string' && /^[^\s]{1,8192}$/.test(idToken), 'Signing action unavailable');
      const key = `${actor.tenantShopId}:${actor.installationGeneration}`;
      let pending = running.get(key);
      if (!pending) {
        // Any failure before or during provisioning is a refusal with no key, never a server error.
        pending = run(actor, idToken, ianaTimezone)
          .catch(() => stopped('STOPPED', 'UNEXPECTED'))
          .finally(() => running.delete(key));
        running.set(key, pending);
      }
      return pending;
    },
  };
}
