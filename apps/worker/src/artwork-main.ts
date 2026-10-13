import { createArtworkService } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createObservability } from '@insignia/observability';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { inspectArtwork } from './artwork/inspection.js';
import { startArtworkInspectionProcess } from './artwork-process.js';
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
  const role = await pool.query(`SELECT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND pg_has_role(current_user,'insignia_artwork_inspect','USAGE')
    AND NOT pg_has_role(current_user,'insignia_queue_consume','USAGE')
    AND NOT has_schema_privilege(current_user,'public','CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND c.relname NOT IN ('artwork_assets','shops','installation_generations')
        AND (has_any_column_privilege(current_user,c.oid,'SELECT, INSERT, UPDATE, REFERENCES')
          OR has_table_privilege(current_user,c.oid,'DELETE, TRUNCATE, TRIGGER'))) AS qualified
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (role.rows.length !== 1 || role.rows[0].qualified !== true) throw new Error('Inspection runtime role required');
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
