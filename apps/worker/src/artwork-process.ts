import type { Observability } from '@insignia/observability';
import type { inspectArtwork } from './artwork/inspection.js';
import type { createArtworkRunner } from './artwork-runner.js';
import { createWorkerHealthServer } from './health.js';

/** Inspection owns durable artwork leases; it never subscribes to the order/webhook queue. */
export async function startArtworkInspectionProcess(input: {
  runner: ReturnType<typeof createArtworkRunner>;
  socketPath: string;
  observability: Observability;
  cleanup(): Promise<unknown>;
  inspectMerchantPreview?: typeof inspectArtwork;
}) {
  let stopping = false;
  let maintenance: Promise<void> | undefined;
  const server = createWorkerHealthServer({
    observability: input.observability,
    isDurableReady: () => false,
    inspectMerchantPreview: input.inspectMerchantPreview,
    artworkReadiness: () => ({ ready: !stopping && input.runner.ready }),
  });
  const cleanup = (): Promise<void> => {
    if (maintenance) return maintenance;
    if (stopping) return Promise.resolve();
    maintenance = input
      .cleanup()
      .then(() => {})
      .catch(() => {
        try {
          input.observability.logger.error('queue_job_rejected', { errorClass: 'ARTWORK_CLEANUP_UNAVAILABLE' });
        } catch {
          /* Logging cannot stop retention retries. */
        }
      })
      .finally(() => {
        maintenance = undefined;
      });
    return maintenance;
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    await server.listenArtworkSocket(input.socketPath);
    await input.runner.start();
    await input.runner.runOnce();
    // A transient pending-file failure owns its durable retry/backoff. Keep
    // readiness false while the qualified runner recovers; do not stop it.
    timer = setInterval(() => {
      void cleanup();
    }, 30000);
    timer.unref();
    void cleanup();
    return {
      async stop() {
        if (stopping) return;
        stopping = true;
        clearInterval(timer);
        try {
          await server.close();
        } finally {
          try {
            await input.runner.stop();
          } finally {
            await maintenance;
          }
        }
      },
    };
  } catch (error) {
    stopping = true;
    clearInterval(timer);
    await server.close();
    await input.runner.stop();
    await maintenance;
    throw error;
  }
}
