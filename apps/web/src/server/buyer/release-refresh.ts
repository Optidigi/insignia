type Scope = { shopId: string; installationGeneration: string };
type Timer = object;

/** Trusted release records are fresh for 30 s; this never changes that bound. */
export const RELEASE_FRESHNESS_MS = 30_000;
/** A record older than this is refreshed ahead of expiry, leaving room for a ~4.5 s collection. */
export const RELEASE_REFRESH_AFTER_MS = 22_000;
/** At most one refresh start per shop per interval. */
export const RELEASE_REFRESH_INTERVAL_MS = 25_000;

/**
 * Keeps one shop's release evidence warm while its buyers are active, so acceptance usually finds a
 * fresh record instead of collecting on its request path. Off every request path: `touch` never
 * awaits or throws. Per shop: one refresh in flight, at most one start per interval, none after
 * `activeUntil`. A refresh result is a scheduling hint only; acceptance still reads and checks
 * its own record and collects synchronously when that record is stale.
 */
export function createReleaseRefresher(input: {
  /** Refresh if the current record is older than `refreshAfterMs`; resolve to the current record's
   * observation time (ms), or null when none is available. */
  refresh(scope: Scope): Promise<number | null>;
  /** Age at which a record is refreshed (default RELEASE_REFRESH_AFTER_MS, the buyer path's). */
  refreshAfterMs?: number;
  /** At most one refresh start per shop per this long (default RELEASE_REFRESH_INTERVAL_MS). */
  intervalMs?: number;
  /** Whether the shop still needs a refresh when one is due (default: always). A due run that is no
   * longer wanted starts nothing and leaves the shop's last start, so it uses up no interval. */
  wanted?(scope: Scope): boolean;
  clock?: () => number;
  setTimer?: (run: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  const clock = input.clock ?? Date.now;
  const refreshAfterMs = input.refreshAfterMs ?? RELEASE_REFRESH_AFTER_MS;
  const intervalMs = input.intervalMs ?? RELEASE_REFRESH_INTERVAL_MS;
  const setTimer = input.setTimer ?? ((run, delayMs) => setTimeout(run, delayMs));
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const shops = new Map<
    string,
    { scope: Scope; activeUntil: number; lastStart: number; running: boolean; timer?: Timer; dueAt?: number }
  >();
  function schedule(key: string, at: number) {
    const state = shops.get(key);
    if (!state) return;
    state.dueAt = at;
    const timer = setTimer(() => void run(key), Math.max(0, at - clock()));
    (timer as { unref?: () => unknown }).unref?.();
    state.timer = timer;
  }
  async function run(key: string) {
    const state = shops.get(key);
    if (!state) return;
    state.timer = undefined;
    // A timer can fire up to a millisecond before its delay by `clock`; a run before it is due could
    // find nothing to collect yet use up the interval, so it waits out the rest instead.
    if (state.dueAt !== undefined && clock() < state.dueAt) {
      schedule(key, state.dueAt);
      return;
    }
    if (clock() > state.activeUntil) {
      shops.delete(key);
      return;
    }
    if (input.wanted && !input.wanted(state.scope)) {
      // Idle until the next touch; forget the shop once its last start no longer limits one.
      if (clock() >= state.lastStart + intervalMs) shops.delete(key);
      return;
    }
    state.running = true;
    state.lastStart = clock();
    let observedAt: number | null = null;
    try {
      observedAt = await input.refresh(state.scope);
    } catch {
      observedAt = null;
    } finally {
      state.running = false;
    }
    if (clock() > state.activeUntil) {
      shops.delete(key);
      return;
    }
    // Just past the reuse boundary. Production reuses a record only while its age is strictly below
    // `refreshAfterMs`, so a run at exactly that age collects; the +1 ms (with the early-fire guard)
    // keeps a timer that fires early from landing inside the reuse window and spending the interval.
    const due = observedAt !== null && Number.isFinite(observedAt) ? observedAt + refreshAfterMs + 1 : state.lastStart;
    schedule(key, Math.max(state.lastStart + intervalMs, due));
  }
  return {
    touch(scope: Scope, activeUntil: Date) {
      const until = +activeUntil;
      if (!Number.isFinite(until)) return;
      const key = `${scope.shopId}\0${scope.installationGeneration}`;
      const state = shops.get(key);
      if (state) {
        state.activeUntil = Math.max(state.activeUntil, until);
        if (state.running || state.timer) return;
      } else
        shops.set(key, {
          scope: { shopId: scope.shopId, installationGeneration: scope.installationGeneration },
          activeUntil: until,
          lastStart: Number.NEGATIVE_INFINITY,
          running: false,
        });
      schedule(key, Math.max(clock(), (shops.get(key)?.lastStart ?? 0) + intervalMs));
    },
    /** Active shops, for tests and diagnostics. */
    activeShops: () => shops.size,
    close() {
      for (const state of shops.values()) if (state.timer) clearTimer(state.timer);
      shops.clear();
    },
  };
}
