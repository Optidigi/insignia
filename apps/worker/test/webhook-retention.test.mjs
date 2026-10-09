import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';
import * as durableHandlers from '../dist/handlers.js';
import { createPgBossRuntime, REFRESH_QUEUE, WEBHOOK_QUEUE } from '../dist/runtime.js';

const connectionString = process.env.DATABASE_URL;
const postgres = { skip: !connectionString && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1', timeout: 30_000 };

async function fixture() {
  assert.ok(connectionString, 'Owned PostgreSQL test DATABASE_URL is required');
  // Each application inbox has exactly its own configured queue namespace.
  // Sharing application rows across independent test queue schemas would make
  // a cleanup-absence assertion refer to the wrong queue owner.
  const admin = new Pool({ connectionString });
  const database = `m5retention_worker_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(connectionString);
  url.pathname = '/' + database;
  await admin.query('CREATE DATABASE ' + database);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  await promisify(execFile)(
    root + 'node_modules/.bin/dbmate',
    ['--no-dump-schema', '--migrations-dir', root + 'packages/database/migrations', 'up'],
    { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
  );
  const pool = new Pool({ connectionString: url.href });
  const core = createDurableCore(new Pool({ connectionString: url.href }));
  const schema = `pgboss_retention_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  await installQueue(url.href, schema);
  const boss = new PgBoss({
    connectionString: url.href,
    schema,
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: false,
  });
  const queue = createPgBossRuntime({ boss, webhookHandoff: core.webhooks, credentialKeysReady: true });
  await queue.start();
  const receipt = await core.webhooks.receive({
    shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
    deliveryId: randomUUID(),
    topic: 'app/uninstalled',
    apiVersion: '2026-07',
    triggeredAt: new Date(),
    eventId: null,
    name: null,
    rawBody: Buffer.from(JSON.stringify({ id: '123', myshopify_domain: null })),
  });
  return {
    pool,
    core,
    boss,
    queue,
    receipt,
    schema,
    connectionString: url.href,
    async close() {
      await queue.stop();
      await core.close();
      await pool.end();
      await admin.query('DROP DATABASE ' + database);
      await admin.end();
    },
  };
}

test('real pg-boss lost ACK and handoff rollback cannot recreate a deleted job retry budget', postgres, async () => {
  const f = await fixture();
  try {
    const send = f.boss.send.bind(f.boss);
    let sends = 0;
    f.boss.send = async (...args) => {
      sends++;
      await send(...args);
      throw new Error('synthetic lost ACK after external send');
    };
    await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /lost ACK/);
    assert.equal((await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }))[0]?.state, 'created');
    // Use pinned pg-boss failure API, then delete its terminal job. The durable
    // acknowledgement transaction rolled back, but the reservation must not.
    await f.boss.fail(WEBHOOK_QUEUE, f.receipt.id, { message: 'synthetic terminal failure' });
    await f.boss.deleteJob(WEBHOOK_QUEUE, f.receipt.id);
    assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }), []);
    f.boss.send = async (...args) => {
      sends++;
      return send(...args);
    };
    await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /missing|exhausted/);
    assert.equal(sends, 1);
    const { rows } = await f.pool.query(
      `SELECT delivery.queue_handoff_state,inbox.state,inbox.last_error_class
      FROM shopify_webhook_deliveries delivery JOIN inbox_messages inbox ON inbox.id=delivery.inbox_id WHERE inbox.id=$1`,
      [f.receipt.id],
    );
    assert.deepEqual(rows[0], {
      queue_handoff_state: 'exhausted',
      state: 'failed',
      last_error_class: 'webhook_queue_missing',
    });
    assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }), []);
  } finally {
    await f.close();
  }
});

test(
  'real pg-boss lost ACK recovers the existing singleton without discarding it or sending again',
  postgres,
  async () => {
    const f = await fixture();
    try {
      const send = f.boss.send.bind(f.boss);
      let sends = 0;
      f.boss.send = async (...args) => {
        sends++;
        await send(...args);
        throw new Error('synthetic lost ACK');
      };
      await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /lost ACK/);
      assert.equal(
        (
          await f.pool.query('SELECT queue_handoff_state FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
            f.receipt.id,
          ])
        ).rows[0].queue_handoff_state,
        'unknown',
      );
      f.boss.send = async (...args) => {
        sends++;
        return send(...args);
      };
      assert.deepEqual(await f.queue.ensureWebhookEnqueued(f.receipt.id), {
        inboxId: f.receipt.id,
        status: 'already_enqueued',
      });
      assert.equal(sends, 1);
      assert.equal(
        (
          await f.pool.query('SELECT queue_handoff_state FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
            f.receipt.id,
          ])
        ).rows[0].queue_handoff_state,
        'confirmed',
      );
    } finally {
      await f.close();
    }
  },
);

test('real pg-boss expiry maintenance erases bytes and removes only exact associated jobs', postgres, async () => {
  const f = await fixture();
  try {
    await f.queue.ensureWebhookEnqueued(f.receipt.id);
    const refreshId = await f.queue.enqueueRefresh(randomUUID(), 1);
    const unrelatedId = randomUUID();
    await f.boss.send(WEBHOOK_QUEUE, { inboxId: unrelatedId }, { id: unrelatedId });
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = await durableHandlers.maintainWebhookRetention(f.core, f.queue);
    assert.ok(result.erasedIds.includes(f.receipt.id));
    assert.ok(result.unresolvedExpiredIds.includes(f.receipt.id));
    assert.ok(result.cleanedIds.includes(f.receipt.id));
    assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }), []);
    assert.equal((await f.boss.findJobs(REFRESH_QUEUE, { id: refreshId })).length, 1);
    assert.equal((await f.boss.findJobs(WEBHOOK_QUEUE, { id: unrelatedId })).length, 1);
    assert.equal(
      (await f.pool.query('SELECT octet_length(payload) AS bytes FROM inbox_messages WHERE id=$1', [f.receipt.id]))
        .rows[0].bytes,
      0,
    );
    await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /expired/);
    const handlers = durableHandlers.createDurableWorkerHandlers(f.core, {
      async refresh() {
        throw new Error('unexpected refresh');
      },
    });
    assert.equal(
      await handlers.processInbox(f.receipt.id, {
        jobId: f.receipt.id,
        attempt: 0,
        signal: new AbortController().signal,
      }),
      'expired',
    );
  } finally {
    await f.close();
  }
});

test('real pg-boss worker failure output excludes arbitrary payload-bearing errors', postgres, async () => {
  const f = await fixture();
  try {
    await f.queue.ensureWebhookEnqueued(f.receipt.id);
    await f.queue.work({
      async processInbox() {
        throw new Error('synthetic-body-SECRET');
      },
      async refreshCredential() {
        throw new Error('unexpected refresh');
      },
    });
    let failed;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      [failed] = await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id });
      if (failed?.state === 'retry') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(failed?.state, 'retry');
    assert.deepEqual(failed.data, { inboxId: f.receipt.id });
    assert.doesNotMatch(JSON.stringify(failed.output), /SECRET/);
    assert.match(JSON.stringify(failed.output), /Webhook processing failed/);
    assert.equal(failed.retryLimit, 5);
  } finally {
    await f.close();
  }
});

test('real pg-boss terminal retry metadata cannot be reset or recreated', postgres, async () => {
  const f = await fixture();
  try {
    await f.queue.ensureWebhookEnqueued(f.receipt.id);
    for (let attempt = 0; attempt <= 5; attempt++) {
      const [job] = await f.boss.fetch(WEBHOOK_QUEUE, { batchSize: 1, includeMetadata: true });
      assert.equal(job.id, f.receipt.id);
      assert.equal(job.retryCount, attempt);
      assert.equal(job.retryLimit, 5);
      await f.boss.fail(
        WEBHOOK_QUEUE,
        { id: job.id, retryCount: job.retryCount },
        { errorClass: 'SyntheticProcessingFailure' },
      );
      if (attempt < 5) {
        assert.equal((await f.boss.findJobs(WEBHOOK_QUEUE, { id: job.id }))[0].state, 'retry');
        // Advance only this disposable test job's schedule through the public
        // API. Queue policy, retryCount and retryLimit remain the pinned values.
        await f.boss.update(WEBHOOK_QUEUE, undefined, { id: job.id, startAfter: new Date(0) });
      }
    }
    const [failed] = await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id });
    assert.equal(failed.state, 'failed');
    assert.equal(failed.retryCount, 5);
    await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /exhausted/);
    assert.equal((await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }))[0].state, 'failed');
    await f.boss.deleteJob(WEBHOOK_QUEUE, f.receipt.id);
    await assert.rejects(f.queue.ensureWebhookEnqueued(f.receipt.id), /exhausted/);
    assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }), []);
  } finally {
    await f.close();
  }
});

test('restricted consumer grants permit only required retention and queue metadata writes', postgres, async () => {
  const f = await fixture();
  const role = `retention_${randomUUID().replaceAll('-', '')}`;
  let restrictedCore;
  let restrictedQueue;
  let restrictedPool;
  try {
    const grants = (
      await readFile(new URL('../../../scripts/m5-024/queue-roles.sql', import.meta.url), 'utf8')
    ).replaceAll('pgboss', f.schema);
    await f.pool.query(grants);
    await f.pool.query(`CREATE ROLE ${role} LOGIN; GRANT insignia_queue_consume TO ${role}`);
    const url = new URL(f.connectionString);
    url.username = role;
    url.password = '';
    restrictedPool = new Pool({ connectionString: url.href });
    restrictedCore = createDurableCore(new Pool({ connectionString: url.href }));
    restrictedQueue = createPgBossRuntime({
      connectionString: url.href,
      schema: f.schema,
      webhookHandoff: restrictedCore.webhooks,
      credentialKeysReady: true,
    });
    await restrictedQueue.start();
    await restrictedQueue.ensureWebhookEnqueued(f.receipt.id);
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = await durableHandlers.maintainWebhookRetention(restrictedCore, restrictedQueue);
    assert.ok(result.erasedIds.includes(f.receipt.id));
    assert.ok(result.cleanedIds.includes(f.receipt.id));
    for (const statement of [
      'UPDATE inbox_messages SET purge_after=clock_timestamp()',
      'UPDATE inbox_messages SET collected_at=clock_timestamp()',
      "UPDATE inbox_messages SET payload_sha256=repeat('a',64)",
      "UPDATE shopify_webhook_deliveries SET delivery_id='rewrite'",
      'CREATE TABLE public.retention_escape(id int)',
    ])
      await assert.rejects(restrictedPool.query(statement), { code: '42501' });
  } finally {
    if (restrictedQueue) await restrictedQueue.stop();
    if (restrictedCore) await restrictedCore.close();
    if (restrictedPool) await restrictedPool.end();
    await f.pool.query(`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`);
    await f.close();
  }
});

test('real deleted-job cleanup ACK loss leaves a durable retryable cleanup marker', postgres, async () => {
  const f = await fixture();
  try {
    await f.queue.ensureWebhookEnqueued(f.receipt.id);
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    await f.core.webhooks.eraseExpiredPayloads(100);
    const remove = f.boss.deleteJob.bind(f.boss);
    f.boss.deleteJob = async (...args) => {
      await remove(...args);
      throw new Error('synthetic cleanup ACK loss');
    };
    await assert.rejects(
      f.core.webhooks.cleanupExpiredQueueJobs(100, (id) => f.queue.removeExpiredWebhookJob(id)),
      /ACK loss/,
    );
    assert.equal(
      (
        await f.pool.query('SELECT queue_cleanup_pending FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
          f.receipt.id,
        ])
      ).rows[0].queue_cleanup_pending,
      true,
    );
    f.boss.deleteJob = remove;
    assert.ok(
      (await f.core.webhooks.cleanupExpiredQueueJobs(100, (id) => f.queue.removeExpiredWebhookJob(id))).includes(
        f.receipt.id,
      ),
    );
    assert.equal(
      (
        await f.pool.query('SELECT queue_cleanup_pending FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
          f.receipt.id,
        ])
      ).rows[0].queue_cleanup_pending,
      false,
    );
  } finally {
    await f.close();
  }
});

test(
  'enqueue-only queue role cannot acknowledge application handoff; narrow metadata grants can',
  postgres,
  async () => {
    const f = await fixture();
    const role = `retention_producer_${randomUUID().replaceAll('-', '')}`;
    let producerCore;
    let producerQueue;
    let producerPool;
    try {
      await f.pool.query(
        (await readFile(new URL('../../../scripts/m5-024/queue-roles.sql', import.meta.url), 'utf8')).replaceAll(
          'pgboss',
          f.schema,
        ),
      );
      await f.pool.query(`CREATE ROLE ${role} LOGIN; GRANT insignia_queue_enqueue TO ${role}`);
      const url = new URL(f.connectionString);
      url.username = role;
      url.password = '';
      producerPool = new Pool({ connectionString: url.href });
      producerCore = createDurableCore(new Pool({ connectionString: url.href }));
      producerQueue = createPgBossRuntime({
        connectionString: url.href,
        schema: f.schema,
        webhookHandoff: producerCore.webhooks,
      });
      await producerQueue.start();
      await assert.rejects(producerQueue.ensureWebhookEnqueued(f.receipt.id), { code: '42501' });
      // This tests only the additional handoff component, not all web ingress or
      // production role provisioning. The actual production grants remain unknown.
      await f.pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT(id,source,retention_class,erasure_state,purge_after,state,last_error_class) ON inbox_messages TO ${role};
      GRANT UPDATE(state,last_error_class) ON inbox_messages TO ${role};
      GRANT SELECT(inbox_id,queue_handoff_state) ON shopify_webhook_deliveries TO ${role};
      GRANT UPDATE(queue_handoff_state,queue_cleanup_pending) ON shopify_webhook_deliveries TO ${role}`);
      assert.deepEqual(await producerQueue.ensureWebhookEnqueued(f.receipt.id), {
        inboxId: f.receipt.id,
        status: 'enqueued',
      });
      assert.deepEqual(await producerQueue.ensureWebhookEnqueued(f.receipt.id), {
        inboxId: f.receipt.id,
        status: 'already_enqueued',
      });
      await assert.rejects(producerPool.query('SELECT payload FROM inbox_messages'), { code: '42501' });
      await assert.rejects(producerPool.query('UPDATE inbox_messages SET purge_after=clock_timestamp()'), {
        code: '42501',
      });
      await assert.rejects(producerPool.query('DELETE FROM inbox_messages'), { code: '42501' });
    } finally {
      await producerQueue?.stop();
      await producerCore?.close();
      await producerPool?.end();
      await f.pool.query(`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`);
      await f.close();
    }
  },
);
