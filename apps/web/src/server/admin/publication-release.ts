import { AsyncLocalStorage } from 'node:async_hooks';
import { createReleaseRefresher, RELEASE_FRESHNESS_MS } from '../buyer/release-refresh.ts';
import { outsidePublicationTiming } from './publication-timing.ts';
import type { TrustedReleaseEvidenceRecordsPort } from './release-evidence.ts';

type Publisher = { tenantShopId: string; installationGeneration: string; expiresAtMs: number };
type Timer = object;

/**
 * A publication step (preparation, or one publication or activation advance) reuses a stored release
 * record only while it stays fresh for this much longer, so the record cannot lapse between the step's
 * release check and its last provider write (which the release write gate checks on that same record).
 * Otherwise the step joins an in-flight collection or collects first.
 *
 * Sized from the measured step write budget: the largest advance is 13 serial Admin calls, 4.6 s at
 * production's measured 350 ms a call (publication-latency test, `PUBLICATION_LATENCY_MS=350`), and
 * that test bounds it at 15 calls (5.25 s); the rest is headroom for database work and slower calls.
 * It stays below the collector's reuse lead (RELEASE_REFRESH_LEAD_MS, 13 s): a record the collector
 * answers with instead of collecting still lasts that long, so it also satisfies this lead when the
 * step reads it back. The publish refresh (below) lands a new record before steps need one.
 */
export const PUBLICATION_STEP_RELEASE_LEAD_MS = 7_000;

/**
 * The publish refresh asks for a new record once the stored one is this old, so the new one lands
 * before steps stop reusing the old one at 30 - 7 = 23 s: 23 s less a 6 s collection, the upper end of
 * the measured 3.6-6 s (#345's cold path took 3.6-5 s; spec 4.5-6 s). Earlier than the buyer path's
 * RELEASE_REFRESH_AFTER_MS (22 s), which stays unchanged; the collector's reuse lead
 * (RELEASE_REFRESH_LEAD_MS, 13 s = 30 - 17) is sized so this ask is answered with a new collection.
 */
export const PUBLICATION_RELEASE_REFRESH_AFTER_MS = 17_000;
/**
 * At most one publish refresh start per shop per this long. Below the 17 s ask, so the next refresh
 * of a long publish is timed by the record's age (17 s after it was observed, which is after the
 * previous start) and lands before 23 s; with the buyer path's 25 s the second refresh would start at
 * 20-24 s of age and land after steps stop reusing the record. It still bounds a failing collector to
 * one start per 15 s (at most four in a publish's 60 s budget), one in flight per shop.
 */
export const PUBLICATION_RELEASE_REFRESH_INTERVAL_MS = 15_000;

/**
 * The records a publication step may reuse: the source's own answer (unchanged 30 s bound, read at the
 * real time) and, in addition, only a record that is still fresh PUBLICATION_STEP_RELEASE_LEAD_MS from
 * now under the same bound and its attested expiry. Strictly narrower than `records`; a record that
 * would lapse within the lead reads as missing, so the demand-driven reader collects (or joins).
 */
export function lastingReleaseRecords(
  records: TrustedReleaseEvidenceRecordsPort,
  leadMs: number = PUBLICATION_STEP_RELEASE_LEAD_MS,
): TrustedReleaseEvidenceRecordsPort {
  return {
    async read(request) {
      const evidence = await records.read(request);
      if (!evidence) return null;
      const until = request.now.getTime() + leadMs;
      const observed = Date.parse(evidence.record.attestation.observedAt);
      const expires = Date.parse(evidence.record.attestation.expiresAt);
      return Number.isFinite(observed) &&
        Number.isFinite(expires) &&
        until - observed <= RELEASE_FRESHNESS_MS &&
        until < expires
        ? evidence
        : null;
    },
  };
}

/**
 * When a record's 30-second life began, for timing its refresh: its Active observation, or earlier
 * when its attested expiry comes sooner. The collector attests expiry from its earliest observation
 * (Functions, then the closing Active observation; `append.mts` takes the minimum), so a record lives
 * 30 s less the gap between them, and steps stop reusing it 7 s before that expiry. Null when the
 * attestation has neither time.
 */
export function releaseLifeStartedAt(attestation: { observedAt: string; expiresAt: string }): number | null {
  const starts = [Date.parse(attestation.observedAt), Date.parse(attestation.expiresAt) - RELEASE_FRESHNESS_MS].filter(
    Number.isFinite,
  );
  return starts.length ? Math.min(...starts) : null;
}

/** The server's publish deadline (PUBLICATION_REQUEST_DEADLINE_MS, 60 s after the request was accepted;
 * owner decision, 25 Nov 2026); a publish's background refresh never outlives it. */
export const PUBLICATION_RELEASE_ACTIVE_MS = 60_000;

/**
 * Keeps a shop's trusted release record fresh while a publish request for it is in progress, with
 * a separate instance of the buyer path's refresher (its own single-flight state): per shop one
 * refresh in flight, at most one start per 15 s, and a new record asked for once the stored one is
 * 17 s old (PUBLICATION_RELEASE_REFRESH_AFTER_MS and _INTERVAL_MS). It is only a hint: every publication step still reads and checks its own record under
 * the unchanged 30-second bound, joins an in-flight collection (`refresh` shares production's
 * single-flight map) or collects synchronously, and fails closed without one. No refresh starts
 * once the last publish for the shop has ended; one already started then may still dispatch its
 * collection, bounded by that publish's session deadline. A due refresh that finds no publish in
 * progress starts nothing and does not use up the interval. The refresh runs outside the
 * request's async context, so it adds no request timing span.
 * A record still fresh when the publish begins is first refreshed once it is 17 s old, not at once:
 * a start that finds nothing to collect would still use up the shop's interval.
 */
export function createPublicationReleaseRefresh<A extends Publisher>(input: {
  /** Collect when the actor's stored record is older than PUBLICATION_RELEASE_REFRESH_AFTER_MS;
   * resolve to the current record's life start (`releaseLifeStartedAt`, ms), or null when none is
   * available. */
  refresh(actor: A): Promise<number | null>;
  /** The stored record's life start (`releaseLifeStartedAt`, ms) while it is fresh, without
   * collecting; else null. */
  observedAt(actor: A): Promise<number | null>;
  clock?: () => number;
  setTimer?: (run: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  const clock = input.clock ?? Date.now;
  const setTimer = input.setTimer ?? ((run, delayMs) => setTimeout(run, delayMs));
  // The context at composition (admin services compose lazily, on the first admin, purchase or
  // customer-artwork request that needs them), never a publish request's own: begin and every timer
  // run their work in it, and explicitly outside any publish request's timing, so a refresh is never
  // attributed to the request that began it nor to the one that composed the services.
  const composed = AsyncLocalStorage.snapshot();
  function detached<T>(run: () => T): T {
    return composed(() => outsidePublicationTiming(run));
  }
  const publishing: Map<string, A[]> = new Map();
  const key = (scope: { shopId: string; installationGeneration: string }) =>
    `${scope.shopId}\0${scope.installationGeneration}`;
  const publisher = (scope: { shopId: string; installationGeneration: string }) => {
    const now = clock();
    // The publish whose session lasts longest; null when none is in progress.
    return (publishing.get(key(scope)) ?? [])
      .filter((candidate) => candidate.expiresAtMs > now)
      .reduce<A | null>(
        (best, candidate) => (best && best.expiresAtMs >= candidate.expiresAtMs ? best : candidate),
        null,
      );
  };
  const refresher = createReleaseRefresher({
    async refresh(scope) {
      const actor = publisher(scope);
      return actor ? input.refresh(actor) : null;
    },
    wanted: (scope) => publisher(scope) !== null,
    refreshAfterMs: PUBLICATION_RELEASE_REFRESH_AFTER_MS,
    intervalMs: PUBLICATION_RELEASE_REFRESH_INTERVAL_MS,
    clock,
    setTimer: (run, delayMs) => setTimer(() => detached(run), delayMs),
    ...(input.clearTimer ? { clearTimer: input.clearTimer } : {}),
  });
  const inProgress = (shop: string, actor: A) => publishing.get(shop)?.includes(actor) ?? false;
  async function start(actor: A, scope: { shopId: string; installationGeneration: string }, until: number) {
    const shop = key(scope);
    let at = clock();
    try {
      const observed = await input.observedAt(actor);
      // Just past the age the refresh reuses (a record is fresh up to and including 30 s).
      if (observed !== null && Number.isFinite(observed))
        at = Math.max(at, observed + PUBLICATION_RELEASE_REFRESH_AFTER_MS + 1);
    } catch {
      /* Unknown age: refresh now; the refresh itself reads the record again. */
    }
    if (at > until) return;
    const touch = () => {
      if (inProgress(shop, actor)) refresher.touch(scope, new Date(until));
    };
    // A timer can fire up to a millisecond before its delay by `clock`; touching before `at` would
    // start a refresh that finds nothing to collect yet uses up the shop's interval.
    const arm = () => {
      if (at <= clock()) return touch();
      const timer = setTimer(() => detached(arm), at - clock());
      (timer as { unref?: () => unknown }).unref?.();
    };
    arm();
  }
  return {
    /** A publish request for this actor is in progress until the returned `end` runs. Never awaits or throws. */
    begin(actor: A): () => void {
      const scope = { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration };
      const shop = key(scope);
      publishing.set(shop, [...(publishing.get(shop) ?? []), actor]);
      const until = Math.min(actor.expiresAtMs, clock() + PUBLICATION_RELEASE_ACTIVE_MS);
      detached(() => void start(actor, scope, until));
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        const remaining = (publishing.get(shop) ?? []).filter((candidate) => candidate !== actor);
        if (remaining.length) publishing.set(shop, remaining);
        else publishing.delete(shop);
      };
    },
    close() {
      refresher.close();
      publishing.clear();
    },
  };
}
