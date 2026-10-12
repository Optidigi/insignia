import { createArtworkService } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createShopifyOfflineRefreshTransport } from '@insignia/shopify';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { inspectArtwork } from './artwork/inspection.js';
import { createArtworkRunner } from './artwork-runner.js';
import { loadCredentialKeys } from './config.js';
import { runLocalDiagnostic } from './diagnostic.js';
import { createDurableWorkerHandlers, maintainWebhookRetention, recoverPendingUninstalls } from './handlers.js';
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
  const core = createDurableCore(
    new Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 }),
    { credentialKeys: keys },
  );
  const queue = createPgBossRuntime({ connectionString, credentialKeysReady: true, webhookHandoff: core.webhooks });
  const transport = createShopifyOfflineRefreshTransport({ clientId, clientSecret });
  const artwork =
    process.env.INSIGNIA_ARTWORK_HOST_RUNNER === '1'
      ? createArtworkService({
          store: core.artwork,
          inspect: inspectArtwork,
          storage: await loadArtworkStorageProfile(required('ARTWORK_STORAGE_PROFILE'), {
            endpoint: required('ARTWORK_R2_ENDPOINT'),
            bucket: required('ARTWORK_R2_BUCKET'),
            prefix: required('ARTWORK_R2_PREFIX'),
          }),
        })
      : undefined;
  const artworkRunner = artwork
    ? createArtworkRunner({
        store: core.artwork,
        service: artwork,
        onError: (errorClass) => queue.observability.logger.error('queue_job_rejected', { errorClass }),
      })
    : undefined;
  const running = await startWorkerProcess({
    queue,
    handlers: createDurableWorkerHandlers(core, transport),
    port,
    artworkReadiness: () => artworkRunner?.readiness() ?? { ready: false },
  });
  if (artworkRunner) await artworkRunner.start();
  console.log(JSON.stringify({ url: running.url, durableReady: running.durableReady }));
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await maintainWebhookRetention(core, queue);
      await recoverPendingUninstalls(core, queue);
      if (artwork) await artwork.cleanup(20);
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
      void (async () => {
        await artworkRunner?.stop();
        await running.stop();
        await core.close();
      })();
    });
  }
}
