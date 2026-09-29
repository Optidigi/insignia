import { createWorkerHealthServer } from './health.js';
import type { PgBossRuntime, WorkerHandlers } from './runtime.js';

/** Injectable composition: the server integrator supplies the scoped durable handlers. */
export async function startWorkerProcess(input: { queue: PgBossRuntime; handlers: WorkerHandlers; port: number }) {
  let stopping = false;
  const server = createWorkerHealthServer({
    observability: input.queue.observability,
    isDurableReady: () => !stopping && input.queue.durableReady,
    probeDurableReady: () => (stopping ? Promise.resolve(false) : input.queue.checkDurableReady()),
  });
  try {
    await input.queue.start();
    await input.queue.work(input.handlers);
    const url = await server.listen(input.port);
    return {
      url,
      get durableReady() {
        return !stopping && input.queue.durableReady;
      },
      async stop() {
        if (stopping) return;
        stopping = true;
        try {
          await server.close();
        } finally {
          await input.queue.stop();
        }
      },
    };
  } catch (error) {
    stopping = true;
    await input.queue.stop();
    throw error;
  }
}
