import { AsyncLocalStorage } from 'node:async_hooks';
import type { BuyerFailureDiagnostic, BuyerTimingDiagnostic, BuyerTimingSpan } from '@insignia/observability';

type Stage = NonNullable<BuyerFailureDiagnostic['proposalStage']>;
type Attribution = { stage: Stage; path: readonly symbol[] };
const context = new AsyncLocalStorage<{
  failures: Map<unknown, Attribution>;
  path: readonly symbol[];
  timing: { start: number; now: () => number; spans: BuyerTimingSpan[]; truncated: boolean };
  parentId: number | null;
  cache?: { status?: 'hit' | 'miss' };
}>();
// Attribution belongs to one HTTP request. Never mutate or wrap original errors:
// typed handling and stock-first rejection precedence retain their contracts.
export function proposalDiagnostics<T>(run: () => T, now = () => performance.now()): T {
  return context.run(
    {
      failures: new Map(),
      path: [],
      parentId: null,
      timing: { start: now(), now, spans: [], truncated: false },
      cache: {},
    },
    run,
  );
}
/** Records whether this request was served from a short cache, for its Server-Timing header. */
export function noteCache(status: 'hit' | 'miss'): void {
  const cache = context.getStore()?.cache;
  if (cache) cache.status = status;
}
export function cacheStatus(): 'hit' | 'miss' | undefined {
  return context.getStore()?.cache?.status;
}
export function proposalFailureStage(error: unknown): Stage | undefined {
  return context.getStore()?.failures.get(error)?.stage;
}
export async function proposalStage<T>(stage: Stage, run: () => T | Promise<T>): Promise<T> {
  const parent = context.getStore();
  if (!parent) return run();
  const path = [...parent.path, Symbol()];
  const timing = parent.timing;
  const start = timing.now();
  const span: BuyerTimingSpan | undefined =
    timing.spans.length < 64
      ? {
          id: timing.spans.length + 1,
          parentId: parent.parentId,
          stage,
          offsetMs: milliseconds(start - timing.start),
          durationMs: 0,
          outcome: 'unfinished',
        }
      : undefined;
  if (span) timing.spans.push(span);
  else timing.truncated = true;
  return context.run({ ...parent, path, parentId: span?.id ?? parent.parentId }, async () => {
    try {
      const result = await run();
      if (span) span.outcome = 'success';
      return result;
    } catch (error) {
      if (span) span.outcome = 'failure';
      const existing = parent.failures.get(error);
      if (!existing) parent.failures.set(error, { stage, path });
      // A provider may reuse one error in distinct branches. Do not attribute
      // that failure to whichever branch happened to reject first.
      else if (!path.every((part, index) => existing.path[index] === part))
        parent.failures.set(error, { stage: 'ambiguous', path: [] });
      throw error;
    } finally {
      if (span) span.durationMs = milliseconds(timing.now() - start);
    }
  });
}

function milliseconds(value: number): number {
  return Math.min(86400000, Math.max(0, Math.floor(value)));
}
export function proposalTiming(
  correlationId: string,
  operation: BuyerTimingDiagnostic['operation'],
  outcome: BuyerTimingDiagnostic['outcome'],
): BuyerTimingDiagnostic | undefined {
  const timing = context.getStore()?.timing;
  if (!timing) return undefined;
  const totalMs = milliseconds(timing.now() - timing.start);
  return {
    correlationId,
    operation,
    outcome,
    totalMs,
    truncated: timing.truncated,
    // A failed request can finish while initiated siblings still run. Snapshot
    // their elapsed time explicitly, without delaying the response for telemetry.
    spans: timing.spans.map((span) => ({
      ...span,
      durationMs: span.outcome === 'unfinished' ? Math.max(0, totalMs - span.offsetMs) : span.durationMs,
    })),
  };
}
