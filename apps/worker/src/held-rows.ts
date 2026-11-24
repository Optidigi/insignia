import type { Observability, RuntimeErrorClass } from '@insignia/observability';

/** An unchanged held-row count is repeated at most this often. */
export const HELD_ROW_SIGNAL_PERIOD_MS = 3_600_000;

/**
 * Rows a maintenance pass cannot resolve stay held for hours or days, and every pass sees them again.
 * Per error class, `queue_job_rejected` is logged when the class appears, when its count changes, and
 * at most hourly while the count is unchanged; a class that clears is logged once at info. Metrics stay
 * with the caller and still count every pass. A failed log leaves the state unchanged, so the next pass
 * tries again.
 */
export function createHeldRowReporter(now: () => number = Date.now) {
  const held = new Map<RuntimeErrorClass, { count: number; loggedAt: number }>();
  return {
    report(logger: Pick<Observability['logger'], 'error' | 'info'>, errorClass: RuntimeErrorClass, count: number) {
      const prior = held.get(errorClass);
      if (!count) {
        if (!prior) return;
        logger.info('queue_job_rejection_cleared', { errorClass });
        held.delete(errorClass);
        return;
      }
      const at = now();
      if (prior && prior.count === count && at - prior.loggedAt < HELD_ROW_SIGNAL_PERIOD_MS) return;
      logger.error('queue_job_rejected', { errorClass, count });
      held.set(errorClass, { count, loggedAt: at });
    },
  };
}
export type HeldRowReporter = ReturnType<typeof createHeldRowReporter>;
