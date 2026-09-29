import { createDurableCore } from '@insignia/database';
import { createShopifyOfflineRefreshTransport } from '@insignia/shopify';
import { Pool } from 'pg';
import { loadCredentialKeys } from './config.js';
import { runLocalDiagnostic } from './diagnostic.js';
import { createDurableWorkerHandlers, recoverPendingUninstalls } from './handlers.js';
import { startWorkerProcess } from './process.js';
import { createPgBossRuntime } from './runtime.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv.includes('--diagnostic')) {
  console.log(JSON.stringify(await runLocalDiagnostic()));
} else {
  const connectionString = required('DATABASE_URL');
  const keys = loadCredentialKeys(process.env);
  const clientId = required('SHOPIFY_CLIENT_ID');
  const clientSecret = required('SHOPIFY_CLIENT_SECRET');
  const portArgument = process.argv.find((value) => value.startsWith('--port='));
  const port = portArgument ? Number(portArgument.slice('--port='.length)) : 4301;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid worker port');
  const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
  const queue = createPgBossRuntime({ connectionString, credentialKeysReady: true });
  const transport = createShopifyOfflineRefreshTransport({ clientId, clientSecret });
  const running = await startWorkerProcess({ queue, handlers: createDurableWorkerHandlers(core, transport), port });
  console.log(JSON.stringify({ url: running.url, durableReady: running.durableReady }));
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await recoverPendingUninstalls(core, queue);
    } catch {
      queue.observability.logger.error('queue_job_rejected');
    } finally {
      reconciling = false;
    }
  };
  const recoveryTimer = setInterval(() => {
    void reconcile();
  }, 30_000);
  recoveryTimer.unref();
  void reconcile();
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      clearInterval(recoveryTimer);
      void running.stop().finally(() => core.close());
    });
  }
}
