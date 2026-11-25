import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { resolveRuntimeReleaseProfile } from '@insignia/shopify';
import type { AdminActor } from '../../src/server/admin/contracts.ts';
import {
  createPublicationReleaseRefresh,
  lastingReleaseRecords,
  PUBLICATION_RELEASE_REFRESH_AFTER_MS,
  PUBLICATION_STEP_RELEASE_LEAD_MS,
} from '../../src/server/admin/publication-release.ts';
import {
  createDemandDrivenReleaseReader,
  type TrustedReleaseEvidenceRecordsPort,
} from '../../src/server/admin/release-evidence.ts';
import { RELEASE_REFRESH_LEAD_MS } from '../../src/server/admin/release-verification.ts';
import { RELEASE_FRESHNESS_MS } from '../../src/server/buyer/release-refresh.ts';

type Evidence = NonNullable<Awaited<ReturnType<TrustedReleaseEvidenceRecordsPort['read']>>>;

/** The upper end of measured collection time (3.6–6 s). The new record is observed as the collection
 * starts, the oldest it can be when it lands. */
const COLLECTION_MS = 6_000;
/** Step durations of a first publication at production latency (publication-latency test,
 * `PUBLICATION_LATENCY_MS=350`), repeated to fill the publish. */
const MEASURED_STEPS_MS = [27, 1455, 8, 3574, 2198, 2122, 2127, 2129, 1445, 3258, 377, 4637];
/** The largest step the latency test allows: 15 calls at 350 ms. */
const LARGEST_STEP_MS = 15 * 350;

/**
 * A publish over `spanMs` on an injected clock, composed as production.ts does: the publish refresh
 * (real `createPublicationReleaseRefresh`) reading 13 s ahead, each step reading through
 * `lastingReleaseRecords`, both sharing one single-flight map; a collector that reuses a record still
 * fresh RELEASE_REFRESH_LEAD_MS ahead and otherwise collects for COLLECTION_MS; and the write gate on
 * each step's own evidence every 350 ms of the step.
 */
async function publish(input: { recordAgeMs: number; steps: readonly number[]; spanMs: number }) {
  let now = 1_800_000_000_000;
  const start = now;
  const queue: { at: number; run: () => void }[] = [];
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const setTimer = (run: () => void, delayMs: number) => {
    const timer = { at: now + Math.max(0, delayMs), run };
    queue.push(timer);
    return timer;
  };
  async function advanceTo(end: number) {
    await settle();
    for (;;) {
      const next = queue.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      now = Math.max(now, next.at);
      next.run();
      await settle();
    }
    now = Math.max(now, end);
  }

  let stored = { recordId: randomUUID(), observedAt: now - input.recordAgeMs };
  const source: TrustedReleaseEvidenceRecordsPort = {
    async read(request) {
      const at = request.now.getTime();
      if (stored.observedAt > at || at - stored.observedAt > RELEASE_FRESHNESS_MS) return null;
      return {
        record: {
          recordId: stored.recordId,
          attestation: {
            observedAt: new Date(stored.observedAt).toISOString(),
            expiresAt: new Date(stored.observedAt + RELEASE_FRESHNESS_MS).toISOString(),
          },
        },
      } as never as Evidence;
    },
  };
  const collections: { at: number; ageOfOld: number }[] = [];
  let running = 0;
  let maxConcurrent = 0;
  const collector = {
    async collect(request: { requestId: string }) {
      const reusable = await source.read({
        scope: binding,
        expectedActiveAppVersionRef: '',
        now: new Date(now + RELEASE_REFRESH_LEAD_MS),
      });
      if (reusable)
        return { requestId: request.requestId, recordId: reusable.record.recordId, state: 'COMPLETE' as const };
      collections.push({ at: now - start, ageOfOld: now - stored.observedAt });
      maxConcurrent = Math.max(maxConcurrent, ++running);
      const begun = now;
      await new Promise<void>((resolve) => setTimer(resolve, COLLECTION_MS));
      running--;
      stored = { recordId: randomUUID(), observedAt: begun };
      return { requestId: request.requestId, recordId: stored.recordId, state: 'COMPLETE' as const };
    },
  };
  const binding = {
    shopId: 'tenant',
    installationGeneration: '1',
    appClientId: 'a'.repeat(32),
    authorizationGeneration: randomUUID(),
    authorizationEpoch: 0,
    externalInstallationId: 'gid://shopify/AppInstallation/1',
  };
  const inFlight = new Map<string, Promise<string | null>>();
  const reader = (records: TrustedReleaseEvidenceRecordsPort) =>
    createDemandDrivenReleaseReader({
      records,
      binding,
      collector,
      isCurrent: async () => {},
      deadline: () => now + 300_000,
      now: () => new Date(now),
      inFlight,
    });
  const scope = {
    shopId: binding.shopId,
    installationGeneration: binding.installationGeneration,
    appClientId: binding.appClientId,
  };
  const expectedActiveAppVersionRef = resolveRuntimeReleaseProfile().activeVersionRef;
  const ahead = reader({
    read: (request) =>
      source.read({
        ...request,
        now: new Date(+request.now + RELEASE_FRESHNESS_MS - PUBLICATION_RELEASE_REFRESH_AFTER_MS),
      }),
  });
  const step = reader(lastingReleaseRecords(source));
  const refresh = createPublicationReleaseRefresh<AdminActor>({
    async refresh() {
      const evidence = await ahead.read({ scope, expectedActiveAppVersionRef, now: new Date(now) });
      return evidence ? Date.parse(evidence.record.attestation.observedAt) : null;
    },
    async observedAt() {
      const evidence = await source.read({ scope, expectedActiveAppVersionRef, now: new Date(now) });
      return evidence ? Date.parse(evidence.record.attestation.observedAt) : null;
    },
    clock: () => now,
    setTimer,
  });
  const end = refresh.begin({
    tenantShopId: binding.shopId,
    installationGeneration: binding.installationGeneration,
    expiresAtMs: now + 60_000,
  } as AdminActor);

  const steps: { at: number; ageAtStart: number; waitedMs: number; refusedWrites: number }[] = [];
  for (let index = 0; now - start < input.spanMs; index++) {
    const duration = input.steps[index % input.steps.length] ?? 0;
    const at = now;
    const ageAtStart = now - stored.observedAt;
    let evidence: Evidence | null | undefined;
    void step.read({ scope, expectedActiveAppVersionRef, now: new Date(now) }).then((value) => {
      evidence = value;
    });
    await settle();
    // A step that joined or started a collection waits for it on the request path.
    while (evidence === undefined) {
      assert.ok(queue.length > 0, 'a waiting step has a collection to wait for');
      await advanceTo(Math.min(...queue.map((timer) => timer.at)));
    }
    assert.ok(evidence, 'the step has a release record');
    const checked = now;
    let refusedWrites = 0;
    for (let elapsed = 0; ; elapsed = Math.min(duration, elapsed + 350)) {
      await advanceTo(checked + elapsed);
      const observed = Date.parse(evidence.record.attestation.observedAt);
      const expires = Date.parse(evidence.record.attestation.expiresAt);
      if (!(observed <= now && now - observed <= RELEASE_FRESHNESS_MS && now < expires)) refusedWrites++;
      if (elapsed >= duration) break;
    }
    steps.push({ at: at - start, ageAtStart, waitedMs: checked - at, refusedWrites });
  }
  end();
  refresh.close();
  return { steps, collections, maxConcurrent };
}

for (const [label, steps] of [
  ['measured steps', MEASURED_STEPS_MS],
  ['every step at the 15-call bound', [LARGEST_STEP_MS]],
] as const)
  for (const recordAgeMs of [0, 10_000, 16_000]) {
    test(`a publish on a ${recordAgeMs / 1000} s old record, ${label} over 40 s: no step waits, no refused write`, async (t) => {
      const result = await publish({ recordAgeMs, steps, spanMs: 40_000 });
      t.diagnostic(JSON.stringify(result.collections));
      for (const entry of result.steps) {
        assert.equal(entry.waitedMs, 0, JSON.stringify(entry));
        assert.equal(entry.refusedWrites, 0, JSON.stringify(entry));
        // Every step reused a record that lasts for its lead.
        assert.ok(entry.ageAtStart <= RELEASE_FRESHNESS_MS - PUBLICATION_STEP_RELEASE_LEAD_MS, JSON.stringify(entry));
      }
      // The refresh, not a step, collected; the second refresh of a long publish also landed in time.
      assert.ok(result.collections.length >= 2, JSON.stringify(result.collections));
      for (const collection of result.collections)
        assert.ok(collection.ageOfOld <= PUBLICATION_RELEASE_REFRESH_AFTER_MS + 1, JSON.stringify(collection));
      assert.equal(result.maxConcurrent, 1);
    });
  }

for (const [label, steps] of [
  ['measured steps', MEASURED_STEPS_MS],
  ['every step at the 15-call bound', [LARGEST_STEP_MS]],
] as const)
  test(`a publish on a 20 s old record, ${label} over 40 s: only steps before its first refresh lands wait`, async (t) => {
    // The refresh starts at begin (20 s > 17 s), but a 6 s collection lands at 26 s of age, past the 23 s
    // at which steps stop reusing the old record: a step that starts in between joins it. No step waits
    // after that first refresh, and no write is refused.
    const result = await publish({ recordAgeMs: 20_000, steps, spanMs: 40_000 });
    t.diagnostic(JSON.stringify(result.steps.filter((entry) => entry.waitedMs > 0)));
    const firstLanded = (result.collections[0]?.at ?? Number.NaN) + COLLECTION_MS;
    assert.equal(result.collections[0]?.at, 0, 'the first refresh starts at begin');
    for (const entry of result.steps) {
      assert.equal(entry.refusedWrites, 0, JSON.stringify(entry));
      if (entry.waitedMs > 0) {
        assert.ok(entry.at >= RELEASE_FRESHNESS_MS - PUBLICATION_STEP_RELEASE_LEAD_MS - 20_000, JSON.stringify(entry));
        assert.ok(entry.at + entry.waitedMs <= firstLanded, JSON.stringify(entry));
      }
    }
    assert.ok(result.collections.length >= 2);
    assert.equal(result.maxConcurrent, 1);
  });
