import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createPgBossRuntime } from './runtime.js';

/** Share the worker LOGIN ceiling of four across independent pools.
 * Handoff holds a core transaction while awaiting queue IO, so neither pool
 * can consume the whole budget. */
export function createWorkerDatabase(
  connectionString: string,
  credentialKeys: NonNullable<Parameters<typeof createDurableCore>[1]>['credentialKeys'],
) {
  const pool = new Pool({
    max: 2,
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
  });
  const core = createDurableCore(pool, { credentialKeys });
  const queue = createPgBossRuntime({
    max: 2,
    connectionString,
    credentialKeysReady: true,
    webhookHandoff: core.webhooks,
  });
  return { pool, core, queue };
}
