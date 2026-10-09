import { createDurableCore } from '@insignia/database';
import { createPgBossRuntime } from '@insignia/worker';
import { Pool } from 'pg';
import { webObservability } from './observability.js';

type Runtime = {
  core: ReturnType<typeof createDurableCore>;
  queue: ReturnType<typeof createPgBossRuntime>;
};
let runtimePromise: Promise<Runtime> | undefined;

export async function webRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('Webhook ingress configuration is incomplete');
      const core = createDurableCore(new Pool({ connectionString }));
      const queue = createPgBossRuntime({
        connectionString,
        observability: webObservability,
        webhookHandoff: core.webhooks,
      });
      try {
        await queue.start();
      } catch (error) {
        await core.close();
        throw error;
      }
      return { core, queue };
    })().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}
