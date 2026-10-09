import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { recoverPendingUninstalls } from '../../apps/worker/dist/handlers.js';
import { createPgBossRuntime, WEBHOOK_QUEUE } from '../../apps/worker/dist/runtime.js';
import { createDurableCore } from '../../packages/database/dist/index.js';
import { installQueue } from './install-queue.mjs';

const requireWorker = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Pool } = requireWorker('pg');
const { PgBoss } = await import(requireWorker.resolve('pg-boss'));

async function isolatedDatabase() {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = `m5024_crash_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let created = false;
  async function close() {
    try {
      if (created) await admin.query(`DROP DATABASE ${database}`);
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

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error('bounded crash recovery did not settle');
}

test('real process death before transaction and after quarantine recovers transport without completing uninstall', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 60_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  // Recovery scans the application inbox as well as its queue. Own both so a
  // previous suite's pending receipts cannot compete with this process control.
  const database = await isolatedDatabase();
  const { connectionString } = database;
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }));
  const producer = createPgBossRuntime({ webhookHandoff: core.webhooks, connectionString });
  const maintenance = new PgBoss({
    connectionString,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    persistQueueStats: false,
    monitorVacuum: false,
    reindex: false,
  });
  maintenance.on('error', () => {});
  let child;
  try {
    await installQueue(connectionString);
    await producer.start();
    await maintenance.start();
    for (const phase of ['before-transaction', 'after-quarantine']) {
      const shopId = randomUUID();
      const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
      const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
      await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId }));
      const receipt = await core.webhooks.receive({
        shopDomain: domain,
        deliveryId: randomUUID(),
        topic: 'app/uninstalled',
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: domain })),
      });
      // Simulate committed inbox followed by producer death before send: no receipt/job yet.
      assert.equal((await pool.query('select count(*)::int n from pgboss.job where id=$1', [receipt.id])).rows[0].n, 0);
      await recoverPendingUninstalls(core, producer);
      assert.equal((await pool.query('select count(*)::int n from pgboss.job where id=$1', [receipt.id])).rows[0].n, 1);
      const env = { ...process.env, DATABASE_URL: connectionString, M5_TEST_INBOX_ID: receipt.id };
      child = fork(new URL('./crash-child.mjs', import.meta.url), [phase], {
        env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let reached = false;
      child.on('message', (message) => {
        if (message.phase === phase && message.id === receipt.id) reached = true;
      });
      await until(async () => reached);
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGKILL');
      await closed;
      const pre = (await pool.query('select state, attempts from inbox_messages where id=$1', [receipt.id])).rows[0];
      assert.equal(pre.state, 'pending');
      assert.equal(pre.attempts, 0);
      // Explicit synthetic clock seam: make the real acquired lease expired, without waiting 120s.
      await pool.query("update pgboss.job set started_on=now()-interval '121 seconds' where id=$1 and state='active'", [
        receipt.id,
      ]);
      await pool.query(
        "update pgboss.queue set monitor_on=now()-interval '61 seconds', monitor_claim_on=null where name=$1",
        [WEBHOOK_QUEUE],
      );
      await maintenance.supervise(WEBHOOK_QUEUE);
      assert.equal((await maintenance.findJobs(WEBHOOK_QUEUE, { id: receipt.id }))[0]?.state, 'retry');
      child = fork(new URL('./crash-child.mjs', import.meta.url), ['normal'], {
        env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      await until(
        async () => (await maintenance.findJobs(WEBHOOK_QUEUE, { id: receipt.id }))[0]?.state === 'completed',
      );
      const final = (await pool.query('select state, attempts from inbox_messages where id=$1', [receipt.id])).rows[0];
      assert.deepEqual(final, { state: 'pending', attempts: 0 });
      assert.equal((await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
      assert.equal((await core.webhooks.getById(receipt.id)).resolution, 'unqualified');
      const ended = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([ended, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await ended;
      child = undefined;
      assert.equal((await producer.ensureWebhookEnqueued(receipt.id)).status, 'already_enqueued');
    }
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = new Promise((resolve) => child.once('close', resolve));
        child.kill('SIGKILL');
        await closed;
      }
      await producer.stop();
      await maintenance.stop({ graceful: true });
      await core.close();
      await pool.end();
    } finally {
      await database.close();
    }
  }
});
