import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import {
  createPublicationReleaseRefresh,
  PUBLICATION_RELEASE_REFRESH_AFTER_MS,
} from '../../src/server/admin/publication-release.ts';
import { publicationStage, timePublication } from '../../src/server/admin/publication-timing.ts';
import { RELEASE_REFRESH_LEAD_MS } from '../../src/server/admin/release-verification.ts';
import { RELEASE_FRESHNESS_MS } from '../../src/server/buyer/release-refresh.ts';

/**
 * Deterministic timer queue: `advance` fires due timers in order and drains their async work. With
 * `earlyMs`, a timer fires that much before its delay (never in the instant it was set), as Node's
 * timers can by up to 1 ms against Date.now().
 */
function timers(start = 1_800_000_000_000, earlyMs = 0) {
  let now = start;
  const queue: { at: number; run: () => void }[] = [];
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    clock: () => now,
    setTimer: (run: () => void, delayMs: number) => {
      const timer = { at: now + Math.max(Math.min(delayMs, 1), delayMs - earlyMs), run };
      queue.push(timer);
      return timer;
    },
    async advance(ms: number) {
      const end = now + ms;
      await settle();
      for (;;) {
        const next = queue.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        queue.splice(queue.indexOf(next), 1);
        now = Math.max(now, next.at);
        next.run();
        await settle();
      }
      now = end;
    },
  };
}

/** A synthetic collector behind the refresh: collecting takes 5 s and observes 1 s in. */
function collector(t: ReturnType<typeof timers>, options: { fail?: boolean; observedAt?: number } = {}) {
  let observedAt: number | null = options.observedAt ?? null;
  let running = 0;
  const starts: { at: number; staff: string }[] = [];
  let maxConcurrent = 0;
  return {
    starts,
    maxConcurrent: () => maxConcurrent,
    async observedAt() {
      return observedAt !== null && t.clock() - observedAt <= 30_000 ? observedAt : null;
    },
    async refresh(actor: { staffId: string }) {
      // As the collector process: reuse a record that stays fresh (≤ 30 s) for another 13 s.
      if (observedAt !== null && t.clock() - observedAt <= RELEASE_FRESHNESS_MS - RELEASE_REFRESH_LEAD_MS)
        return observedAt;
      starts.push({ at: t.clock(), staff: actor.staffId });
      maxConcurrent = Math.max(maxConcurrent, ++running);
      const begun = t.clock();
      try {
        await new Promise<void>((resolve) => t.setTimer(resolve, 5_000));
        if (options.fail) throw new Error('Publication verification unavailable');
        observedAt = begun + 1_000;
        return observedAt;
      } finally {
        running--;
      }
    },
  };
}

const actor = (t: ReturnType<typeof timers>, staffId = 'staff-1', sessionMs = 60_000) => ({
  tenantShopId: 'tenant',
  installationGeneration: '1',
  staffId,
  expiresAtMs: t.clock() + sessionMs,
});
type Staff = ReturnType<typeof actor>;

test('a publish in progress keeps its release record fresh in the background, and stops when it ends', async () => {
  const t = timers();
  const c = collector(t);
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const start = t.clock();
  const end = refresh.begin(actor(t));
  assert.equal(c.starts.length, 0, 'begin never collects on the request path');
  await t.advance(0);
  assert.deepEqual(
    c.starts.map((entry) => entry.at - start),
    [0],
  );
  // A 40 s publish: the record (observed 1 s into each collection) is asked for again just past 17 s
  // of age, so each new one lands at 22 s, before steps stop reusing the old one at 23 s.
  await t.advance(40_000);
  assert.deepEqual(
    c.starts.map((entry) => entry.at - start),
    [0, 18_001, 36_002],
  );
  end();
  // After the publish ends nothing more is collected, though its session is still valid.
  await t.advance(120_000);
  assert.equal(c.starts.length, 3);
  refresh.close();
});

test('concurrent publishes on one shop share one refresh; a later publish does not start another early', async () => {
  const t = timers();
  const c = collector(t);
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const start = t.clock();
  const first = refresh.begin(actor(t, 'staff-1', 30_000));
  await t.advance(1_000);
  const second = refresh.begin(actor(t, 'staff-2', 60_000));
  await t.advance(10_000);
  assert.equal(c.starts.length, 1, 'one collection in flight per shop');
  first();
  await t.advance(30_000);
  // The second publish keeps it fresh under its own session after the first ends.
  assert.deepEqual(
    c.starts.map((entry) => [entry.at - start, entry.staff]),
    [
      [0, 'staff-1'],
      [18_001, 'staff-2'],
      [36_002, 'staff-2'],
    ],
  );
  assert.equal(c.maxConcurrent(), 1);
  second();
  refresh.close();
});

test('a failing refresh never reaches the publish and is not retried within 15 s', async () => {
  const t = timers();
  const c = collector(t, { fail: true });
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const start = t.clock();
  const end = refresh.begin(actor(t));
  await t.advance(30_000);
  assert.deepEqual(
    c.starts.map((entry) => entry.at - start),
    [0, 15_000, 30_000],
  );
  end();
  refresh.close();
});

test('a record still fresh when the publish begins is refreshed once it is 17 s old, before steps need one', async () => {
  const t = timers();
  const start = t.clock();
  // Observed 10 s before the publish: steps stop reusing it 13 s into the publish (23 s of age).
  const c = collector(t, { observedAt: start - 10_000 });
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const end = refresh.begin(actor(t));
  await t.advance(30_000);
  // Asked just past 17 s of age (7 s in), so the new record lands 12 s in, before steps stop reusing the old one.
  assert.deepEqual(
    c.starts.map((entry) => entry.at - start),
    [7_001, 25_002],
  );
  end();
  refresh.close();
});

test('a deferred refresh whose timer fires early still waits until the record is past 17 s, so it collects', async () => {
  const t = timers(undefined, 1);
  const start = t.clock();
  const observed = start - 10_000;
  const c = collector(t, { observedAt: observed });
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const end = refresh.begin(actor(t));
  await t.advance(30_000);
  // Run at 17 s of age it would find nothing to collect yet use up the 15 s interval, and steps would
  // stop reusing the record 13 s into the publish with no refresh until 22 s in.
  const first = (c.starts[0]?.at ?? Number.NaN) - observed;
  assert.ok(
    first > PUBLICATION_RELEASE_REFRESH_AFTER_MS && first <= PUBLICATION_RELEASE_REFRESH_AFTER_MS + 2,
    `first collection at age ${first}`,
  );
  end();
  refresh.close();
});

test('the refresh runs outside the async context of the request that began it', async () => {
  const request = new AsyncLocalStorage<string>();
  const seen: (string | undefined)[] = [];
  const refresh = createPublicationReleaseRefresh({
    async refresh() {
      seen.push(request.getStore());
      return null;
    },
    async observedAt() {
      seen.push(request.getStore());
      return null;
    },
  });
  let end = () => {};
  request.run('publish-request', () => {
    end = refresh.begin({ tenantShopId: 'tenant', installationGeneration: '1', expiresAtMs: Date.now() + 60_000 });
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, [undefined, undefined]);
  end();
  refresh.close();
});

test('a refresh due after the last publish ended starts nothing and leaves the next publish its refresh', async () => {
  const t = timers();
  const start = t.clock();
  const c = collector(t, { observedAt: start - 10_000 });
  const refresh = createPublicationReleaseRefresh<Staff>({ ...c, clock: t.clock, setTimer: t.setTimer });
  const first = refresh.begin(actor(t));
  await t.advance(10_000);
  first();
  // The next refresh falls due 25 s in with no publish in progress: it collects nothing.
  await t.advance(20_000);
  assert.equal(c.starts.length, 1);
  // A publish 30 s in, on a record 22 s old, gets its refresh at once, not 15 s after the idle run.
  const second = refresh.begin(actor(t, 'staff-2'));
  await t.advance(10_000);
  assert.deepEqual(
    c.starts.map((entry) => [entry.at - start, entry.staff]),
    [
      [7_001, 'staff-1'],
      [30_000, 'staff-2'],
    ],
  );
  second();
  refresh.close();
});

test('a refresh adds no span to the publish that began it or to a request that composed the services', async () => {
  const reports: string[][] = [];
  const report = (timing: { spans: { stage: string }[] }) => reports.push(timing.spans.map((span) => span.stage));
  const accepted = () => ({ outcome: 'accepted' as const });
  const refreshed = Promise.withResolvers<void>();
  const composed = Promise.withResolvers<ReturnType<typeof createPublicationReleaseRefresh>>();
  // Composed lazily inside a request's timing context that is still in progress when the refresh runs.
  const composing = timePublication(
    async () => {
      composed.resolve(
        createPublicationReleaseRefresh({
          async refresh() {
            await publicationStage('release-collect', async () => {});
            refreshed.resolve();
            return null;
          },
          observedAt: async () => null,
        }),
      );
      await refreshed.promise;
    },
    accepted,
    report,
  );
  const refresh = await composed.promise;
  await timePublication(
    async () => {
      const end = refresh.begin({
        tenantShopId: 'tenant',
        installationGeneration: '1',
        expiresAtMs: Date.now() + 60_000,
      });
      await refreshed.promise;
      end();
    },
    accepted,
    report,
  );
  await composing;
  assert.deepEqual(reports, [[], []]);
  refresh.close();
});
