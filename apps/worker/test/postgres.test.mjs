import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { createDurableWorkerHandlers } from '../dist/handlers.js';
import { createPgBossRuntime, WEBHOOK_QUEUE } from '../dist/runtime.js';

const schema = 'pgboss_m3002_worker';

test('PostgreSQL pg-boss starts, retries, settles and replays after restart', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 45_000,
}, async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'DATABASE_URL is required for the PostgreSQL queue test');
  const inboxId = randomUUID();
  const boss = new PgBoss({ connectionString, schema });
  const queue = createPgBossRuntime({ boss, credentialKeysReady: true });
  let attempts = 0;
  try {
    await queue.start();
    assert.equal(await queue.schemaVersion(), 43);
    assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'enqueued' });
    assert.deepEqual(await queue.ensureWebhookEnqueued(inboxId), { inboxId, status: 'already_enqueued' });
    await queue.work({
      async processInbox(id) {
        assert.equal(id, inboxId);
        attempts++;
        if (attempts === 1) throw new Error('synthetic crash');
      },
      async refreshCredential() {
        throw new Error('unexpected refresh job');
      },
    });
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const [job] = await boss.findJobs(WEBHOOK_QUEUE, { id: inboxId });
      if (job?.state === 'completed') break;
      await delay(200);
    }
    const [settled] = await boss.findJobs(WEBHOOK_QUEUE, { id: inboxId });
    assert.equal(settled?.state, 'completed');
    assert.equal(attempts, 2);
  } finally {
    await queue.stop();
  }

  const restartedBoss = new PgBoss({ connectionString, schema });
  const restarted = createPgBossRuntime({ boss: restartedBoss });
  try {
    await restarted.start();
    assert.equal(await restarted.schemaVersion(), 43);
    assert.deepEqual(await restarted.ensureWebhookEnqueued(inboxId), { inboxId, status: 'already_enqueued' });
    const [existing] = await restartedBoss.findJobs(WEBHOOK_QUEUE, { id: inboxId });
    assert.equal(existing?.state, 'completed');
    assert.deepEqual(existing.data, { inboxId });
  } finally {
    await restarted.stop();
  }
});

test('pg-boss retry after committed uninstall retains one deactivation and one inbox fact', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 45_000,
}, async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }), {
    credentialKeys: { currentKeyId: 'synthetic-k1', keys: { 'synthetic-k1': Buffer.alloc(32, 41) } },
  });
  const boss = new PgBoss({ connectionString, schema });
  const queue = createPgBossRuntime({ boss, credentialKeysReady: true });
  const shopId = randomUUID();
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${createHash('sha256').update(domain).digest('hex').slice(0, 12)}`) + 1n).toString();
  let started = false;
  try {
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId }));
    const input = {
      shopDomain: domain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: Number(shopifyShopId), myshopify_domain: domain })),
    };
    const receipt = await core.webhooks.receive(input);
    const actual = createDurableWorkerHandlers(core, {
      async refresh() {
        throw new Error('unexpected refresh');
      },
    });
    let attempts = 0;
    await queue.start();
    started = true;
    await queue.ensureWebhookEnqueued(receipt.id);
    await queue.work({
      ...actual,
      async processInbox(id, context) {
        await actual.processInbox(id, context);
        attempts++;
        if (attempts === 1) throw new Error('synthetic crash after durable commit');
      },
    });
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const [job] = await boss.findJobs(WEBHOOK_QUEUE, { id: receipt.id });
      if (job?.state === 'completed') break;
      await delay(200);
    }
    const [job] = await boss.findJobs(WEBHOOK_QUEUE, { id: receipt.id });
    assert.equal(job?.state, 'completed');
    assert.equal(attempts, 2);
    const inbox = await pool.query('select id, state, attempts from inbox_messages where id = $1', [receipt.id]);
    assert.deepEqual(inbox.rows, [{ id: receipt.id, state: 'processed', attempts: 1 }]);
    const generation = await pool.query(
      'select deactivated_at from installation_generations where shop_id = $1 and generation = 1',
      [shopId],
    );
    assert.ok(generation.rows[0]?.deactivated_at);
    assert.deepEqual(await core.webhooks.receive(input), {
      kind: 'processed',
      id: receipt.id,
      shopId,
      installationGeneration: '1',
    });
  } finally {
    if (started) await queue.stop();
    await core.close();
    await pool.end();
  }
});
