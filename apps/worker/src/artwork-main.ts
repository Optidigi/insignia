import { createArtworkService } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createObservability } from '@insignia/observability';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { inspectArtwork } from './artwork/inspection.js';
import { startArtworkInspectionProcess } from './artwork-process.js';
import { qualifyArtworkRuntimeRole } from './artwork-role.js';
import { createArtworkRunner } from './artwork-runner.js';

/** Dedicated Linux host entrypoint, with inspection-only DB/storage credentials.
 * No Shopify secret, signing envelope, pg-boss consumer or unisolated fallback. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Artwork host configuration required');
  return value;
}
if (process.env.INSIGNIA_M8_PURCHASE_ENABLED === '1')
  throw new Error('Inspection and purchase processes must be separate');
const pool = new Pool({
  connectionString: required('DATABASE_URL'),
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
  statement_timeout: 10000,
});
try {
  await qualifyArtworkRuntimeRole(pool);
  const core = createDurableCore(pool);
  const observability = createObservability();
  const storage = await loadArtworkStorageProfile(required('ARTWORK_STORAGE_PROFILE'), {
    endpoint: required('ARTWORK_R2_ENDPOINT'),
    bucket: required('ARTWORK_R2_BUCKET'),
    prefix: required('ARTWORK_R2_PREFIX'),
  });
  const service = createArtworkService({
    store: core.artwork,
    storage,
    inspect: inspectArtwork,
    onCleanupError: () =>
      observability.logger.error('queue_job_rejected', { errorClass: 'ARTWORK_CLEANUP_UNAVAILABLE' }),
  });
  const runner = createArtworkRunner({
    store: core.artwork,
    service,
    onError: (errorClass) => observability.logger.error('queue_job_rejected', { errorClass }),
  });
  const running = await startArtworkInspectionProcess({
    runner,
    observability,
    socketPath: required('ARTWORK_WORKER_READY_SOCKET'),
    cleanup: () => service.cleanup(20),
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void running
      .stop()
      .then(() => pool.end())
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch {
  await pool.end();
  console.error('Artwork host initialization unavailable');
  process.exitCode = 1;
}
