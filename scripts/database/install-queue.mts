import { createRequire } from 'node:module';
import type { PoolClient } from 'pg';

const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { getConstructionPlans, getMigrationPlans, PgBoss }: typeof import('pg-boss') = await import(
  workerRequire.resolve('pg-boss')
);
const { Pool }: typeof import('pg') = workerRequire('pg');

import {
  assertQueueContract,
  QUEUE_POLICY,
  QUEUE_SCHEMA_VERSION,
  REFRESH_QUEUE,
  WEBHOOK_QUEUE,
} from '../../apps/worker/dist/queue-contract.js';

const queues = Object.freeze([WEBHOOK_QUEUE, REFRESH_QUEUE]);

async function upgradeQueueFrom43(client: PoolClient, schema: string) {
  const metadata = workerRequire('pg-boss/package.json');
  if (metadata.version !== '12.40.0' || metadata.pgboss.schema !== 48 || QUEUE_SCHEMA_VERSION !== 48)
    throw new Error('Unreviewed pg-boss migration plan');
  const [ddl, indexes, ...extra] = getMigrationPlans(schema, 43)
    .trim()
    .split(/^\s*COMMIT;\s*$/m);
  const concurrentIndex = /^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS /gm;
  if (!ddl?.startsWith('BEGIN;') || !indexes || extra.length || [...indexes.matchAll(concurrentIndex)].length !== 5)
    throw new Error('Unreviewed pg-boss migration plan');

  // The owner window is quiesced. Build the five indexes inside the same transaction
  // as the DDL so a failure can never leave schema 48 stamped with missing indexes.
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '30s'");
    const { rows } = await client.query(
      'SELECT nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned FROM pg_namespace WHERE nspname = $1',
      [schema],
    );
    if (!rows.length) throw new Error('Expected queue schema 43');
    if (rows[0]?.owned !== true) throw new Error('Queue schema owner required');
    await client.query(`LOCK TABLE ${schema}.version IN ACCESS EXCLUSIVE MODE`);
    const version = await client.query(`select version from ${schema}.version`);
    if (version.rowCount !== 1 || version.rows[0]?.version !== 43) throw new Error('Expected queue schema 43');
    await client.query(ddl.slice('BEGIN;'.length));
    await client.query(indexes.replace(concurrentIndex, 'CREATE $1INDEX '));
    const boss = new PgBoss({
      schema,
      db: { executeSql: (sql, values) => client.query(sql, values) },
      migrate: false,
      createSchema: false,
    });
    const upgraded = await boss.getQueues();
    if (upgraded.length !== queues.length) throw new Error('Unreviewed queue set');
    for (const name of queues)
      assertQueueContract(
        name,
        upgraded.find((queue) => queue.name === name),
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

// Separate owner operation. Never imported by web or worker startup. No downgrade path.
export async function installQueue(
  connectionString: string,
  schema = 'pgboss',
  mode: 'install' | 'upgrade-from-43' = 'install',
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid queue schema');
  const pool = new Pool({ connectionString });
  let client: PoolClient | undefined;
  const boss = new PgBoss({
    connectionString,
    schema,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  boss.on('error', () => {});
  try {
    client = await pool.connect();
    // Keep the deployed advisory-lock identity shared with existing owner operations.
    await client.query("select pg_advisory_lock(hashtext('insignia.m5-024.queue-owner'))");
    if (mode === 'upgrade-from-43') {
      await upgradeQueueFrom43(client, schema);
      return { schema, version: QUEUE_SCHEMA_VERSION, queues, destructiveDown: false };
    }
    const exists = await client.query('select oid from pg_namespace where nspname=$1', [schema]);
    if (exists.rowCount === 0) await client.query(getConstructionPlans(schema));
    const version = await client.query<{ version: unknown }>(`select version from ${schema}.version`);
    if (version.rowCount !== 1 || version.rows[0]?.version !== QUEUE_SCHEMA_VERSION)
      throw new Error('Unreviewed queue schema upgrade required');
    await boss.start();
    for (const name of queues) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name, QUEUE_POLICY);
      assertQueueContract(name, await boss.getQueue(name));
    }
    return { schema, version: QUEUE_SCHEMA_VERSION, queues, destructiveDown: false };
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
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--upgrade-from-43'))
    throw new Error('Usage: node scripts/database/install-queue.mts [--upgrade-from-43]');
  console.log(
    JSON.stringify(await installQueue(process.env.DATABASE_URL, 'pgboss', args.length ? 'upgrade-from-43' : 'install')),
  );
}
