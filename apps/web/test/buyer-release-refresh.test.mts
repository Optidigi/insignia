import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { projectEntitlement } from '../../../packages/application/src/entitlement/provider-policy.ts';
import {
  createReleaseRefresher,
  RELEASE_REFRESH_AFTER_MS,
  RELEASE_REFRESH_INTERVAL_MS,
} from '../src/server/buyer/release-refresh.ts';
import {
  createSubscriptionCache,
  SUBSCRIPTION_CACHE_MS,
  SUBSCRIPTION_FRESHNESS_MARGIN_MS,
  subscriptionReuseMs,
} from '../src/server/buyer/subscription-cache.ts';

/** Deterministic timer queue: `advance` fires due timers in order and drains their async work. */
function timers(start = 1_800_000_000_000) {
  let now = start;
  const queue: { at: number; run: () => void; cancelled: boolean }[] = [];
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    clock: () => now,
    setTimer: (run: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, run, cancelled: false };
      queue.push(timer);
      return timer;
    },
    clearTimer: (timer: { cancelled?: boolean }) => {
      timer.cancelled = true;
    },
    async advance(ms: number) {
      const end = now + ms;
      await settle();
      for (;;) {
        const next = queue.filter((timer) => !timer.cancelled && timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        queue.splice(queue.indexOf(next), 1);
        now = Math.max(now, next.at);
        next.run();
        await settle();
      }
      now = end;
    },
    pending: () => queue.filter((timer) => !timer.cancelled).length,
  };
}
const scope = { shopId: 'tenant', installationGeneration: '1' };

/** A synthetic verifier: collecting takes `durationMs` and observes the Active version 1 s in. */
function verifier(t: ReturnType<typeof timers>, durationMs = 4500) {
  let observedAt: number | null = null;
  const starts: number[] = [];
  return {
    starts,
    record: () => observedAt,
    refresh: async () => {
      if (observedAt !== null && t.clock() - observedAt <= RELEASE_REFRESH_AFTER_MS) return observedAt;
      starts.push(t.clock());
      const begun = t.clock();
      await new Promise<void>((resolve) => t.setTimer(resolve, durationMs));
      observedAt = begun + 1000;
      return observedAt;
    },
  };
}

test('buyer activity refreshes release evidence off the request path and keeps it fresh until idle', async () => {
  const t = timers();
  const v = verifier(t);
  const refresher = createReleaseRefresher({ refresh: v.refresh, clock: t.clock, setTimer: t.setTimer });
  const start = t.clock();
  refresher.touch(scope, new Date(start + 120_000));
  assert.deepEqual(v.starts, [], 'touch never runs a refresh synchronously');
  await t.advance(0);
  assert.deepEqual(v.starts, [start]);
  // After the first collection (4.5 s), sample acceptance instants across the active window.
  await t.advance(5_000);
  let stale = 0;
  for (let at = 5_000; at < 120_000; at += 500) {
    await t.advance(500);
    const observed = v.record();
    if (observed === null || t.clock() - observed > 30_000) stale++;
  }
  assert.equal(stale, 0, 'acceptance finds a fresh record throughout buyer activity');
  const gaps = v.starts.slice(1).map((value, index) => value - (v.starts[index] ?? 0));
  assert.ok(
    gaps.every((gap) => gap >= RELEASE_REFRESH_INTERVAL_MS),
    `≤1 refresh per 25 s: ${gaps}`,
  );
  assert.ok(v.starts.length <= 6, `bounded collections for a 2-minute window: ${v.starts.length}`);
  await t.advance(60_000);
  const after = v.starts.length;
  await t.advance(600_000);
  assert.equal(v.starts.length, after, 'refreshing stops once buyers are idle');
  assert.equal(refresher.activeShops(), 0);
  assert.equal(t.pending(), 0);
});

test('repeated activity extends one shop schedule without overlapping or extra refreshes', async () => {
  const t = timers();
  const v = verifier(t);
  const refresher = createReleaseRefresher({ refresh: v.refresh, clock: t.clock, setTimer: t.setTimer });
  for (let i = 0; i < 50; i++) refresher.touch(scope, new Date(t.clock() + 60_000));
  refresher.touch({ shopId: 'other', installationGeneration: '1' }, new Date(t.clock() + 1));
  await t.advance(0);
  assert.equal(v.starts.length, 2, 'one refresh per shop, however many proposals');
  for (let i = 0; i < 10; i++) {
    await t.advance(3_000);
    refresher.touch(scope, new Date(t.clock() + 60_000));
  }
  const gaps = v.starts.slice(2).map((value, index) => value - (v.starts[index + 1] ?? 0));
  assert.ok(
    gaps.every((gap) => gap >= RELEASE_REFRESH_INTERVAL_MS),
    `touches never shorten the interval: ${gaps}`,
  );
  refresher.close();
  assert.equal(refresher.activeShops(), 0);
});

test('a fresh record is not collected again, and failures retry no sooner than the interval', async () => {
  const t = timers();
  let calls = 0;
  const observed = t.clock() - 5_000;
  const refresher = createReleaseRefresher({
    clock: t.clock,
    setTimer: t.setTimer,
    refresh: async () => {
      calls++;
      if (calls === 1) return observed;
      throw new Error('Synthetic verifier unavailable');
    },
  });
  refresher.touch(scope, new Date(t.clock() + 60_000));
  await t.advance(0);
  assert.equal(calls, 1);
  await t.advance(RELEASE_REFRESH_INTERVAL_MS - 1);
  assert.equal(calls, 1, 'next check waits for the interval');
  await t.advance(1);
  assert.equal(calls, 2);
  await t.advance(RELEASE_REFRESH_INTERVAL_MS - 1);
  assert.equal(calls, 2, 'a failure does not retry early');
  await t.advance(1);
  assert.equal(calls, 3);
  refresher.close();
});

test('Partner subscription reads are reused per shop for 60 s, single-flight, and never cache failures', async () => {
  let now = Date.parse('2026-11-10T00:00:00.000Z'),
    reads = 0,
    fail = false;
  const cache = createSubscriptionCache(
    async (target: { appId: string; shopId: string }) => {
      reads++;
      await new Promise((resolve) => setImmediate(resolve));
      if (fail) throw new Error('Synthetic Partner outage');
      return { shopId: target.shopId, observedAt: new Date(now).toISOString() };
    },
    65_000,
    () => now,
  );
  const target = { appId: 'gid://shopify/App/7', shopId: 'gid://shopify/Shop/9' };
  const [first, second] = await Promise.all([cache(target), cache(target)]);
  assert.equal(reads, 1, 'concurrent reads share one Partner call');
  assert.equal(second, first);
  now += SUBSCRIPTION_CACHE_MS - 1;
  assert.equal(await cache(target), first);
  assert.equal((await cache({ ...target, shopId: 'gid://shopify/Shop/10' })) === first, false);
  assert.equal(reads, 2, 'another shop is read independently');
  now += 1;
  fail = true;
  await assert.rejects(cache(target), /Synthetic Partner outage/);
  await assert.rejects(cache(target), /Synthetic Partner outage/);
  assert.equal(reads, 4, 'a failure is never reused');
  fail = false;
  const renewed = await cache(target);
  assert.notEqual(renewed, first);
  assert.equal(renewed.observedAt, new Date(now).toISOString(), 'the snapshot keeps its true observation time');
});

test('the subscription cache never serves a snapshot the entitlement policy would call stale', () => {
  // The deployed policy keeps the owner's 60 s reuse with a 5 s margin.
  const deployed = JSON.parse(
    readFileSync(new URL('../../../deployment/m5-runtime/entitlement-policy.json', import.meta.url), 'utf8'),
  ) as { maxAgeMs: number };
  assert.equal(deployed.maxAgeMs, 65_000);
  assert.equal(subscriptionReuseMs(deployed.maxAgeMs), SUBSCRIPTION_CACHE_MS);
  for (const maxAgeMs of [1, 4_000, 5_000, 30_000, 64_999, 65_000, 300_000])
    assert.ok(
      subscriptionReuseMs(maxAgeMs) <= maxAgeMs - SUBSCRIPTION_FRESHNESS_MARGIN_MS ||
        subscriptionReuseMs(maxAgeMs) === 0,
      String(maxAgeMs),
    );
  assert.equal(subscriptionReuseMs(30_000), 25_000);
  assert.throws(() => subscriptionReuseMs(0), /policy age invalid/);
});

test('a proposal 45 s after the last Partner read gets a fresh entitlement (regression: cached snapshot past maxAgeMs)', async () => {
  const start = Date.parse('2026-11-11T12:00:00.000Z');
  for (const maxAgeMs of [30_000, 65_000]) {
    let now = start,
      reads = 0;
    const identity = {
      appId: 'gid://shopify/App/7',
      shopId: 'gid://shopify/Shop/9',
      tenantShopId: 'tenant',
      installationGeneration: '1',
    };
    const cache = createSubscriptionCache(
      async () => {
        reads++;
        return {
          ...identity,
          schemaVersion: 'm4-active-subscription-v1' as const,
          sourceApiVersion: '2026-07' as const,
          observedAt: new Date(now).toISOString(),
          active: true,
          billingPeriod: 'EVERY_30_DAYS',
          cancelAtEndOfCycle: false,
          trialEndsAt: null,
          currentBillingCycle: null,
          items: [],
          pendingUpdate: null,
        };
      },
      maxAgeMs,
      () => now,
    );
    await cache(identity);
    now = start + 45_000;
    const snapshot = await cache(identity);
    const projected = projectEntitlement(
      snapshot as never,
      { policyVersion: 'p', maxAgeMs, plans: [] },
      { ...identity, now: new Date(now) },
    );
    assert.equal(projected.freshness, 'fresh', `maxAgeMs ${maxAgeMs}`);
    assert.equal(
      reads,
      maxAgeMs === 30_000 ? 2 : 1,
      'a short policy forces a re-read instead of serving a stale snapshot',
    );
  }
});

test('immutable revision reads are reused per shop and revision; missing rows and failures are re-read', async () => {
  const { createRevisionReads } = await import('../src/server/buyer/revision-cache.ts');
  let now = 0,
    reads = 0,
    fail = false;
  const configs = {
    getRevisionPresentation: async (shopId: string, revisionId: string) => {
      reads++;
      if (fail) throw new Error('Synthetic database outage');
      return revisionId === 'missing' ? null : ({ shopId, revisionId } as never);
    },
    getRevisionGeometry: async () => null,
    getValidatedPublishedRevision: async () => null,
  };
  const cached = createRevisionReads(configs, () => now);
  const [a, b] = await Promise.all([
    cached.getRevisionPresentation('tenant', 'r1'),
    cached.getRevisionPresentation('tenant', 'r1'),
  ]);
  assert.equal(a, b);
  assert.equal(reads, 1);
  await cached.getRevisionPresentation('other', 'r1');
  assert.equal(reads, 2, 'shops never share an entry');
  await cached.getRevisionPresentation('tenant', 'missing');
  await cached.getRevisionPresentation('tenant', 'missing');
  assert.equal(reads, 4, 'a missing row is not reused');
  fail = true;
  await assert.rejects(cached.getRevisionPresentation('tenant', 'r2'));
  fail = false;
  await cached.getRevisionPresentation('tenant', 'r2');
  assert.equal(reads, 6, 'a failure is not reused');
  now += 10 * 60_000;
  await cached.getRevisionPresentation('tenant', 'r1');
  assert.equal(reads, 7, 'entries expire');
});
