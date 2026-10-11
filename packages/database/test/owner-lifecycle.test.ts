import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { OWNER_APP_CLIENT_ID } from '../../../scripts/m5-owner-lifecycle/private-operator.mjs';
import { createDurableCore } from '../src/index.js';
import { applyOwnerLifecycleDecision, type OwnerLifecycleDecision } from '../src/repositories/owner-lifecycle.js';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const domain = 'stitchs-vat-verification-20261004.myshopify.com';
test.skipIf(!process.env.M5_OWNER_LIFECYCLE_TEST_URL)(
  'explicit owner action is independent from generic metadata and fences old generation and exact privacy cutoff',
  async () => {
    const admin = new Pool({ connectionString: process.env.M5_OWNER_LIFECYCLE_TEST_URL });
    const ownerName = 'insignia_rewrite';
    const db = `m5owner_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(process.env.M5_OWNER_LIFECYCLE_TEST_URL ?? '');
    url.username = ownerName;
    url.pathname = `/${db}`;
    const files = await mkdtemp(join(tmpdir(), 'm5-owner-private-'));
    let allocated = false;
    let created = false;
    let pool: Pool | undefined;
    let core: ReturnType<typeof createDurableCore> | undefined;
    try {
      expect((await admin.query('select rolname from pg_roles where rolname=$1', [ownerName])).rowCount).toBe(0);
      // Isolated synthetic credential only; local helper never logs it.
      await admin.query("set log_statement='none';set log_min_error_statement='panic'");
      await admin.query(`create role ${ownerName} login superuser password '${url.password}'`);
      allocated = true;
      await admin.query(`create database ${db} owner ${ownerName}`);
      created = true;
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      await promisify(execFile)(
        `${root}node_modules/.bin/dbmate`,
        ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
        { env: { ...process.env, DATABASE_URL: url.href } },
      );
      pool = new Pool({ connectionString: url.href });
      core = createDurableCore(new Pool({ connectionString: url.href }), {
        credentialKeys: { currentKeyId: 'synthetic-k1', keys: { 'synthetic-k1': Buffer.alloc(32, 41) } },
      });
      const activeCore = core;
      const gap: OwnerLifecycleDecision = {
        version: 'm5-owner-lifecycle-v1',
        decisionId: randomUUID(),
        appClientId: OWNER_APP_CLIENT_ID,
        providerShopId: '123',
        shopId: null,
        shopDomain: domain,
        installationGeneration: null,
        externalInstallationId: null,
        operation: 'OWNER_DEACTIVATION',
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
          coordination: 'OWNER_HOLDS_NO_REINSTALL_WINDOW',
          noReinstallUntil: new Date(Date.now() + 120000).toISOString(),
        },
      };
      // Actual privileged private-operator dispatch. Synthetic private proof files
      // test reservation mechanics only; they are never native qualification.
      const nativeFile = join(files, 'native.json'),
        requestFile = join(files, 'request.json'),
        inventoryFile = join(files, 'inventory.json');
      for (const path of [nativeFile, requestFile, inventoryFile])
        await writeFile(
          path,
          JSON.stringify({ source: 'SYNTHETIC_TEST_ONLY', purpose: 'owner operation boundary control' }),
          { mode: 0o600 },
        );
      gap.native.evidenceSha256 = hash(await readFile(nativeFile));
      gap.native.preInstallationInventorySha256 = hash(await readFile(inventoryFile));
      gap.authority.requestEvidenceSha256 = hash(await readFile(requestFile));
      const operator = await import('../../../scripts/m5-owner-lifecycle/private-operator.mjs');
      const privatePlan = join(files, 'plan');
      expect(
        await operator.reserveOwnerLifecycle({
          directory: privatePlan,
          ownerConnectionString: url.href,
          expectedDatabase: db,
          decision: gap,
          nativeEvidenceFile: nativeFile,
          ownerRequestFile: requestFile,
          preInstallationInventoryFile: inventoryFile,
        }),
      ).toMatchObject({ status: 'FROZEN' });
      const planPath = join(privatePlan, 'plan.json'),
        originalPlan = await readFile(planPath);
      const drift = JSON.parse(originalPlan.toString());
      drift.sources[Object.keys(drift.sources)[0]] = '0'.repeat(64);
      await writeFile(planPath, JSON.stringify(drift));
      await expect(operator.executeOwnerLifecycle(privatePlan)).rejects.toThrow('frozen_source_changed');
      await writeFile(planPath, originalPlan);
      expect(await operator.executeOwnerLifecycle(privatePlan)).toMatchObject({
        status: 'ACKNOWLEDGED',
        outcome: 'OWNER_NO_DURABLE_INSTALLATION',
        providerWrites: 0,
        fullPrivacyOrUnattendedUninstallQualified: false,
      });
      await expect(operator.executeOwnerLifecycle(privatePlan)).rejects.toThrow('owner_attempt_already_reserved');
      // A lost local ACK does not authorize another dispatch. The append-only
      // transaction receipt is recovered read-only from the consumed decision.
      await unlink(join(privatePlan, 'result.json'));
      expect(await operator.readOwnerLifecycleSettlement(privatePlan)).toMatchObject({
        status: 'SETTLED_READ_ONLY',
        outcome: 'OWNER_NO_DURABLE_INSTALLATION',
        providerWrites: 0,
      });
      expect(await applyOwnerLifecycleDecision(pool, gap)).toEqual({ outcome: 'OWNER_NO_DURABLE_INSTALLATION' });
      const unauthorizedUrl = new URL(url.href);
      unauthorizedUrl.username = new URL(process.env.M5_OWNER_LIFECYCLE_TEST_URL ?? '').username;
      const unauthorizedPool = new Pool({ connectionString: unauthorizedUrl.href, max: 1 });
      try {
        await expect(
          applyOwnerLifecycleDecision(unauthorizedPool, { ...gap, decisionId: randomUUID() }),
        ).rejects.toThrow('owner_only_operation');
      } finally {
        await unauthorizedPool.end();
      }

      expect((await pool.query('select count(*) as n from shops')).rows[0].n).toBe('0');
      const gapBody = Buffer.from('{"shop_id":123,"customer":{"email":"private-gap@example.test"}}');
      const gapReceipt = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'customers/redact',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: gapBody,
      });
      const gapTime = (
        await pool.query(
          `select to_char(collected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [gapReceipt.id],
        )
      ).rows[0].t;
      const gapPrivacy: OwnerLifecycleDecision = {
        ...gap,
        decisionId: randomUUID(),
        operation: 'OWNER_RECEIPT_ERASURE',
        native: { ...gap.native, observedAt: new Date().toISOString() },
        privacy: {
          cutoff: gapTime,
          sinks: {
            database: 'QUALIFIED',
            queue: 'QUALIFIED',
            privateCopies: 'ERASED',
            backups: 'RESTORE_EXCLUSION_QUALIFIED',
          },
          receipts: [{ id: gapReceipt.id, bodySha256: hash(gapBody), collectedAt: gapTime }],
        },
      };
      expect(await applyOwnerLifecycleDecision(pool, gapPrivacy)).toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      const shop = randomUUID();
      await core.transactions.run((tx) =>
        activeCore.tenants.createShop(tx, {
          shopId: shop,
          shopDomain: domain,
          shopifyShopId: '123',
          externalInstallationId: 'gid://shopify/AppInstallation/456',
        }),
      );
      const raw = Buffer.from(
        '{"shop_id":123,"shop_domain":"stitchs-vat-verification-20261004.myshopify.com","customer":{"id":99,"email":"private@example.test"}}',
      );
      const receipt = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'customers/redact',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date('2099-01-01'),
        eventId: null,
        name: null,
        rawBody: raw,
      });
      const original = (
        await pool.query(
          `select to_char(collected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as collected_at from inbox_messages where id=$1`,
          [receipt.id],
        )
      ).rows[0];
      const decision: OwnerLifecycleDecision = {
        version: 'm5-owner-lifecycle-v1',
        decisionId: randomUUID(),
        appClientId: OWNER_APP_CLIENT_ID,
        providerShopId: '123',
        shopId: shop,
        shopDomain: domain,
        installationGeneration: '1',
        externalInstallationId: 'gid://shopify/AppInstallation/456',
        operation: 'OWNER_RECEIPT_ERASURE',
        authority: { kind: 'EXPLICIT_OWNER_REQUEST', requestEvidenceSha256: 'a'.repeat(64) },
        native: {
          kind: 'OWNER_NATIVE_ATTESTATION',
          evidenceSha256: 'b'.repeat(64),
          preInstallationInventorySha256: 'c'.repeat(64),
          destinationEffectsQualification: 'PASS_BOUND_ALLOCATED_STORE',
          exactAppShopBound: true,
          currentStatus: 'PRESENT',
          currentExternalInstallationId: 'gid://shopify/AppInstallation/456',
          observedAt: new Date().toISOString(),
        },
        privacy: {
          cutoff: original.collected_at,
          sinks: {
            database: 'QUALIFIED',
            queue: 'QUALIFIED',
            privateCopies: 'ERASED',
            backups: 'RESTORE_EXCLUSION_QUALIFIED',
          },
          receipts: [{ id: receipt.id, bodySha256: hash(raw), collectedAt: original.collected_at }],
        },
      };
      assert.ok(decision.privacy);
      const receiptPrivacy = decision.privacy;
      const result = await applyOwnerLifecycleDecision(pool, decision);
      expect(result).toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED', erasedIds: [receipt.id] });
      expect(
        (await pool.query('select payload,erasure_state,state from inbox_messages where id=$1', [receipt.id])).rows[0],
      ).toMatchObject({ payload: Buffer.alloc(0), erasure_state: 'erased', state: 'pending' });
      expect(await applyOwnerLifecycleDecision(pool, decision)).toEqual(result);

      const clone = (d: OwnerLifecycleDecision) => ({ ...structuredClone(d), decisionId: randomUUID() });
      const absent = {
        ...decision.native,
        currentStatus: 'ABSENT' as const,
        currentExternalInstallationId: null,
        coordination: 'OWNER_HOLDS_NO_REINSTALL_WINDOW' as const,
        noReinstallUntil: new Date(Date.now() + 120000).toISOString(),
      };
      const deactivation: OwnerLifecycleDecision = {
        ...clone(decision),
        operation: 'OWNER_DEACTIVATION',
        native: absent,
      };
      delete deactivation.privacy;
      await core.credentials.install({
        shopId: shop,
        installationGeneration: '1',
        pair: {
          accessToken: 'synthetic-g1-access',
          refreshToken: 'synthetic-g1-refresh',
          accessExpiresAt: new Date(Date.now() + 60000),
          refreshExpiresAt: new Date(Date.now() + 86400000),
          scopes: 'read_products',
        },
      });
      const generic = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'app/uninstalled',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date('2099-01-01'),
        eventId: randomUUID(),
        name: null,
        rawBody: Buffer.from('{"id":123,"myshopify_domain":null}'),
      });
      expect(await core.webhooks.processUninstall(generic.id)).toBe('unqualified');
      expect((await core.tenants.getCurrentAdminInstallation(shop))?.active).toBe(true);
      await expect(
        applyOwnerLifecycleDecision(pool, { ...clone(deactivation), native: decision.native }),
      ).rejects.toThrow('independent_native_absence_required');
      await expect(
        applyOwnerLifecycleDecision(pool, {
          ...clone(deactivation),
          native: { ...absent, noReinstallUntil: new Date(Date.now() - 1).toISOString() },
        }),
      ).rejects.toThrow('bounded_owner_coordination_required');
      await expect(
        applyOwnerLifecycleDecision(pool, {
          ...clone(decision),
          privacy: { ...receiptPrivacy, sinks: { ...receiptPrivacy.sinks, backups: 'UNKNOWN' as never } },
        }),
      ).rejects.toThrow('all_sink_and_restore_exclusions_required');
      const departed = await Promise.all([
        applyOwnerLifecycleDecision(pool, deactivation),
        applyOwnerLifecycleDecision(pool, deactivation),
      ]);
      expect(departed).toEqual([{ outcome: 'OWNER_DEACTIVATED' }, { outcome: 'OWNER_DEACTIVATED' }]);
      expect((await core.credentials.metadata({ shopId: shop, installationGeneration: '1' }))?.state).toBe('revoked');
      expect(
        (
          await pool.query(
            'select access_envelope,refresh_envelope from shop_credentials where shop_id=$1 and installation_generation=1',
            [shop],
          )
        ).rows[0],
      ).toEqual({ access_envelope: null, refresh_envelope: null });
      for (const query of [
        'update owner_lifecycle_decisions set authority=authority',
        'delete from owner_lifecycle_decisions',
        'truncate owner_lifecycle_decisions',
      ])
        await expect(pool.query(query)).rejects.toMatchObject({ code: '23514' });
      const oldPrivacy = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'customers/redact',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: raw,
      });
      const oldTime = (
        await pool.query(
          `select to_char(collected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [oldPrivacy.id],
        )
      ).rows[0].t;
      await core.transactions.run((tx) =>
        activeCore.tenants.startInstallation(tx, shop, 'gid://shopify/AppInstallation/789'),
      );
      await core.credentials.install({
        shopId: shop,
        installationGeneration: '2',
        pair: {
          accessToken: 'synthetic-g2-access',
          refreshToken: 'synthetic-g2-refresh',
          accessExpiresAt: new Date(Date.now() + 60000),
          refreshExpiresAt: new Date(Date.now() + 86400000),
          scopes: 'read_products',
        },
      });
      const replay = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'app/uninstalled',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date('2099-01-02'),
        eventId: randomUUID(),
        name: null,
        rawBody: Buffer.from('{"id":123,"myshopify_domain":null}'),
      });
      expect(await core.webhooks.processUninstall(replay.id)).toBe('unqualified');
      await expect(applyOwnerLifecycleDecision(pool, clone(deactivation))).rejects.toThrow('newer_generation_present');
      expect(await core.tenants.getCurrentAdminInstallation(shop)).toEqual({
        generation: '2',
        externalInstallationId: 'gid://shopify/AppInstallation/789',
        active: true,
      });
      expect((await core.credentials.metadata({ shopId: shop, installationGeneration: '2' }))?.state).toBe('active');
      const historical = {
        ...clone(decision),
        native: {
          ...decision.native,
          currentExternalInstallationId: 'gid://shopify/AppInstallation/789',
          observedAt: new Date().toISOString(),
        },
        privacy: {
          ...receiptPrivacy,
          cutoff: oldTime,
          receipts: [{ id: oldPrivacy.id, bodySha256: hash(raw), collectedAt: oldTime }],
        },
      };
      expect(await applyOwnerLifecycleDecision(pool, historical)).toMatchObject({
        outcome: 'OWNER_RECEIPTS_ERASED',
        erasedIds: [oldPrivacy.id],
      });
      const newerReceipt = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'customers/redact',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: raw,
      });
      const newerTime = (
        await pool.query(
          `select to_char(collected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [newerReceipt.id],
        )
      ).rows[0].t;
      await expect(
        applyOwnerLifecycleDecision(pool, {
          ...clone(historical),
          native: { ...historical.native, observedAt: new Date().toISOString() },
          privacy: {
            ...historical.privacy,
            cutoff: newerTime,
            receipts: [{ id: newerReceipt.id, bodySha256: hash(raw), collectedAt: newerTime }],
          },
        }),
      ).rejects.toThrow('old_scope_reaches_newer_generation');
      expect(
        (await pool.query('select payload from inbox_messages where id=$1', [newerReceipt.id])).rows[0].payload.equals(
          raw,
        ),
      ).toBe(true);
      await expect(
        promisify(execFile)(
          `${root}node_modules/.bin/dbmate`,
          ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'rollback'],
          { env: { ...process.env, DATABASE_URL: url.href } },
        ),
      ).rejects.toBeDefined();
      expect((await pool.query('select count(*) as n from owner_lifecycle_decisions')).rows[0].n).toBe('5');
    } finally {
      await core?.close();
      await pool?.end();
      if (created) await admin.query(`drop database ${db}`);
      if (allocated) await admin.query(`drop role ${ownerName}`);
      await admin.end();
      await rm(files, { recursive: true, force: true });
    }
  },
  30000,
);

test.skipIf(!process.env.M5_OWNER_LIFECYCLE_TEST_URL)(
  'owner erasure compares inventory, newer generation and receipt boundaries at exact PostgreSQL microseconds',
  async () => {
    const admin = new Pool({ connectionString: process.env.M5_OWNER_LIFECYCLE_TEST_URL });
    const db = `m5owner_precision_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(process.env.M5_OWNER_LIFECYCLE_TEST_URL ?? '');
    url.username = 'insignia_rewrite';
    url.pathname = `/${db}`;
    const proofDirectory = await mkdtemp(join(tmpdir(), 'm5-owner-precision-'));
    let roleCreated = false;
    let dbCreated = false;
    let pool: Pool | undefined;
    let core: ReturnType<typeof createDurableCore> | undefined;
    try {
      expect((await admin.query("select rolname from pg_roles where rolname='insignia_rewrite'")).rowCount).toBe(0);
      await admin.query("set log_statement='none';set log_min_error_statement='panic'");
      await admin.query(`create role insignia_rewrite login superuser password '${url.password}'`);
      roleCreated = true;
      await admin.query(`create database ${db} owner insignia_rewrite`);
      dbCreated = true;
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      await promisify(execFile)(
        `${root}node_modules/.bin/dbmate`,
        ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
        { env: { ...process.env, DATABASE_URL: url.href } },
      );
      pool = new Pool({ connectionString: url.href });
      core = createDurableCore(new Pool({ connectionString: url.href }), {
        credentialKeys: { currentKeyId: 'synthetic-k1', keys: { 'synthetic-k1': Buffer.alloc(32, 41) } },
      });
      const activeCore = core;
      const shop = randomUUID();
      await core.transactions.run((tx) =>
        activeCore.tenants.createShop(tx, {
          shopId: shop,
          shopDomain: domain,
          shopifyShopId: '123',
          externalInstallationId: 'gid://shopify/AppInstallation/456',
        }),
      );
      const activePool = pool;
      const raw = Buffer.from('{"shop_id":123,"customer":{"email":"private@example.test"}}');
      const collectionTimes = new Map<string, string>();
      const receiveAt = async (rawBody: Buffer, topic = 'customers/redact', expired = false) => {
        const receipt = await activeCore.webhooks.receive({
          shopDomain: domain,
          topic,
          deliveryId: randomUUID(),
          apiVersion: '2026-07',
          triggeredAt: new Date(),
          eventId: null,
          name: null,
          rawBody,
        });
        const original = (
          await activePool.query(
            `select to_char(collected_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
            [receipt.id],
          )
        ).rows[0].t;
        collectionTimes.set(receipt.id, original);
        if (expired)
          await activePool.query('update inbox_messages set purge_after=clock_timestamp() where id=$1', [receipt.id]);
        return receipt;
      };
      const receipts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const receipt = await receiveAt(raw);
        receipts.push(receipt.id);
      }
      const expiredRaw = Buffer.from('{"id":123,"myshopify_domain":null}');
      const expired = await receiveAt(expiredRaw, 'app/uninstalled', true);
      const raceRaw = Buffer.from('{"id":123,"myshopify_domain":null}');
      const race = await receiveAt(raceRaw, 'app/uninstalled');
      // All real collection instants precede the chosen boundary second; wait
      // until its .124000 observation is in the past rather than alter receipts.
      const boundaryMs = Math.ceil(Date.now() / 1000) * 1000;
      await new Promise((resolve) => setTimeout(resolve, boundaryMs + 200 - Date.now()));
      const second = new Date(boundaryMs).toISOString().slice(0, 19);
      const time = (fraction: string) => `${second}.${fraction}Z`;
      const receiptId = (index: number) => {
        const id = receipts[index];
        assert.ok(id);
        return id;
      };
      const collectedAt = (id: string) => {
        const value = collectionTimes.get(id);
        assert.ok(value);
        return value;
      };
      const firstReceipt = (request: OwnerLifecycleDecision) => {
        assert.ok(request.privacy);
        const receipt = request.privacy.receipts[0];
        assert.ok(receipt);
        return receipt;
      };
      const decision = (id: string, cutoff: string, observedAt: string, current = '456'): OwnerLifecycleDecision => ({
        version: 'm5-owner-lifecycle-v1',
        decisionId: randomUUID(),
        appClientId: OWNER_APP_CLIENT_ID,
        providerShopId: '123',
        shopId: shop,
        shopDomain: domain,
        installationGeneration: '1',
        externalInstallationId: 'gid://shopify/AppInstallation/456',
        operation: 'OWNER_RECEIPT_ERASURE',
        authority: { kind: 'EXPLICIT_OWNER_REQUEST', requestEvidenceSha256: 'a'.repeat(64) },
        native: {
          kind: 'OWNER_NATIVE_ATTESTATION',
          evidenceSha256: 'b'.repeat(64),
          preInstallationInventorySha256: 'c'.repeat(64),
          destinationEffectsQualification: 'PASS_BOUND_ALLOCATED_STORE',
          exactAppShopBound: true,
          currentStatus: 'PRESENT',
          currentExternalInstallationId: `gid://shopify/AppInstallation/${current}`,
          observedAt,
        },
        privacy: {
          cutoff,
          sinks: {
            database: 'QUALIFIED',
            queue: 'QUALIFIED',
            privateCopies: 'ERASED',
            backups: 'RESTORE_EXCLUSION_QUALIFIED',
          },
          receipts: [{ id, bodySha256: hash(raw), collectedAt: collectedAt(id) }],
        },
      });
      // Cutoff before and equal to inventory is valid; even one microsecond after it is not.
      for (const [index, cutoff, observed, error] of [
        [0, '123000', '123100', null],
        [1, '123000', '123000', null],
        [2, '123999', '123000', 'collection_cutoff_after_inventory'],
      ] as const) {
        const operation = applyOwnerLifecycleDecision(pool, decision(receiptId(index), time(cutoff), time(observed)));
        if (error) await expect.soft(operation).rejects.toThrow(error);
        else await expect.soft(operation).resolves.toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      }
      // Original exact collection time is also bounded; changing its microsecond must not match.
      const mismatch = decision(receiptId(3), time('123100'), time('123900'));
      assert.ok(mismatch.privacy);
      firstReceipt(mismatch).collectedAt = (
        await pool.query(
          `select to_char((collected_at+interval '1 microsecond') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [receipts[3]],
        )
      ).rows[0].t;
      await expect
        .soft(applyOwnerLifecycleDecision(pool, mismatch))
        .rejects.toThrow('receipt_collection_changed_or_after_cutoff');
      const beforeTime = (
        await pool.query(
          `select to_char((collected_at-interval '1 microsecond') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [receipts[4]],
        )
      ).rows[0].t;
      const beforeCollection = decision(receiptId(4), beforeTime, time('123900'));
      await expect.soft(applyOwnerLifecycleDecision(pool, beforeCollection)).rejects.toThrow('receipt_after_cutoff');
      await expect
        .soft(applyOwnerLifecycleDecision(pool, decision(receiptId(8), collectedAt(receiptId(8)), time('123900'))))
        .resolves.toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      const afterTime = (
        await pool.query(
          `select to_char((collected_at+interval '1 microsecond') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from inbox_messages where id=$1`,
          [receipts[9]],
        )
      ).rows[0].t;
      await expect
        .soft(applyOwnerLifecycleDecision(pool, decision(receiptId(9), afterTime, time('123900'))))
        .resolves.toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      // Expiration deliberately loses the original Shop-shape discriminator. Only a
      // separately owner-qualified original-body binding may fill that missing evidence.
      await core.webhooks.eraseExpiredPayloads(100);
      expect(
        (await pool.query('select captured_fields from webhook_obligation_facts where inbox_id=$1', [expired.id]))
          .rows[0].captured_fields,
      ).toEqual({ id: '123' });
      const scopedExpired = decision(expired.id, time('123100'), time('123900'));
      assert.ok(scopedExpired.privacy);
      firstReceipt(scopedExpired).bodySha256 = hash(expiredRaw);
      await expect.soft(applyOwnerLifecycleDecision(pool, scopedExpired)).rejects.toThrow('body_shop_binding_required');
      const withBinding = (providerShopId: string, bodySha256: string) => {
        const request = structuredClone(scopedExpired);
        request.decisionId = randomUUID();
        assert.ok(request.privacy);
        firstReceipt(request).originalBodyShopBinding = {
          providerShopId,
          bodySha256,
          evidenceSha256: 'd'.repeat(64),
        };
        return request;
      };
      await expect
        .soft(applyOwnerLifecycleDecision(pool, withBinding('124', hash(expiredRaw))))
        .rejects.toThrow('original_body_shop_binding_required');
      await expect
        .soft(applyOwnerLifecycleDecision(pool, withBinding('123', '0'.repeat(64))))
        .rejects.toThrow('original_body_shop_binding_required');
      const qualifiedExpired = withBinding('123', hash(expiredRaw));
      assert.ok(qualifiedExpired.privacy);
      const bodyEvidenceFile = join(proofDirectory, 'original-body-binding.json');
      const evidence = Buffer.from(
        JSON.stringify({
          source: 'SYNTHETIC_TEST_ONLY',
          receiptId: expired.id,
          bodySha256: hash(expiredRaw),
          providerShopId: '123',
          purpose: 'original-body owner-binding mechanics',
        }),
      );
      await writeFile(bodyEvidenceFile, evidence, { mode: 0o600 });
      const originalBinding = firstReceipt(qualifiedExpired).originalBodyShopBinding;
      assert.ok(originalBinding);
      originalBinding.evidenceSha256 = hash(evidence);
      await expect.soft(applyOwnerLifecycleDecision(pool, qualifiedExpired)).resolves.toMatchObject({
        outcome: 'OWNER_RECEIPTS_ERASED',
        receiptDispositionOnly: true,
      });
      const nativeEvidenceFile = join(proofDirectory, 'native.json');
      const ownerRequestFile = join(proofDirectory, 'owner.json');
      const preInstallationInventoryFile = join(proofDirectory, 'inventory.json');
      for (const file of [nativeEvidenceFile, ownerRequestFile, preInstallationInventoryFile])
        await writeFile(file, '{"source":"SYNTHETIC_TEST_ONLY"}', { mode: 0o600 });
      qualifiedExpired.native.evidenceSha256 = hash(await readFile(nativeEvidenceFile));
      qualifiedExpired.native.preInstallationInventorySha256 = hash(await readFile(preInstallationInventoryFile));
      qualifiedExpired.authority.requestEvidenceSha256 = hash(await readFile(ownerRequestFile));
      // A distinct explicit decision tests dispatch; local synthetic files are
      // not native authority qualification or permission to perform erasure.
      qualifiedExpired.decisionId = randomUUID();
      const operator = await import('../../../scripts/m5-owner-lifecycle/private-operator.mjs');
      const directory = join(proofDirectory, 'reserved');
      const reservation = {
        directory,
        ownerConnectionString: url.href,
        expectedDatabase: db,
        decision: qualifiedExpired,
        nativeEvidenceFile,
        ownerRequestFile,
        preInstallationInventoryFile,
      };
      await expect(operator.reserveOwnerLifecycle(reservation)).rejects.toThrow(
        'original_body_evidence_files_required',
      );
      await expect(
        operator.reserveOwnerLifecycle({
          ...reservation,
          originalBodyEvidenceFiles: { [expired.id]: nativeEvidenceFile },
        }),
      ).rejects.toThrow('original_body_evidence_changed');
      expect(
        await operator.reserveOwnerLifecycle({
          ...reservation,
          originalBodyEvidenceFiles: { [expired.id]: bodyEvidenceFile },
        }),
      ).toMatchObject({ status: 'FROZEN' });
      await writeFile(bodyEvidenceFile, '{"source":"CHANGED_SYNTHETIC_TEST_ONLY"}');
      await expect(operator.executeOwnerLifecycle(directory)).rejects.toThrow('original_body_evidence_changed');
      await expect(readFile(join(directory, 'attempt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(bodyEvidenceFile, evidence);
      expect(await operator.executeOwnerLifecycle(directory)).toMatchObject({
        status: 'ACKNOWLEDGED',
        outcome: 'OWNER_RECEIPTS_ERASED',
        fullPrivacyOrUnattendedUninstallQualified: false,
      });
      expect
        .soft(
          (
            await pool.query('select captured_fields,purpose from webhook_obligation_facts where inbox_id=$1', [
              expired.id,
            ])
          ).rows[0],
        )
        .toEqual({ captured_fields: {}, purpose: 'UNQUALIFIED' });

      // Real worker SQL is paused after obtaining its inbox lock. Owner must wait
      // for that inbox without first locking the shop the worker needs next.
      const raceDecision = decision(race.id, time('123100'), time('123900'));
      assert.ok(raceDecision.privacy);
      firstReceipt(raceDecision).bodySha256 = hash(raceRaw);
      const workerPool = new Pool({
        connectionString: url.href,
        application_name: 'owner-lock-worker',
        options: '-c lock_timeout=1500ms',
      });
      const ownerPool = new Pool({ connectionString: url.href, application_name: 'owner-lock-erasure' });
      let releaseWorker!: () => void;
      let workerLocked!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseWorker = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        workerLocked = resolve;
      });
      const connect = workerPool.connect.bind(workerPool);
      let intercepted = false;
      workerPool.connect = (async () => {
        const client = await connect();
        const query = client.query.bind(client);
        client.query = (async (...args: Parameters<typeof query>) => {
          const result = await query(...args);
          const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
          if (!intercepted && text?.includes('from "inbox_messages"') && text.includes('for update')) {
            intercepted = true;
            workerLocked();
            await released;
          }
          return result;
        }) as typeof client.query;
        return client;
      }) as typeof workerPool.connect;
      const workerCore = createDurableCore(workerPool, {
        credentialKeys: { currentKeyId: 'synthetic-k1', keys: { 'synthetic-k1': Buffer.alloc(32, 41) } },
      });
      let workerResult: Promise<unknown> | undefined;
      let ownerResult: Promise<unknown> | undefined;
      try {
        workerResult = workerCore.webhooks.processUninstall(race.id);
        workerResult.catch(() => {});
        await Promise.race([
          locked,
          new Promise((_, reject) => setTimeout(() => reject(new Error('worker_barrier_timeout')), 3000)),
        ]);
        ownerResult = applyOwnerLifecycleDecision(ownerPool, raceDecision);
        ownerResult.catch(() => {});
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          waiting = (
            await pool.query(
              "select exists(select 1 from pg_stat_activity where application_name='owner-lock-erasure' and wait_event_type='Lock') as waiting",
            )
          ).rows[0].waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        releaseWorker();
        await expect.soft(workerResult).resolves.toBe('unqualified');
        await expect.soft(ownerResult).resolves.toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      } finally {
        releaseWorker();
        await Promise.allSettled([workerResult, ownerResult]);
        await workerCore.close();
        await ownerPool.end();
      }
      await core.transactions.run((tx) =>
        activeCore.tenants.startInstallation(tx, shop, 'gid://shopify/AppInstallation/789'),
      );
      await pool.query(
        'update installation_generations set activated_at=$2::timestamptz where shop_id=$1 and generation=2',
        [shop, time('123900')],
      );
      for (const [index, cutoff, error] of [
        [5, '123100', null],
        [6, '123900', 'old_scope_reaches_newer_generation'],
        [7, '123901', 'old_scope_reaches_newer_generation'],
      ] as const) {
        const operation = applyOwnerLifecycleDecision(
          pool,
          decision(receiptId(index), time(cutoff), time('124000'), '789'),
        );
        if (error) await expect.soft(operation).rejects.toThrow(error);
        else await expect.soft(operation).resolves.toMatchObject({ outcome: 'OWNER_RECEIPTS_ERASED' });
      }
      // Every rejected operation leaves both its private bytes and immutable ledger untouched.
      for (const index of [2, 3, 4, 6, 7]) {
        expect
          .soft((await pool.query('select payload from inbox_messages where id=$1', [receipts[index]])).rows[0].payload)
          .toEqual(raw);
      }
      expect.soft((await pool.query('select count(*) as n from owner_lifecycle_decisions')).rows[0].n).toBe('8');
    } finally {
      await core?.close();
      await pool?.end();
      if (dbCreated) await admin.query(`drop database ${db}`);
      if (roleCreated) await admin.query('drop role insignia_rewrite');
      await admin.end();
      await rm(proofDirectory, { recursive: true, force: true });
    }
  },
  30000,
);
