import { createRequire } from 'node:module';

const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { getConstructionPlans, PgBoss } = await import(workerRequire.resolve('pg-boss'));
const { Pool } = workerRequire('pg');

import {
  assertQueueContract,
  QUEUE_POLICY,
  QUEUE_SCHEMA_VERSION,
  REFRESH_QUEUE,
  WEBHOOK_QUEUE,
} from '../../apps/worker/dist/queue-contract.js';

// Separate owner operation. Never imported by web or worker startup. No downgrade path.
export async function installQueue(connectionString, schema = 'pgboss') {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid queue schema');
  const pool = new Pool({ connectionString });
  let client;
  const boss = new PgBoss({
    connectionString,
    schema,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  boss.on('error', () => {});
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock(hashtext('insignia.m5-024.queue-owner'))");
    const exists = await client.query('select oid from pg_namespace where nspname=$1', [schema]);
    if (exists.rowCount === 0) await client.query(getConstructionPlans(schema));
    const version = await client.query(`select version from ${schema}.version`);
    if (version.rowCount !== 1 || version.rows[0].version !== QUEUE_SCHEMA_VERSION)
      throw new Error('Unreviewed queue schema upgrade required');
    await boss.start();
    for (const name of [WEBHOOK_QUEUE, REFRESH_QUEUE]) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name, QUEUE_POLICY);
      assertQueueContract(name, await boss.getQueue(name));
    }
    return { schema, version: QUEUE_SCHEMA_VERSION, queues: [WEBHOOK_QUEUE, REFRESH_QUEUE], destructiveDown: false };
  } finally {
    try {
      await boss.stop({ graceful: true });
    } finally {
      try {
        if (client) await client.query("select pg_advisory_unlock(hashtext('insignia.m5-024.queue-owner'))");
      } finally {
        client?.release();
        await pool.end();
      }
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.env.INSIGNIA_QUEUE_OWNER_INSTALL !== 'explicit-reviewed-owner-operation')
    throw new Error('Queue installation requires explicit owner operation');
  if (!process.env.DATABASE_URL) throw new Error('Missing owner database endpoint');
  console.log(JSON.stringify(await installQueue(process.env.DATABASE_URL)));
}
