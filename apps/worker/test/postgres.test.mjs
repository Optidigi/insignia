import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PgBoss } from 'pg-boss';
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
