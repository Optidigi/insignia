import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { recoverPendingUninstalls } from '../../apps/worker/dist/handlers.js';
import { createPgBossRuntime, WEBHOOK_QUEUE } from '../../apps/worker/dist/runtime.js';
import { createDurableCore } from '../../packages/database/dist/index.js';
import { installQueue } from './install-queue.mjs';

const requireWorker = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Pool } = requireWorker('pg');
const { PgBoss } = await import(requireWorker.resolve('pg-boss'));

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error('bounded crash recovery did not settle');
}

test('real process death before transaction and after commit recovers durable queued uninstalls once', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 60_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  await installQueue(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const producer = createPgBossRuntime({ connectionString: process.env.DATABASE_URL });
  const maintenance = new PgBoss({
    connectionString: process.env.DATABASE_URL,
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
    await producer.start();
    await maintenance.start();
    for (const phase of ['before-transaction', 'after-commit']) {
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
      const env = { ...process.env, M5_TEST_INBOX_ID: receipt.id };
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
      assert.equal(pre.state, phase === 'after-commit' ? 'processed' : 'pending');
      assert.equal(pre.attempts, phase === 'after-commit' ? 1 : 0);
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
      assert.deepEqual(final, { state: 'processed', attempts: 1 });
      assert.ok(
        (
          await pool.query('select deactivated_at from installation_generations where shop_id=$1 and generation=1', [
            shopId,
          ])
        ).rows[0].deactivated_at,
      );
      const ended = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([ended, delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
      child = undefined;
      assert.equal((await producer.ensureWebhookEnqueued(receipt.id)).status, 'already_enqueued');
    }
  } finally {
    child?.kill('SIGKILL');
    await producer.stop();
    await maintenance.stop({ graceful: true });
    await core.close();
    await pool.end();
  }
});
