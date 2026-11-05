import { clearInterval, setInterval as interval } from 'node:timers';

export type CustomerNotificationRun = { state: 'ready' | 'stopped' | 'unavailable'; sent: number };
/** One in-process drain at a time; cross-process dispatch ownership stays in PostgreSQL. */
export function createCustomerArtworkNotificationRunner(input: {
  deliver(signal: AbortSignal): Promise<{ sent: number; unavailable?: boolean }>;
  close?(): Promise<void>;
  onUnavailable?(): void;
  intervalMs?: number;
}) {
  const every = input.intervalMs ?? 60000;
  if (!Number.isSafeInteger(every) || every < 1000 || every > 3600000)
    throw new Error('CUSTOMER_EMAIL_RUNNER_CONFIGURATION');
  let timer: ReturnType<typeof interval> | undefined;
  let stopped = false;
  let running: Promise<CustomerNotificationRun> | undefined;
  let abort: AbortController | undefined;
  let snapshot: CustomerNotificationRun = { state: 'ready', sent: 0 };
  async function runOnce(): Promise<CustomerNotificationRun> {
    if (stopped) return { state: 'stopped', sent: 0 };
    if (running) return running;
    const controller = new AbortController();
    abort = controller;
    running = Promise.resolve().then(async () => {
      try {
        if (stopped) return { state: 'stopped' as const, sent: 0 };
        const result = await input.deliver(controller.signal);
        snapshot = { state: result.unavailable ? 'unavailable' : 'ready', sent: result.sent };
        if (result.unavailable) input.onUnavailable?.();
        return snapshot;
      } catch {
        snapshot = { state: 'unavailable', sent: 0 };
        try {
          input.onUnavailable?.();
        } catch {}
        return snapshot;
      } finally {
        running = undefined;
        abort = undefined;
      }
    });
    return running;
  }
  return {
    runOnce,
    start() {
      if (stopped || timer) return;
      timer = interval(() => void runOnce(), every);
      timer.unref();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      abort?.abort();
      await running;
      await input.close?.();
      snapshot = { state: 'stopped', sent: 0 };
    },
    get snapshot() {
      return snapshot;
    },
  };
}
