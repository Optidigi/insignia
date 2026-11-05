import type { HomeActivityDay, HomeStatistics } from './merchant-home.js';

type ReadyActivity = Extract<HomeStatistics, { state: 'ready' }>;
export type HomeActivityRange = 7 | 30;

function sum(days: HomeActivityDay[]) {
  return {
    customizedOrders: days.reduce((total, day) => total + day.customizedOrders, 0),
    customizedItems: days.reduce((total, day) => total + day.customizedItems, 0n),
    series: days,
  };
}

/** A seven-day view is derived only from the complete daily collection, not the recent order slice. */
export function homeActivityPeriod(statistics: ReadyActivity, range: HomeActivityRange) {
  if (range === 7 && statistics.series?.length === 30) {
    return {
      periodDays: 7 as const,
      ...sum(statistics.series.slice(-7)),
      previousPeriod: sum(statistics.series.slice(-14, -7)),
    };
  }
  return { ...statistics, periodDays: 30 as const };
}

/** An empty comparison baseline cannot establish a growth percentage. */
export function homeActivityChange(
  current: number | bigint,
  previous: number | bigint | undefined,
): number | undefined {
  if (previous === undefined) return undefined;
  const exact = (value: number | bigint): bigint | undefined => {
    if (typeof value === 'bigint') return value;
    return Number.isSafeInteger(value) ? BigInt(value) : undefined;
  };
  const currentExact = exact(current);
  const previousExact = exact(previous);
  if (currentExact === undefined || previousExact === undefined || previousExact <= 0n) return undefined;
  const scale = 1_000_000_000n;
  const scaledChange = ((currentExact - previousExact) * scale) / previousExact;
  const change = Number(scaledChange) / Number(scale);
  return Number.isFinite(change) ? change : undefined;
}

/** Plural selection uses i18next's numeric count only while conversion remains exact. */
export function safePluralCount(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}
