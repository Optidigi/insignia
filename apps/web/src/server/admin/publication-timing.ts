import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { PublicationTimingDiagnostic, PublicationTimingStage } from '@insignia/observability';

type Span = PublicationTimingDiagnostic['spans'][number];
type Timing = { start: number; now: () => number; spans: Span[]; truncated: boolean };
const context = new AsyncLocalStorage<{ timing: Timing; parentId: number | null }>();

const milliseconds = (value: number) => Math.min(86400000, Math.max(0, Math.floor(value)));

/** Times one publish request. `publicationStage` calls made while `run` is pending (in any of its
 * async continuations) become its spans; the summary is handed to `report` once `run` settles.
 * Timing never changes the request: its result or error is returned unchanged, and a throwing
 * `report` is ignored. */
export async function timePublication<T>(
  run: () => Promise<T>,
  summarize: (result: { value: T } | { error: unknown }) => Pick<PublicationTimingDiagnostic, 'outcome' | 'state'>,
  report: ((timing: PublicationTimingDiagnostic) => void) | undefined,
  now: () => number = () => performance.now(),
): Promise<T> {
  if (!report) return run();
  const timing: Timing = { start: now(), now, spans: [], truncated: false };
  let settled: { value: T } | { error: unknown };
  try {
    settled = { value: await context.run({ timing, parentId: null }, run) };
  } catch (error) {
    settled = { error };
  }
  try {
    const totalMs = milliseconds(now() - timing.start);
    report({
      correlationId: randomUUID(),
      ...summarize(settled),
      totalMs,
      truncated: timing.truncated,
      // A failed request can finish while a started sibling still runs; report its elapsed time.
      spans: timing.spans.map((span) =>
        span.outcome === 'unfinished' ? { ...span, durationMs: Math.max(0, totalMs - span.offsetMs) } : { ...span },
      ),
    });
  } catch {
    /* Timing never changes the publish outcome. */
  }
  if ('error' in settled) throw settled.error;
  return settled.value;
}

/** Records `run` as one span of the publish request in progress; outside one it only runs `run`. */
export async function publicationStage<T>(stage: PublicationTimingStage, run: () => Promise<T>): Promise<T> {
  const parent = context.getStore();
  if (!parent) return run();
  const { timing } = parent;
  const start = timing.now();
  const span: Span | undefined =
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
  return context.run({ timing, parentId: span?.id ?? parent.parentId }, async () => {
    try {
      const result = await run();
      if (span) span.outcome = 'success';
      return result;
    } catch (error) {
      if (span) span.outcome = 'failure';
      throw error;
    } finally {
      if (span) span.durationMs = milliseconds(timing.now() - start);
    }
  });
}
