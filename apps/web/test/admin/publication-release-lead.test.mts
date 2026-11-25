import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { resolveRuntimeReleaseProfile } from '@insignia/shopify';
import {
  lastingReleaseRecords,
  PUBLICATION_RELEASE_REFRESH_AFTER_MS,
  PUBLICATION_RELEASE_REFRESH_INTERVAL_MS,
  PUBLICATION_STEP_RELEASE_LEAD_MS,
  releaseLifeStartedAt,
} from '../../src/server/admin/publication-release.ts';
import {
  createDemandDrivenReleaseReader,
  type TrustedReleaseEvidenceRecordsPort,
} from '../../src/server/admin/release-evidence.ts';
import { RELEASE_REFRESH_LEAD_MS } from '../../src/server/admin/release-verification.ts';
import { RELEASE_FRESHNESS_MS, RELEASE_REFRESH_AFTER_MS } from '../../src/server/buyer/release-refresh.ts';

/** The largest publication step the publication-latency test allows (15 serial Admin calls) at
 * production's measured 350 ms a call. */
const STEP_WRITE_BUDGET_MS = 15 * 350;
/** A trusted release collection (spec: ~4.5–6 s). */
const COLLECTION_MS = 5_000;

type Evidence = NonNullable<Awaited<ReturnType<TrustedReleaseEvidenceRecordsPort['read']>>>;

/**
 * One publication step on an injected clock, as production.ts composes it: the demand-driven reader
 * (over `lastingReleaseRecords` unless `raw`), a collector that, like the collector process, answers
 * with a stored record still fresh RELEASE_REFRESH_LEAD_MS ahead and otherwise collects for 5 s, and the release part of
 * the write gate (`publicationAuthorityFresh`) on the step's own evidence after its write budget.
 */
function release(input: { recordAgeMs: number | null; raw?: boolean }) {
  let now = 1_800_000_000_000;
  let stored: { recordId: string; observedAt: number } | null =
    input.recordAgeMs === null ? null : { recordId: randomUUID(), observedAt: now - input.recordAgeMs };
  const source: TrustedReleaseEvidenceRecordsPort = {
    async read(request) {
      const at = request.now.getTime();
      if (!stored || stored.observedAt > at || at - stored.observedAt > RELEASE_FRESHNESS_MS) return null;
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
  const stats = { collections: 0 };
  const binding = {
    shopId: 'tenant',
    installationGeneration: '1',
    appClientId: 'a'.repeat(32),
    authorizationGeneration: randomUUID(),
    authorizationEpoch: 0,
    externalInstallationId: 'gid://shopify/AppInstallation/1',
  };
  const inFlight = new Map<string, Promise<string | null>>();
  const collector = {
    async collect(request: { requestId: string }) {
      const reusable = await source.read({
        scope: binding,
        expectedActiveAppVersionRef: '',
        now: new Date(now + RELEASE_REFRESH_LEAD_MS),
      });
      if (reusable)
        return { requestId: request.requestId, recordId: reusable.record.recordId, state: 'COMPLETE' as const };
      stats.collections++;
      now += COLLECTION_MS;
      stored = { recordId: randomUUID(), observedAt: now - 1_000 };
      return { requestId: request.requestId, recordId: stored.recordId, state: 'COMPLETE' as const };
    },
  };
  const reader = createDemandDrivenReleaseReader({
    records: input.raw ? source : lastingReleaseRecords(source),
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
  return {
    stats,
    inFlight,
    key: JSON.stringify(binding),
    collector,
    /** Release check, then every write of the step until its budget ends; counts refused writes. */
    async step() {
      const evidence = await reader.read({ scope, expectedActiveAppVersionRef, now: new Date(now) });
      assert.ok(evidence, 'the step has a release record');
      let refusedWrites = 0;
      for (let elapsed = 0; elapsed <= STEP_WRITE_BUDGET_MS; elapsed += 350) {
        const at = now + elapsed;
        const observed = Date.parse(evidence.record.attestation.observedAt);
        const expires = Date.parse(evidence.record.attestation.expiresAt);
        if (!(observed <= at && at - observed <= RELEASE_FRESHNESS_MS && at < expires)) refusedWrites++;
      }
      now += STEP_WRITE_BUDGET_MS;
      return { refusedWrites, reused: evidence.record.recordId };
    },
    storedId: () => stored?.recordId ?? null,
  };
}

test('the step lead covers the measured step write budget and stays inside the collector and refresh leads', () => {
  assert.ok(PUBLICATION_STEP_RELEASE_LEAD_MS >= STEP_WRITE_BUDGET_MS);
  // A record the collector answers with (fresh 8 s ahead) also satisfies the step when read back.
  assert.ok(PUBLICATION_STEP_RELEASE_LEAD_MS < RELEASE_REFRESH_LEAD_MS);
  // The publish refresh asks early enough that a 6 s collection lands before steps stop reusing the
  // old record, and the collector answers that ask with a new collection, not the record it replaces.
  assert.ok(PUBLICATION_RELEASE_REFRESH_AFTER_MS + 6_000 <= RELEASE_FRESHNESS_MS - PUBLICATION_STEP_RELEASE_LEAD_MS);
  assert.ok(RELEASE_FRESHNESS_MS - PUBLICATION_RELEASE_REFRESH_AFTER_MS <= RELEASE_REFRESH_LEAD_MS);
  // The interval never delays a refresh the record's age has made due (the next ask comes 17 s after
  // an observation made after the previous start).
  assert.ok(PUBLICATION_RELEASE_REFRESH_INTERVAL_MS <= PUBLICATION_RELEASE_REFRESH_AFTER_MS);
  // The buyer path's ask is unchanged and still covered by the collector's lead.
  assert.equal(RELEASE_REFRESH_AFTER_MS, 22_000);
  assert.ok(RELEASE_FRESHNESS_MS - RELEASE_REFRESH_AFTER_MS <= RELEASE_REFRESH_LEAD_MS);
});

for (const ageMs of [26_000, 27_000, 28_000, 29_000]) {
  test(`a step that starts on a ${ageMs / 1000} s old record collects first and has no refused write`, async () => {
    // Before: the step reused the record and its later writes were refused once it lapsed.
    const before = release({ recordAgeMs: ageMs, raw: true });
    const lapsed = await before.step();
    assert.equal(before.stats.collections, 0);
    assert.ok(lapsed.refusedWrites > 0);

    const after = release({ recordAgeMs: ageMs });
    const old = after.storedId();
    const result = await after.step();
    assert.equal(after.stats.collections, 1, 'the step collected before writing');
    assert.notEqual(result.reused, old);
    assert.equal(result.refusedWrites, 0);
  });
}

test('a step that starts on a record about to lapse joins the in-flight collection, then writes', async () => {
  const model = release({ recordAgeMs: 27_000 });
  const old = model.storedId();
  // The background refresh already started a collection on the shared single-flight map.
  const background = model.collector
    .collect({ requestId: 'background' })
    .then((result) => (result.state === 'COMPLETE' ? result.recordId : null));
  model.inFlight.set(model.key, background);
  const result = await model.step();
  assert.equal(model.stats.collections, 1, 'only the background collection ran');
  assert.notEqual(result.reused, old);
  assert.equal(result.reused, await background);
  assert.equal(result.refusedWrites, 0);
});

for (const ageMs of [0, 10_000, 20_000, 22_000]) {
  test(`a step on a ${ageMs / 1000} s old record still reuses it without collecting`, async () => {
    const model = release({ recordAgeMs: ageMs });
    const old = model.storedId();
    const result = await model.step();
    assert.equal(model.stats.collections, 0);
    assert.equal(result.reused, old);
    assert.equal(result.refusedWrites, 0);
  });
}

test('the step rule only narrows the source: it never returns a record the source refuses', async () => {
  const now = new Date(1_800_000_000_000);
  const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : 'unknown');
  const evidence = (observedAt: number, expiresAt: number) =>
    ({
      record: { recordId: randomUUID(), attestation: { observedAt: iso(observedAt), expiresAt: iso(expiresAt) } },
    }) as never as Evidence;
  const request = {
    scope: { shopId: 't', installationGeneration: '1', appClientId: 'a' },
    expectedActiveAppVersionRef: '',
    now,
  };
  const lasting = (answer: Evidence | null) => lastingReleaseRecords({ read: async () => answer }).read(request);
  assert.equal(await lasting(null), null);
  const t = now.getTime();
  // Fresh for the whole lead: returned unchanged.
  const fresh = evidence(t - 10_000, t + 20_000);
  assert.equal(await lasting(fresh), fresh);
  // Lapses by age within the lead.
  assert.equal(
    await lasting(evidence(t - (RELEASE_FRESHNESS_MS - PUBLICATION_STEP_RELEASE_LEAD_MS) - 1, t + 20_000)),
    null,
  );
  // Lapses by its attested expiry within the lead, though young.
  assert.equal(await lasting(evidence(t - 1_000, t + PUBLICATION_STEP_RELEASE_LEAD_MS)), null);
  // Unparseable attestation.
  assert.equal(await lasting(evidence(Number.NaN, t + 20_000)), null);
});

test('the attested life of a record starts at the earlier of its observation and its expiry less 30 s', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const t = 1_800_000_000_000;
  // Functions observed 5 s before the closing Active observation: expiry 25 s after observedAt.
  assert.equal(releaseLifeStartedAt({ observedAt: iso(t), expiresAt: iso(t + 25_000) }), t - 5_000);
  assert.equal(releaseLifeStartedAt({ observedAt: iso(t), expiresAt: iso(t + RELEASE_FRESHNESS_MS) }), t);
  // Never later than the observation, even if an expiry were attested beyond 30 s.
  assert.equal(releaseLifeStartedAt({ observedAt: iso(t), expiresAt: iso(t + 40_000) }), t);
  assert.equal(releaseLifeStartedAt({ observedAt: 'unknown', expiresAt: iso(t + 25_000) }), t - 5_000);
  assert.equal(releaseLifeStartedAt({ observedAt: 'unknown', expiresAt: 'unknown' }), null);
});
