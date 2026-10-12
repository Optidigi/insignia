import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { applyOwnerLifecycleDecision, createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';
import { frozenSchema20Fixture } from '../../../scripts/m5-runtime/frozen-schema20-fixture.mjs';
import { createPgBossRuntime, WEBHOOK_QUEUE } from '../dist/runtime.js';

const adminUrl = process.env.M5_OWNER_LIFECYCLE_TEST_URL;
test('owner receipt erasure settles real pg-boss copy and a fresh worker process observes expiry without provider IO', {
  skip: !adminUrl,
  timeout: 30000,
}, async () => {
  const admin = new Pool({ connectionString: adminUrl });
  const c = await admin.connect();
  const database = `m5ownworker_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(adminUrl);
  url.username = 'insignia_rewrite';
  url.pathname = `/${database}`;
  const compatibility = await frozenSchema20Fixture();
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  let role = false,
    db = false,
    pool,
    core,
    queue;
  try {
    assert.equal((await c.query("select rolname from pg_roles where rolname='insignia_rewrite'")).rowCount, 0);
    await c.query("set log_statement='none';set log_min_error_statement='panic'");
    await c.query(`create role insignia_rewrite login superuser password '${url.password}'`);
    role = true;
    await c.query(`create database ${database} owner insignia_rewrite`);
    db = true;
    await promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${compatibility.directory}/packages/database/migrations`, 'up'],
      { env: { ...process.env, DATABASE_URL: url.href } },
    );
    await installQueue(url.href);
    pool = new Pool({ connectionString: url.href });
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM schema_migrations')).rows[0].n, 20);
    assert.equal((await pool.query("SELECT to_regclass('public.artwork_assets') AS artwork")).rows[0].artwork, null);
    core = createDurableCore(new Pool({ connectionString: url.href }));
    const boss = new PgBoss({
      connectionString: url.href,
      schema: 'pgboss',
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: false,
    });
    queue = createPgBossRuntime({ boss, webhookHandoff: core.webhooks, credentialKeysReady: true });
    await queue.start();
    const domain = 'stitchs-vat-verification-20261004.myshopify.com';
    const raw = Buffer.from('{"shop_id":123,"customer":{"email":"synthetic-private@example.test"}}');
    const receipt = await core.webhooks.receive({
      shopDomain: domain,
      topic: 'customers/redact',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: raw,
    });
    await queue.ensureWebhookEnqueued(receipt.id);
    const job = await boss.getJobById(WEBHOOK_QUEUE, receipt.id);
    assert.deepEqual(job?.data, { inboxId: receipt.id });
    const time = (
      await pool.query(
        `select to_char(collected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value from inbox_messages where id=$1`,
        [receipt.id],
      )
    ).rows[0].value;
    const decision = {
      version: 'm5-owner-lifecycle-v1',
      decisionId: randomUUID(),
      appClientId: 'a'.repeat(32),
      providerShopId: '123',
      shopId: null,
      shopDomain: domain,
      installationGeneration: null,
      externalInstallationId: null,
      operation: 'OWNER_RECEIPT_ERASURE',
      authority: { kind: 'EXPLICIT_OWNER_REQUEST', requestEvidenceSha256: 'a'.repeat(64) },
      native: {
        kind: 'OWNER_NATIVE_ATTESTATION',
        evidenceSha256: 'b'.repeat(64),
        preInstallationInventorySha256: 'c'.repeat(64),
        destinationEffectsQualification: 'PASS_BOUND_ALLOCATED_STORE',
        exactAppShopBound: true,
        currentStatus: 'ABSENT',
        currentExternalInstallationId: null,
        observedAt: new Date().toISOString(),
      },
      privacy: {
        cutoff: time,
        sinks: {
          database: 'QUALIFIED',
          queue: 'QUALIFIED',
          privateCopies: 'ERASED',
          backups: 'RESTORE_EXCLUSION_QUALIFIED',
        },
        receipts: [{ id: receipt.id, bodySha256: createHash('sha256').update(raw).digest('hex'), collectedAt: time }],
      },
    };
    assert.equal((await applyOwnerLifecycleDecision(pool, decision)).receiptDispositionOnly, true);
    const code = `globalThis.fetch=()=>{throw new Error('network_escape_denied')}; const {createDurableCore}=await import('@insignia/database');const {createDurableWorkerHandlers}=await import('./dist/handlers.js');const {Pool}=await import('pg');const core=createDurableCore(new Pool({connectionString:process.env.DATABASE_URL}));try{const handlers=createDurableWorkerHandlers(core,{refresh:async()=>{throw new Error('provider_request_denied')}});console.log(JSON.stringify({outcome:await handlers.processInbox(process.env.SYNTHETIC_RECEIPT_ID)}));}finally{await core.close();}`;
    const readback = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      cwd: `${root}apps/worker`,
      env: { ...process.env, DATABASE_URL: url.href, SYNTHETIC_RECEIPT_ID: receipt.id },
      timeout: 10000,
    });
    assert.deepEqual(JSON.parse(readback.stdout), { outcome: 'expired' });
    assert.deepEqual(await core.webhooks.cleanupExpiredQueueJobs(100, (id) => queue.removeExpiredWebhookJob(id)), [
      receipt.id,
    ]);
    assert.equal(await boss.getJobById(WEBHOOK_QUEUE, receipt.id), null);
    const tombstone = (
      await pool.query('select result from owner_lifecycle_decisions where decision_id=$1', [decision.decisionId])
    ).rows[0].result;
    assert.deepEqual(tombstone.restoreExclusions, decision.privacy.receipts);
    assert.equal(tombstone.receiptDispositionOnly, true);
  } finally {
    await queue?.stop();
    await core?.close();
    await pool?.end();
    if (db) await c.query(`drop database ${database}`);
    if (role) await c.query('drop role insignia_rewrite');
    c.release();
    await admin.end();
    await rm(compatibility.directory, { recursive: true, force: true });
  }
});
