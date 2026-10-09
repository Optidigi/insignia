import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';
import { createPgBossRuntime } from '../dist/runtime.js';
import { queueBoundaryHandoff } from './queue-handoff-fixture.mjs';

test('runtime refuses absent schema without installing it', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  const schema = `m5024_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const queue = createPgBossRuntime({
    webhookHandoff: queueBoundaryHandoff,
    connectionString: process.env.DATABASE_URL,
    schema,
  });
  try {
    await assert.rejects(queue.start());
    assert.equal((await pool.query('select oid from pg_namespace where nspname = $1', [schema])).rowCount, 0);
    assert.equal(queue.durableReady, false);
  } finally {
    await queue.stop();
    await pool.end();
  }
});

test('unknown schema upgrade fails closed and preserves an existing queued message', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  const schema = `m5024_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const producer = createPgBossRuntime({
    webhookHandoff: queueBoundaryHandoff,
    connectionString: process.env.DATABASE_URL,
    schema,
  });
  try {
    await installQueue(process.env.DATABASE_URL, schema);
    await producer.start();
    const id = randomUUID();
    await producer.ensureWebhookEnqueued(id);
    await producer.stop();
    const before = (await pool.query(`select id,state,data from ${schema}.job where id=$1`, [id])).rows;
    await pool.query(`update ${schema}.version set version=42`);
    const denied = createPgBossRuntime({
      webhookHandoff: queueBoundaryHandoff,
      connectionString: process.env.DATABASE_URL,
      schema,
    });
    await assert.rejects(denied.start());
    await denied.stop();
    await assert.rejects(installQueue(process.env.DATABASE_URL, schema), /Unreviewed queue schema upgrade/);
    assert.deepEqual((await pool.query(`select id,state,data from ${schema}.job where id=$1`, [id])).rows, before);
    assert.equal((await pool.query(`select version from ${schema}.version`)).rows[0].version, 42);
  } finally {
    await producer.stop();
    await pool.end();
  }
});
