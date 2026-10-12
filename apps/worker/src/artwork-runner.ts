import { createHash } from 'node:crypto';
import type { ArtworkStore, createArtworkService } from '@insignia/application';
import { inspectArtwork } from './artwork/inspection.js';

const probe = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>',
);
type Service = Pick<ReturnType<typeof createArtworkService>, 'process'>;
type RunnerError = 'ARTWORK_RUNNER_UNAVAILABLE' | 'ARTWORK_RUNNER_ABORTED' | 'ARTWORK_RUNNER_DEADLINE';
/** Explicit host composition only. Durable asset rows, rather than this timer, own pending work and leases. */
export function createArtworkRunner(input: {
  store: Pick<ArtworkStore, 'selectPending'>;
  service: Service;
  inspect?: typeof inspectArtwork;
  clock?: () => Date;
  onError?: (code: RunnerError) => void;
  timing?: { pollMs?: number; backoffMaxMs?: number; heartbeatMaxAgeMs?: number; deadlineMs?: number };
}) {
  const clock = input.clock ?? (() => new Date());
  const pollMs = input.timing?.pollMs ?? 2000,
    backoffMaxMs = input.timing?.backoffMaxMs ?? 30000;
  const heartbeatMaxAgeMs = input.timing?.heartbeatMaxAgeMs ?? 30000,
    deadlineMs = input.timing?.deadlineMs ?? 240000;
  if (
    [pollMs, backoffMaxMs, heartbeatMaxAgeMs, deadlineMs].some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    deadlineMs > 240000 ||
    heartbeatMaxAgeMs > 30000 ||
    pollMs > 30000 ||
    backoffMaxMs > 30000 ||
    backoffMaxMs < pollMs
  )
    throw new Error('Invalid artwork runner budgets');
  let processing = false;
  let running = false,
    qualified = false,
    healthy = false,
    lastHeartbeat: number | undefined,
    lastError: RunnerError | null = null;
  let timer: NodeJS.Timeout | undefined,
    heartbeat: NodeJS.Timeout | undefined,
    active: Promise<number> | undefined,
    starting: Promise<void> | undefined;
  let controller: AbortController | undefined,
    backoff = pollMs;
  const report = (code: RunnerError) => {
    healthy = false;
    lastError = code;
    try {
      input.onError?.(code);
    } catch {}
  };
  const ready = () =>
    running &&
    qualified &&
    healthy &&
    lastHeartbeat !== undefined &&
    clock().getTime() - lastHeartbeat >= 0 &&
    clock().getTime() - lastHeartbeat <= heartbeatMaxAgeMs;
  const qualify = async (signal: AbortSignal) => {
    const probeController = new AbortController();
    const abort = () => probeController.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) probeController.abort();
    const timer = setTimeout(abort, 10000);
    try {
      const result = await (input.inspect ?? inspectArtwork)(probe, { signal: probeController.signal });
      if (
        probeController.signal.aborted ||
        !running ||
        result.version !== 'm6-inspection-v1' ||
        result.mimeType !== 'image/svg+xml' ||
        result.width !== 16 ||
        result.height !== 8 ||
        result.originalSha256 !== createHash('sha256').update(probe).digest('hex') ||
        result.previewMimeType !== 'image/png' ||
        !Buffer.from(result.preview)
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Artwork qualification failed');
      qualified = true;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  };
  const runOnce = (): Promise<number> => {
    if (active) return active;
    if (!running) return Promise.reject(new Error('Artwork runner unavailable'));
    controller = new AbortController();
    const passController = controller;
    const signal = passController.signal;
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      healthy = false;
      passController.abort();
    }, deadlineMs);
    const work = async () => {
      try {
        processing = false;
        if (!qualified) await qualify(signal);
        const pending = await input.store.selectPending(5, clock());
        if (signal.aborted) throw new Error('Artwork runner aborted');
        healthy = true;
        lastHeartbeat = clock().getTime();
        lastError = null;
        processing = true;
        let completed = 0,
          assetFailed = false;
        for (const id of pending.slice(0, 5)) {
          if (signal.aborted) throw new Error('Artwork runner aborted');
          try {
            await input.service.process(id, signal);
            completed++;
          } catch {
            if (signal.aborted) throw new Error('Artwork runner aborted');
            // The service persisted this asset's retry. Continue unrelated rows;
            // do not turn an individual missing object into a global queue fence.
            assetFailed = true;
          }
          if (signal.aborted) throw new Error('Artwork runner aborted');
        }
        lastHeartbeat = clock().getTime();
        if (assetFailed) {
          qualified = false;
          report('ARTWORK_RUNNER_UNAVAILABLE');
          backoff = Math.min(backoffMaxMs, Math.max(pollMs, backoff * 2));
        } else backoff = pollMs;
        return completed;
      } catch {
        qualified = false;
        report(
          expired
            ? 'ARTWORK_RUNNER_DEADLINE'
            : signal.aborted
              ? 'ARTWORK_RUNNER_ABORTED'
              : 'ARTWORK_RUNNER_UNAVAILABLE',
        );
        backoff = Math.min(backoffMaxMs, Math.max(pollMs, backoff * 2));
        return 0;
      } finally {
        clearTimeout(deadline);
        processing = false;
        controller = undefined;
      }
    };
    active = work().finally(() => {
      active = undefined;
    });
    return active;
  };
  const tick = async () => {
    if (!running) return;
    await runOnce();
    if (running) {
      timer = setTimeout(tick, backoff);
      timer.unref();
    }
  };
  const start = (): Promise<void> => {
    if (starting) return starting;
    if (running) return Promise.resolve();
    if (active) return Promise.reject(new Error('Artwork runner stopping'));
    running = true;
    controller = new AbortController();
    const signal = controller.signal;
    const deadline = setTimeout(() => controller?.abort(), 10000);
    starting = (async () => {
      try {
        await qualify(signal);
        heartbeat = setInterval(
          () => {
            if (running && qualified && healthy && active && processing) lastHeartbeat = clock().getTime();
          },
          Math.max(1, Math.min(5000, Math.floor(heartbeatMaxAgeMs / 3))),
        );
        heartbeat.unref();
        timer = setTimeout(tick, 0);
        timer.unref();
      } catch {
        running = false;
        qualified = false;
        report(signal.aborted ? 'ARTWORK_RUNNER_ABORTED' : 'ARTWORK_RUNNER_UNAVAILABLE');
        throw new Error('Artwork runner qualification unavailable');
      } finally {
        clearTimeout(deadline);
        controller = undefined;
        starting = undefined;
      }
    })();
    return starting;
  };
  return {
    start,
    runOnce,
    get ready() {
      return ready();
    },
    readiness() {
      return {
        ready: ready(),
        qualified,
        running,
        lastHeartbeatAt: lastHeartbeat === undefined ? null : new Date(lastHeartbeat).toISOString(),
        error: lastError,
      };
    },
    async stop() {
      running = false;
      healthy = false;
      clearTimeout(timer);
      clearInterval(heartbeat);
      controller?.abort();
      await starting?.catch(() => {});
      await active;
      qualified = false;
    },
  };
}
