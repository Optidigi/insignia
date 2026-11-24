import { AsyncLocalStorage } from 'node:async_hooks';
import { createReleaseRefresher, RELEASE_REFRESH_AFTER_MS } from '../buyer/release-refresh.ts';
import { outsidePublicationTiming } from './publication-timing.ts';

type Publisher = { tenantShopId: string; installationGeneration: string; expiresAtMs: number };
type Timer = object;

/** A publish request's longest client budget (§7.1); its background refresh never outlives it. */
export const PUBLICATION_RELEASE_ACTIVE_MS = 60_000;

/**
 * Keeps a shop's trusted release record fresh while a publish request for it is in progress, with
 * a separate instance of the buyer path's refresher (its own single-flight state): per shop one
 * refresh in flight, at most one start per 25 s, and a new record asked for once the stored one is
 * 22 s old. It is only a hint: every publication step still reads and checks its own record under
 * the unchanged 30-second bound, joins an in-flight collection (`refresh` shares production's
 * single-flight map) or collects synchronously, and fails closed without one. No refresh starts
 * once the last publish for the shop has ended; one already started then may still dispatch its
 * collection, bounded by that publish's session deadline. A due refresh that finds no publish in
 * progress starts nothing and does not use up the 25-second interval. The refresh runs outside the
 * request's async context, so it adds no request timing span.
 * A record still fresh when the publish begins is first refreshed once it is 22 s old, not at once:
 * a start that finds nothing to collect would still use up the shop's 25-second interval.
 */
export function createPublicationReleaseRefresh<A extends Publisher>(input: {
  /** Collect when the actor's stored record is older than RELEASE_REFRESH_AFTER_MS; resolve to the
   * current record's observation time (ms), or null when none is available. */
  refresh(actor: A): Promise<number | null>;
  /** The stored record's observation time (ms) while it is fresh, without collecting; else null. */
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
      if (observed !== null && Number.isFinite(observed)) at = Math.max(at, observed + RELEASE_REFRESH_AFTER_MS + 1);
    } catch {
      /* Unknown age: refresh now; the refresh itself reads the record again. */
    }
    if (at > until) return;
    const touch = () => {
      if (inProgress(shop, actor)) refresher.touch(scope, new Date(until));
    };
    if (at <= clock()) touch();
    else {
      const timer = setTimer(() => detached(touch), at - clock());
      (timer as { unref?: () => unknown }).unref?.();
    }
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
