import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/database/install-queue.mts';
import { isolatedDatabase } from '../../web/test/support/isolated-database.mts';
import { createWorkerDatabase } from '../dist/database.js';

test('worker core and pinned queue complete overlapping demand within a four-session LOGIN ceiling', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 30000,
}, async () => {
  const allocated = process.env.DATABASE_URL;
  assert(allocated);
  const source = new URL(allocated);
  const ownsCluster = /^\/tmp\/insignia-isolated-pg-/.test(source.searchParams.get('host') ?? '');
  if (!ownsCluster) {
    // The CI PostgreSQL service is separately admitted; never edit its host HBA.
    assert.equal(process.env.INSIGNIA_REQUIRE_POSTGRES_TEST, '1');
    assert.equal(source.username, 'synthetic_runtime_owner');
    assert.equal(source.pathname, '/insignia_test');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
  }
  const database = await isolatedDatabase('worker_budget');
  const endpoint = database.connectionString;
  const owner = new Pool({ connectionString: endpoint });
  const login = `budget_${randomUUID().replaceAll('-', '')}`;
  const password = randomBytes(32).toString('hex');
  const hba = ownsCluster ? (await owner.query('SHOW hba_file')).rows[0].hba_file : undefined;
  const previous = hba ? await readFile(hba, 'utf8') : undefined;
  let hbaChanged = false;
  let roleCreated = false;
  let worker: ReturnType<typeof createWorkerDatabase> | undefined;
  const pending: Promise<unknown>[] = [];
  const seed = createDurableCore(new Pool({ connectionString: endpoint }));
  try {
    await installQueue(endpoint);
    await owner.query(await readFile(new URL('../../../scripts/worker/queue-roles.sql', import.meta.url), 'utf8'));
    await owner.query("SET password_encryption='scram-sha-256'");
    await owner.query(`CREATE ROLE ${login} LOGIN CONNECTION LIMIT 4 PASSWORD '${password}'`);
    roleCreated = true;
    await owner.query(`GRANT insignia_queue_consume TO ${login}`);
    if (hba && previous !== undefined) {
      await writeFile(hba, `local all ${login} scram-sha-256\n${previous}`);
      hbaChanged = true;
      await owner.query('SELECT pg_reload_conf()');
    }
    assert.equal(
      (await owner.query("SELECT rolpassword LIKE 'SCRAM-SHA-256$%' AS scram FROM pg_authid WHERE rolname=$1", [login]))
        .rows[0].scram,
      true,
    );
    const url = new URL(endpoint);
    url.username = login;
    url.password = password;
    // Prove authentication is SCRAM rather than the fixture's default trust.
    const wrong = new URL(url);
    wrong.password = randomBytes(32).toString('hex');
    const denied = new Pool({ connectionString: wrong.href });
    try {
      await assert.rejects(denied.query('SELECT 1'), { code: '28P01' });
    } finally {
      await denied.end();
    }
    worker = createWorkerDatabase(url.href, {
      currentKeyId: 'synthetic-k1',
      keys: { 'synthetic-k1': Buffer.alloc(32, 7) },
    });
    assert.deepEqual((await worker.pool.query('SELECT session_user,current_user')).rows[0], {
      session_user: login,
      current_user: login,
    });
    assert.equal(
      (await owner.query('SELECT rolconnlimit FROM pg_roles WHERE rolname=$1', [login])).rows[0].rolconnlimit,
      4,
    );
    const release = await appendRelease(owner, seed);
    await owner.query(`GRANT SELECT ON trusted_release_records TO ${login}`);
    const shop = (
      await owner.query('SELECT shop_domain,shopify_shop_id FROM shops WHERE shop_id=$1', [release.scope.shopId])
    ).rows[0];
    const receipt = await seed.webhooks.receive({
      shopDomain: shop.shop_domain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: Number(shop.shopify_shop_id), myshopify_domain: shop.shop_domain })),
    });
    await worker.queue.start();
    // Owner holds a gate. Three independent core reads overlap queue demand;
    // bounded pools must queue excess work instead of opening a fifth session.
    await owner.query('SELECT pg_advisory_lock(7142981)');
    for (let i = 0; i < 3; i++) {
      const read = worker.pool.query('SELECT pg_advisory_xact_lock_shared(7142981)');
      read.catch(() => {});
      pending.push(read);
    }
    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      blocked = Number(
        (await owner.query("SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND wait_event='advisory'", [login]))
          .rows[0].count,
      );
      if (blocked >= 2) break;
      await delay(10);
    }
    assert.ok(blocked >= 2, 'core reads reached the database gate');
    const queue = worker.queue;
    const sends = Array.from({ length: 6 }, () => queue.enqueueRefresh(randomUUID(), 1));
    const results = await Promise.allSettled(sends);
    assert.deepEqual(
      results.filter((r) => r.status === 'rejected'),
      [],
      'queue overlap must not exceed LOGIN ceiling (53300)',
    );
    await owner.query('SELECT pg_advisory_unlock_all()');
    await Promise.all(pending);
    await worker.queue.work({
      async processInbox() {
        return undefined;
      },
      async refreshCredential() {
        return undefined;
      },
    });
    // Real handoff holds its own core transaction while calling the separate queue pool.
    const overlap = await Promise.all([
      worker.queue.ensureWebhookEnqueued(receipt.id),
      worker.core.trustedReleaseRecords.read({
        scope: release.scope,
        expectedActiveAppVersionRef: release.build.appVersionRef,
        now: new Date(),
      }),
      ...Array.from({ length: 6 }, () => queue.enqueueRefresh(randomUUID(), 1)),
    ]);
    assert.deepEqual(overlap[0], { inboxId: receipt.id, status: 'enqueued' });
    assert.equal(overlap[1]?.record.recordId, release.record.recordId);
    assert.deepEqual(await worker.queue.ensureWebhookEnqueued(receipt.id), {
      inboxId: receipt.id,
      status: 'already_enqueued',
    });
    assert.equal(await worker.queue.checkDurableReady(), true);
    assert.ok(
      Number((await owner.query('SELECT count(*) FROM pg_stat_activity WHERE usename=$1', [login])).rows[0].count) <= 4,
    );
  } finally {
    await owner.query('SELECT pg_advisory_unlock_all()');
    await Promise.allSettled(pending);
    await worker?.queue.stop();
    await worker?.core.close();
    await seed.close();
    if (hbaChanged && hba && previous !== undefined) {
      await writeFile(hba, previous);
      await owner.query('SELECT pg_reload_conf()');
    }
    if (roleCreated) {
      await owner.query(`DROP OWNED BY ${login}`);
      await owner.query(`DROP ROLE ${login}`);
    }
    await owner.end();
    await database.close();
  }
});

async function appendRelease(pool: Pool, core: ReturnType<typeof createDurableCore>) {
  const shopId = randomUUID();
  await core.transactions.run((tx) =>
    core.tenants.createShop(tx, {
      shopId,
      shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
      shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 12)}`) + 1n).toString(),
    }),
  );
  const observedAt = new Date().toISOString();
  const build = {
    schemaVersion: 1,
    shopId,
    installationGeneration: '1',
    appClientId: `trusted-${shopId}`,
    sourceCommit: 'a'.repeat(40),
    appVersionRef: '1158986629121',
    devPreviewRef: null,
    transform: {
      functionId: 'transform-id',
      handle: 'insignia-experimental-v2-transform',
      apiType: 'cart_transform',
      apiVersion: '2026-07',
      inputQuerySha256: 'b'.repeat(64),
      wasmSha256: 'c'.repeat(64),
    },
    validation: {
      functionId: 'validation-id',
      handle: 'insignia-experimental-v2-validation',
      apiType: 'cart_checkout_validation',
      apiVersion: '2026-07',
      inputQuerySha256: 'd'.repeat(64),
      wasmSha256: 'e'.repeat(64),
    },
  };
  const record = {
    version: 'm5-trusted-release-v1',
    recordId: randomUUID(),
    activeAppVersionRef: build.appVersionRef,
    attestation: {
      ...build,
      evidenceKind: 'RELEASE_BOUND',
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 30_000).toISOString(),
    },
  };
  const proof = 'f'.repeat(64);
  const digest = sha256CanonicalJson({
    trustedRecord: record,
    expectedBuild: build,
    activeVersionObservedAt: observedAt,
    activeVersionEvidenceSha256: proof,
  });
  await pool.query(
    'INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
    [record.recordId, shopId, build.appClientId, build.appVersionRef, build, record, observedAt, proof, digest],
  );
  return { scope: { shopId, installationGeneration: '1', appClientId: build.appClientId }, record, build };
}
