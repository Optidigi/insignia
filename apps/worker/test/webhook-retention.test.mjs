import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDurableCore } from '@insignia/database';
import { createObservability } from '@insignia/observability';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';
import * as durableHandlers from '../dist/handlers.js';
import { createPgBossRuntime, REFRESH_QUEUE, WEBHOOK_QUEUE } from '../dist/runtime.js';

const connectionString = process.env.DATABASE_URL;
const postgres = { skip: !connectionString && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1', timeout: 30_000 };

async function fixture({ observability } = {}) {
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
  const queue = createPgBossRuntime({ boss, webhookHandoff: core.webhooks, credentialKeysReady: true, observability });
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

test('bounded recovery advances past100 settled quarantines after an independent restart', postgres, async () => {
  const f = await fixture();
  let restartedCore;
  let restartedQueue;
  try {
    const shopId = randomUUID();
    const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    await f.core.transactions.run((tx) => f.core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId: '456' }));
    const delivery = () => ({
      shopDomain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: '456', myshopify_domain: shopDomain })),
    });
    const older = [];
    for (let index = 0; index < 100; index++) {
      const receipt = await f.core.webhooks.receive(delivery());
      older.push(receipt.id);
      await f.queue.ensureWebhookEnqueued(receipt.id);
    }
    // Real pinned queue claims/completion establish the starting backlog without
    // spending100 polling intervals. Public handlers still quarantine each body.
    const handlers = durableHandlers.createDurableWorkerHandlers(f.core, {
      async refresh() {
        throw new Error('no provider requests');
      },
    });
    const jobs = await f.boss.fetch(WEBHOOK_QUEUE, { batchSize: 100, includeMetadata: true });
    assert.equal(jobs.length, 100);
    for (const job of jobs) assert.equal(await handlers.processInbox(job.data.inboxId), 'deferred');
    await f.boss.complete(WEBHOOK_QUEUE, jobs);
    const before = (
      await f.pool.query(`SELECT id,state,retry_count FROM ${f.schema}.job WHERE id=ANY($1::uuid[]) ORDER BY id`, [
        older,
      ])
    ).rows;
    assert.equal(before.length, 100);
    assert.equal(
      before.every((job) => job.state === 'completed' && job.retry_count === 0),
      true,
    );
    const next = delivery();
    const target = await f.core.webhooks.receive(next);
    assert.equal((await f.core.webhooks.receive(next)).id, target.id, 'duplicate receipt must not create new work');
    assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: target.id }), []);
    await f.queue.stop();
    restartedCore = createDurableCore(new Pool({ connectionString: f.connectionString }));
    const restartedBoss = new PgBoss({
      connectionString: f.connectionString,
      schema: f.schema,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: false,
    });
    restartedQueue = createPgBossRuntime({
      boss: restartedBoss,
      webhookHandoff: restartedCore.webhooks,
      credentialKeysReady: true,
    });
    await restartedQueue.start();
    // Persisted fair selection must advance within two bounded100-row cycles.
    // Business pending is retained; neither completed jobs nor ACKs supply authority.
    await durableHandlers.recoverPendingUninstalls(restartedCore, restartedQueue);
    await durableHandlers.recoverPendingUninstalls(restartedCore, restartedQueue);
    const recovered = await restartedBoss.findJobs(WEBHOOK_QUEUE, { id: target.id });
    assert.equal(recovered.length, 1, 'Committed receipt101 must recover despite100 settled quarantines');
    assert.equal(recovered[0].state, 'created');
    assert.equal(recovered[0].retryCount, 0);
    assert.deepEqual(
      (
        await f.pool.query(`SELECT id,state,retry_count FROM ${f.schema}.job WHERE id=ANY($1::uuid[]) ORDER BY id`, [
          older,
        ])
      ).rows,
      before,
    );
    assert.equal((await restartedCore.tenants.getCurrentAdminInstallation(shopId)).active, true);
    assert.equal((await restartedCore.webhooks.getById(target.id)).resolution, 'unqualified');
    assert.equal((await restartedCore.webhooks.getById(target.id)).state, 'pending');
    // Confirmed tail jobs are still audited. Deleting this exact associated job
    // cannot recreate its budget or conceal the unresolved obligation.
    await restartedBoss.deleteJob(WEBHOOK_QUEUE, target.id);
    await durableHandlers.recoverPendingUninstalls(restartedCore, restartedQueue);
    assert.deepEqual(await restartedBoss.findJobs(WEBHOOK_QUEUE, { id: target.id }), []);
    assert.equal((await restartedCore.webhooks.getById(target.id)).resolution, 'exhausted');
    assert.equal(
      (await f.pool.query('SELECT last_error_class FROM inbox_messages WHERE id=$1', [target.id])).rows[0]
        .last_error_class,
      'webhook_queue_missing',
    );
  } finally {
    await restartedQueue?.stop();
    await restartedCore?.close();
    await f.close();
  }
});

test('durable transport selection survives unaudited crash and concurrent locked inboxes', postgres, async () => {
  const f = await fixture();
  const selectionName = `recovery-selection-${randomUUID()}`;
  const independent = createDurableCore(
    new Pool({ connectionString: f.connectionString, application_name: selectionName }),
  );
  let waitingSelection;
  let resumedQueue;
  const blocker = await f.pool.connect();
  try {
    const shopDomain = (await f.core.webhooks.getById(f.receipt.id)).shopDomain;
    const shopId = randomUUID();
    await f.core.transactions.run((tx) => f.core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId: '123' }));
    const ids = [f.receipt.id];
    for (let index = 0; index < 2; index++)
      ids.push(
        (
          await f.core.webhooks.receive({
            shopDomain,
            deliveryId: randomUUID(),
            topic: 'app/uninstalled',
            apiVersion: '2026-07',
            triggeredAt: new Date(),
            eventId: null,
            name: null,
            rawBody: Buffer.from(JSON.stringify({ id: '123', myshopify_domain: null })),
          })
        ).id,
      );
    // Tie only trusted fixture collection order; unsigned trigger times do not order selection.
    await f.pool.query(
      "UPDATE inbox_messages SET received_at=statement_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    const ordered = [...ids].sort();
    const before = (
      await f.pool.query(
        'SELECT id,payload,purge_after,state,attempts FROM inbox_messages WHERE id=ANY($1::uuid[]) ORDER BY id',
        [ids],
      )
    ).rows;
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM inbox_messages WHERE id=$1 FOR UPDATE', [ordered[0]]);
    await blocker.query('SELECT inbox_id FROM shopify_webhook_deliveries WHERE inbox_id=$1 FOR UPDATE', [ordered[1]]);
    waitingSelection = independent.webhooks.selectUninstallRecoveryIds(1);
    let waitingOnDelivery = false;
    for (let index = 0; index < 100; index++) {
      const waiting = await f.pool.query(
        `SELECT 1 FROM pg_stat_activity WHERE application_name=$1
        AND wait_event_type='Lock' AND query LIKE 'update "shopify_webhook_deliveries" set "queue_recovery_selected_at"%'`,
        [selectionName],
      );
      if (waiting.rowCount === 1) {
        waitingOnDelivery = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waitingOnDelivery, true, 'first selector holds inbox before waiting on its delivery');
    assert.deepEqual(
      await f.core.webhooks.selectUninstallRecoveryIds(1),
      [ordered[2]],
      'second selector skips both actually locked inbox rows',
    );
    await blocker.query('COMMIT');
    assert.deepEqual(await waitingSelection, [ordered[1]]);
    // Neither selector audits the queue. Durable timestamps rotate after those
    // exact held-lock intervals; overlapping post-release snapshots may repeat an audit.
    assert.deepEqual(await independent.webhooks.selectUninstallRecoveryIds(1), [ordered[0]]);
    const rotated = await independent.webhooks.selectUninstallRecoveryIds(1);
    assert.equal(rotated.length, 1);
    assert.ok(
      [ordered[1], ordered[2]].includes(rotated[0]),
      'an unaudited selected receipt rotates back after older unchecked rows',
    );
    const newcomer = await f.core.webhooks.receive({
      shopDomain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt: new Date('2099-01-01'),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: '123', myshopify_domain: null })),
    });
    const next = await independent.webhooks.selectUninstallRecoveryIds(1);
    assert.equal(next.length, 1);
    assert.notEqual(next[0], newcomer.id, 'new unselected arrivals cannot starve older selected work');

    assert.deepEqual(
      (
        await f.pool.query(
          'SELECT id,payload,purge_after,state,attempts FROM inbox_messages WHERE id=ANY($1::uuid[]) ORDER BY id',
          [ids],
        )
      ).rows,
      before,
    );
    assert.equal(
      (await f.pool.query(`SELECT count(*)::int n FROM ${f.schema}.job WHERE id=ANY($1::uuid[])`, [ids])).rows[0].n,
      0,
      'selection alone grants no send',
    );
    assert.equal(
      (
        await f.pool.query(
          `SELECT count(*)::int n FROM shopify_webhook_deliveries WHERE inbox_id=ANY($1::uuid[]) AND queue_handoff_state='unconfirmed' AND queue_recovery_selected_at IS NOT NULL`,
          [ids],
        )
      ).rows[0].n,
      3,
    );
    // Actual stopped transport rejects every audit. Selection commits without
    // a fabricated ACK, inbox success or a consumed first-send reservation.
    await f.queue.stop();
    assert.equal(await durableHandlers.recoverPendingUninstalls(f.core, f.queue), 0);
    const all = [...ids, newcomer.id];
    assert.equal(
      (
        await f.pool.query(
          `SELECT count(*)::int n FROM shopify_webhook_deliveries WHERE inbox_id=ANY($1::uuid[]) AND queue_handoff_state='unconfirmed' AND queue_recovery_selected_at IS NOT NULL`,
          [all],
        )
      ).rows[0].n,
      4,
    );
    assert.equal(
      (await f.pool.query(`SELECT count(*)::int n FROM ${f.schema}.job WHERE id=ANY($1::uuid[])`, [all])).rows[0].n,
      0,
    );
    const resumedBoss = new PgBoss({
      connectionString: f.connectionString,
      schema: f.schema,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: false,
    });
    resumedQueue = createPgBossRuntime({
      boss: resumedBoss,
      webhookHandoff: independent.webhooks,
      credentialKeysReady: true,
    });
    await resumedQueue.start();
    assert.equal(await durableHandlers.recoverPendingUninstalls(independent, resumedQueue), 4);
    assert.equal(
      (
        await f.pool.query(
          `SELECT count(*)::int n FROM ${f.schema}.job WHERE id=ANY($1::uuid[]) AND state='created' AND retry_count=0`,
          [all],
        )
      ).rows[0].n,
      4,
    );
    assert.deepEqual(
      (
        await f.pool.query(
          'SELECT id,payload,purge_after,state,attempts FROM inbox_messages WHERE id=ANY($1::uuid[]) ORDER BY id',
          [ids],
        )
      ).rows,
      before,
    );
    assert.equal((await f.core.tenants.getCurrentAdminInstallation(shopId)).active, true);
  } finally {
    await blocker.query('ROLLBACK');
    await waitingSelection?.catch(() => {});
    blocker.release();
    await resumedQueue?.stop();
    await independent.close();
    await f.close();
  }
});

test(
  'processed overdue uninstall blockers retain their safe category through the real public logger',
  postgres,
  async () => {
    let output = '';
    const observability = createObservability({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk;
          callback();
        },
      }),
    });
    const f = await fixture({ observability });
    try {
      const shopId = randomUUID();
      const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
      await f.core.transactions.run((tx) =>
        f.core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId: '456' }),
      );
      const rawBody = Buffer.from(
        JSON.stringify({
          id: '456',
          myshopify_domain: shopDomain,
          customer: { id: '789' },
          orders_to_redact: ['123'],
        }),
      );
      const receipt = await f.core.webhooks.receive({
        shopDomain,
        deliveryId: randomUUID(),
        topic: 'app/uninstalled',
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody,
      });
      assert.equal(await f.core.webhooks.processUninstall(receipt.id), 'unqualified');
      // Synthetic historical completion; no corrected production path creates it.
      await f.pool.query("UPDATE inbox_messages SET state='processed' WHERE id=$1", [receipt.id]);
      await f.pool.query(
        `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`,
        [receipt.id],
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      const result = await durableHandlers.maintainWebhookRetention(f.core, f.queue);
      assert.deepEqual(result.erasedIds, []);
      assert.deepEqual(result.unresolvedExpiredIds, []);
      assert.deepEqual(result.blockedUninstallIds, [receipt.id]);
      const alert = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((record) => record.errorClass === 'UninstallPayloadRetentionBlocked');
      assert.ok(alert);
      assert.equal(alert.count, 1);
      assert.deepEqual(Object.keys(alert).sort(), ['count', 'errorClass', 'event', 'level', 'time']);
      const serialized = JSON.stringify(alert);
      for (const privateValue of [shopId, shopDomain, receipt.id, 'orders_to_redact', 'customer'])
        assert.equal(serialized.includes(privateValue), false);
      assert.deepEqual(
        (await f.pool.query('SELECT payload FROM inbox_messages WHERE id=$1', [receipt.id])).rows[0].payload,
        rawBody,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'real PostgreSQL unsupported receipt blockers stay bounded and alert without losing economic sole facts',
  postgres,
  async () => {
    let output = '';
    const observability = createObservability({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk;
          callback();
        },
      }),
    });
    const f = await fixture({ observability });
    try {
      const unsupportedIds = [];
      for (let index = 0; index < 101; index++) {
        const receipt = await f.core.webhooks.receive({
          shopDomain: 'synthetic-orders.myshopify.com',
          topic: 'orders/paid',
          deliveryId: randomUUID(),
          apiVersion: '2026-07',
          triggeredAt: new Date(),
          eventId: null,
          name: null,
          rawBody: Buffer.from(JSON.stringify({ id: String(index + 1), currency: 'EUR', total_price: '12.34' })),
        });
        unsupportedIds.push(receipt.id);
      }
      await f.queue.ensureWebhookEnqueued(f.receipt.id);
      await f.pool.query(
        `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=ANY($1::uuid[])`,
        [[...unsupportedIds, f.receipt.id]],
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      const before = (
        await f.pool.query('SELECT id,payload,purge_after FROM inbox_messages WHERE id=ANY($1::uuid[]) ORDER BY id', [
          unsupportedIds,
        ])
      ).rows;
      const result = await durableHandlers.maintainWebhookRetention(f.core, f.queue);
      assert.deepEqual(result.erasedIds, []);
      assert.deepEqual(result.blockedUninstallIds, [f.receipt.id]);
      assert.equal(result.blockedUnsupportedIds.length, 100);
      assert.deepEqual(result.blockedPrivacyIds, []);
      assert.deepEqual(result.blockedUnknownIds, []);
      assert.deepEqual(
        (
          await f.pool.query('SELECT id,payload,purge_after FROM inbox_messages WHERE id=ANY($1::uuid[]) ORDER BY id', [
            unsupportedIds,
          ])
        ).rows,
        before,
      );
      assert.equal(
        (
          await f.pool.query(
            `SELECT count(*)::int AS count FROM inbox_messages WHERE id=ANY($1::uuid[])
      AND state='pending' AND erasure_state='retained' AND purge_after<clock_timestamp()`,
            [unsupportedIds],
          )
        ).rows[0].count,
        101,
      );
      const records = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const alert = records.find((record) => record.errorClass === 'UnsupportedPayloadRetentionBlocked');
      assert.ok(alert);
      assert.equal(alert.count, 100);
      assert.deepEqual(Object.keys(alert).sort(), ['count', 'errorClass', 'event', 'level', 'time']);
      assert.doesNotMatch(JSON.stringify(alert), /synthetic-orders|total_price|currency|inboxId|shopId/);
    } finally {
      await f.close();
    }
  },
);

test('real pg-boss lost ACK and handoff rollback cannot recreate a deleted job retry budget', postgres, async () => {
  const f = await fixture();
  try {
    const domain = (await f.core.webhooks.getById(f.receipt.id)).shopDomain;
    await f.core.transactions.run((tx) =>
      f.core.tenants.createShop(tx, {
        shopId: randomUUID(),
        shopDomain: domain,
        shopifyShopId: '123',
      }),
    );
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
    assert.equal(await durableHandlers.recoverPendingUninstalls(f.core, f.queue), 0);
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
      const domain = (await f.core.webhooks.getById(f.receipt.id)).shopDomain;
      await f.core.transactions.run((tx) =>
        f.core.tenants.createShop(tx, {
          shopId: randomUUID(),
          shopDomain: domain,
          shopifyShopId: '123',
        }),
      );
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
      assert.equal(await durableHandlers.recoverPendingUninstalls(f.core, f.queue), 1);
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

test(
  'real pg-boss expiry maintenance preserves sole facts and removes only exact associated jobs',
  postgres,
  async () => {
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
      assert.deepEqual(result.erasedIds, []);
      assert.ok(result.blockedUninstallIds.includes(f.receipt.id));
      assert.ok(result.unresolvedExpiredIds.includes(f.receipt.id));
      assert.ok(result.cleanedIds.includes(f.receipt.id));
      assert.deepEqual(await f.boss.findJobs(WEBHOOK_QUEUE, { id: f.receipt.id }), []);
      assert.equal((await f.boss.findJobs(REFRESH_QUEUE, { id: refreshId })).length, 1);
      assert.equal((await f.boss.findJobs(WEBHOOK_QUEUE, { id: unrelatedId })).length, 1);
      assert.equal(
        (await f.pool.query('SELECT octet_length(payload) AS bytes FROM inbox_messages WHERE id=$1', [f.receipt.id]))
          .rows[0].bytes,
        Buffer.byteLength(JSON.stringify({ id: '123', myshopify_domain: null })),
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
  },
);

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
    const domain = (await f.core.webhooks.getById(f.receipt.id)).shopDomain;
    await f.core.transactions.run((tx) =>
      f.core.tenants.createShop(tx, {
        shopId: randomUUID(),
        shopDomain: domain,
        shopifyShopId: '123',
      }),
    );
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
    assert.equal(await durableHandlers.recoverPendingUninstalls(f.core, f.queue), 0);
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
  const testPassword = randomUUID().replaceAll('-', '');
  let restrictedCore;
  let restrictedQueue;
  let restrictedPool;
  try {
    const domain = (await f.core.webhooks.getById(f.receipt.id)).shopDomain;
    await f.core.transactions.run((tx) =>
      f.core.tenants.createShop(tx, {
        shopId: randomUUID(),
        shopDomain: domain,
        shopifyShopId: '123',
      }),
    );
    const grants = (
      await readFile(new URL('../../../scripts/m5-024/queue-roles.sql', import.meta.url), 'utf8')
    ).replaceAll('pgboss', f.schema);
    await f.pool.query(grants);
    await f.pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${testPassword}'; GRANT insignia_queue_consume TO ${role}`);
    const url = new URL(f.connectionString);
    url.username = role;
    // Disposable synthetic credentials work with both local trust and CI SCRAM.
    url.password = testPassword;
    restrictedPool = new Pool({ connectionString: url.href });
    restrictedCore = createDurableCore(new Pool({ connectionString: url.href }));
    restrictedQueue = createPgBossRuntime({
      connectionString: url.href,
      schema: f.schema,
      webhookHandoff: restrictedCore.webhooks,
      credentialKeysReady: true,
    });
    await restrictedQueue.start();
    await f.pool.query(
      'REVOKE UPDATE(queue_recovery_selected_at) ON shopify_webhook_deliveries FROM insignia_queue_consume',
    );
    await assert.rejects(restrictedCore.webhooks.selectUninstallRecoveryIds(1), { code: '42501' });
    assert.equal(
      (
        await f.pool.query('SELECT queue_recovery_selected_at FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
          f.receipt.id,
        ])
      ).rows[0].queue_recovery_selected_at,
      null,
    );
    await f.pool.query(
      'GRANT UPDATE(queue_recovery_selected_at) ON shopify_webhook_deliveries TO insignia_queue_consume',
    );
    assert.deepEqual(await restrictedCore.webhooks.selectUninstallRecoveryIds(1), [f.receipt.id]);
    assert.equal(
      (
        await f.pool.query(
          "SELECT has_column_privilege('insignia_queue_enqueue','shopify_webhook_deliveries','queue_recovery_selected_at','UPDATE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await restrictedQueue.ensureWebhookEnqueued(f.receipt.id);
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = await durableHandlers.maintainWebhookRetention(restrictedCore, restrictedQueue);
    assert.deepEqual(result.erasedIds, []);
    assert.ok(result.blockedUninstallIds.includes(f.receipt.id));
    assert.ok(result.cleanedIds.includes(f.receipt.id));
    for (const statement of [
      "UPDATE inbox_messages SET payload=''::bytea WHERE false",
      "UPDATE inbox_messages SET erasure_state='erased' WHERE false",
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
    const testPassword = randomUUID().replaceAll('-', '');
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
      await f.pool.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${testPassword}'; GRANT insignia_queue_enqueue TO ${role}`,
      );
      const url = new URL(f.connectionString);
      url.username = role;
      url.password = testPassword;
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
