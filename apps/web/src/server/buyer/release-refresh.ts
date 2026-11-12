import { RELEASE_REFRESH_LEAD_MS } from '@insignia/shopify';

type Scope = { shopId: string; installationGeneration: string };
type Timer = object;

/** Trusted release records are fresh for 30 s from their earliest observation; this never changes that bound. */
const RELEASE_FRESHNESS_MS = 30_000;
/** At most one collecting refresh per shop per interval, and the retry delay after a failed refresh. */
export const RELEASE_REFRESH_INTERVAL_MS = 25_000;

/**
 * Keeps one shop's release evidence warm while its buyers are active, so acceptance usually finds a
 * fresh record instead of collecting on its request path. Off every request path: `touch` never
 * awaits or throws. Per shop: one refresh in flight, none after `activeUntil`. The next refresh
 * starts `RELEASE_REFRESH_LEAD_MS` before the stored record lapses (its attestation `expiresAt`,
 * the earliest observation + 30 s), at most one interval after the previous refresh that collected
 * (a record observed after that refresh started). When a refresh brings no record
 * that outlasts the lead (a failed collection, or a receiver that still reuses the old record), the
 * next one starts as the stored record lapses. A refresh result is a scheduling hint only:
 * acceptance still reads and checks its own record and collects synchronously when it is stale.
 */
export function createReleaseRefresher(input: {
  /** Refresh if the stored record lapses within RELEASE_REFRESH_LEAD_MS; resolve to the instant (ms)
   * the newest fresh stored record lapses, or null when none is fresh. */
  refresh(scope: Scope): Promise<number | null>;
  clock?: () => number;
  setTimer?: (run: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  const clock = input.clock ?? Date.now;
  const setTimer = input.setTimer ?? ((run, delayMs) => setTimeout(run, delayMs));
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const shops = new Map<
    string,
    {
      scope: Scope;
      activeUntil: number;
      lastStart: number;
      lastCollection: number;
      running: boolean;
      timer?: Timer;
    }
  >();
  function schedule(key: string, at: number) {
    const state = shops.get(key);
    if (!state) return;
    const timer = setTimer(() => void run(key), Math.max(0, at - clock()));
    (timer as { unref?: () => unknown }).unref?.();
    state.timer = timer;
  }
  async function run(key: string) {
    const state = shops.get(key);
    if (!state) return;
    state.timer = undefined;
    if (clock() > state.activeUntil) {
      shops.delete(key);
      return;
    }
    state.running = true;
    state.lastStart = clock();
    let validUntil: number | null = null;
    try {
      validUntil = await input.refresh(state.scope);
    } catch {
      validUntil = null;
    } finally {
      state.running = false;
    }
    if (clock() > state.activeUntil) {
      shops.delete(key);
      return;
    }
    const now = clock();
    if (validUntil === null || !Number.isFinite(validUntil) || validUntil <= now)
      schedule(key, state.lastStart + RELEASE_REFRESH_INTERVAL_MS);
    else if (validUntil - RELEASE_REFRESH_LEAD_MS > now) {
      // Only a refresh that collected this record counts against the interval; finding a sibling's
      // record must not postpone the next refresh past the record's lapse.
      if (validUntil - RELEASE_FRESHNESS_MS >= state.lastStart) state.lastCollection = state.lastStart;
      schedule(key, Math.max(state.lastCollection + RELEASE_REFRESH_INTERVAL_MS, validUntil - RELEASE_REFRESH_LEAD_MS));
    }
    // Nothing outlasting the lead was collected: the receiver collects once the stored record lapses.
    else schedule(key, validUntil);
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
          lastCollection: Number.NEGATIVE_INFINITY,
          running: false,
        });
      schedule(key, Math.max(clock(), (shops.get(key)?.lastStart ?? 0) + RELEASE_REFRESH_INTERVAL_MS));
    },
    /** Active shops, for tests and diagnostics. */
    activeShops: () => shops.size,
    close() {
      for (const state of shops.values()) if (state.timer) clearTimer(state.timer);
      shops.clear();
    },
  };
}
