import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDurableWorkerHandlers } from '../../apps/worker/dist/handlers.js';
import { createPgBossRuntime, WEBHOOK_QUEUE } from '../../apps/worker/dist/runtime.js';
import { queueBoundaryHandoff } from '../../apps/worker/test/queue-handoff-fixture.mjs';
import { createDurableCore } from '../../packages/database/dist/index.js';
import { installQueue } from './install-queue.mjs';

const requireWorker = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Pool } = requireWorker('pg');
const { PgBoss } = await import(requireWorker.resolve('pg-boss'));

async function isolatedDatabase() {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = `m5024_privileges_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let created = false;
  async function close(roles = []) {
    try {
      if (created) await admin.query(`DROP DATABASE ${database}`);
      for (const role of roles) await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    await promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
    );
    return { connectionString: url.href, close };
  } catch (error) {
    await close();
    throw error;
  }
}

test('separate owner installation and restricted queue roles preserve messages across restart and deny DDL', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 45_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  const database = await isolatedDatabase();
  const { connectionString } = database;
  const pool = new Pool({ connectionString });
  const role = `m5024_${randomUUID().replaceAll('-', '')}`;
  const workerRole = `${role}_w`;
  const testPassword = randomUUID().replaceAll('-', '');
  const url = new URL(connectionString);
  let producer;
  let worker;
  try {
    assert.deepEqual(await installQueue(connectionString), await installQueue(connectionString));
    await pool.query(await readFile(new URL('./queue-roles.sql', import.meta.url), 'utf8'));
    await pool.query(
      `create role ${role} login password '${testPassword}'; create role ${workerRole} login password '${testPassword}'; grant insignia_queue_enqueue to ${role}; grant insignia_queue_consume to ${workerRole}`,
    );
    // Disposable synthetic passwords support both SCRAM CI and local trust authentication.
    // Production login provisioning remains a separate owner-private operation.
    url.username = role;
    url.password = testPassword;
    const producerPool = new Pool({ connectionString: url.href });
    try {
      assert.equal((await producerPool.query('select current_user')).rows[0].current_user, role);
      for (const sql of [
        'create table pgboss.escape(id int)',
        'create schema escape',
        "select pgboss.create_queue('escape','{}')",
        'update pgboss.version set version=42',
        'delete from pgboss.job',
      ])
        await assert.rejects(producerPool.query(sql), { code: '42501' });
      assert.equal(
        (await producerPool.query("select has_schema_privilege('public','pgboss','USAGE') as allowed")).rows[0].allowed,
        false,
      );
    } finally {
      await producerPool.end();
    }
    producer = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, connectionString: url.href });
    await producer.start();
    await pool.query('revoke execute on function pgboss.job_now() from insignia_queue_enqueue');
    const denied = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, connectionString: url.href });
    await assert.rejects(denied.start());
    await denied.stop();
    await pool.query('grant execute on function pgboss.job_now() to insignia_queue_enqueue');
    const id = randomUUID();
    await producer.ensureWebhookEnqueued(id);
    await producer.stop();
    producer = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, connectionString: url.href });
    await producer.start();
    assert.equal((await producer.ensureWebhookEnqueued(id)).status, 'already_enqueued');
    url.username = workerRole;
    const boss = new PgBoss({
      connectionString: url.href,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: true,
      persistQueueStats: false,
      monitorVacuum: false,
      reindex: false,
    });
    boss.on('error', (error) => {
      throw error;
    });
    worker = createPgBossRuntime({ webhookHandoff: queueBoundaryHandoff, boss, credentialKeysReady: true });
    await worker.start();
    let attempts = 0;
    await worker.work({
      async processInbox(received) {
        if (received === id) {
          attempts++;
          if (attempts === 1) throw new Error('synthetic retry');
        }
      },
      async refreshCredential() {
        throw new Error('no provider transport');
      },
    });
    for (let i = 0; i < 150; i++) {
      if ((await boss.findJobs(WEBHOOK_QUEUE, { id }))[0]?.state === 'completed') break;
      await delay(200);
    }
    assert.equal((await boss.findJobs(WEBHOOK_QUEUE, { id }))[0]?.state, 'completed');
    assert.equal(attempts, 2);
    assert.equal(await worker.checkDurableReady(), true);
    const consumerPool = new Pool({ connectionString: url.href });
    try {
      assert.equal((await consumerPool.query('select current_user')).rows[0].current_user, workerRole);
      for (const sql of [
        'create table pgboss.escape(id int)',
        "select pgboss.create_queue('escape','{}')",
        'truncate pgboss.job',
        'update pgboss.queue set retry_limit=999',
        'update pgboss.version set version=42',
      ])
        await assert.rejects(consumerPool.query(sql), { code: '42501' });
    } finally {
      await consumerPool.end();
    }
    await worker.stop();
    worker = undefined;
    const ownerCore = createDurableCore(new Pool({ connectionString }));
    const consumerCore = createDurableCore(new Pool({ connectionString: url.href }));
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
    try {
      await ownerCore.transactions.run((tx) =>
        ownerCore.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId }),
      );
      const receipt = await ownerCore.webhooks.receive({
        shopDomain: domain,
        deliveryId: randomUUID(),
        topic: 'app/uninstalled',
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: domain })),
      });
      await producer.ensureWebhookEnqueued(receipt.id);
      worker = createPgBossRuntime({
        webhookHandoff: consumerCore.webhooks,
        connectionString: url.href,
        credentialKeysReady: true,
      });
      await worker.start();
      await worker.work(
        createDurableWorkerHandlers(consumerCore, {
          async refresh() {
            throw new Error('no external requests');
          },
        }),
      );
      // The restricted consumer settles transport; generic HMAC routing does
      // not authorize uninstall processing or current-installation deactivation.
      for (let i = 0; i < 100; i++) {
        if ((await pool.query('select state from pgboss.job where id=$1', [receipt.id])).rows[0]?.state === 'completed')
          break;
        await delay(100);
      }
      assert.equal(
        (await pool.query('select state from pgboss.job where id=$1', [receipt.id])).rows[0]?.state,
        'completed',
      );
      assert.equal(
        (await pool.query('select state from inbox_messages where id=$1', [receipt.id])).rows[0].state,
        'pending',
      );
      const state = await ownerCore.webhooks.getById(receipt.id);
      assert.equal(state.resolution, 'unqualified');
      assert.equal(state.installationGeneration, null);
      assert.equal((await ownerCore.tenants.getCurrentAdminInstallation(shopId)).active, true);
      await worker.stop();
      worker = undefined;
    } finally {
      await ownerCore.close();
      await consumerCore.close();
    }

    const before = await pool.query('select id,state,data from pgboss.job where id=$1', [id]);
    await installQueue(connectionString);
    await pool.query(await readFile(new URL('./queue-roles.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await pool.query('select id,state,data from pgboss.job where id=$1', [id])).rows, before.rows);
  } finally {
    await worker?.stop();
    await producer?.stop();
    try {
      await pool.end();
    } finally {
      await database.close([role, workerRole]);
    }
  }
});
