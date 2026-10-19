import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import {
  exportErasureExclusions,
  importErasureExclusions,
  readExclusions,
  writeExclusions,
} from '../../../scripts/privacy/restore-exclusions.mts';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

function required<T>(value: T | undefined): T {
  assert(value !== undefined, 'Expected retained fixture record');
  return value;
}

// Explicit disposable-cluster grant: never inherit a native/default database target.
it.runIf(Boolean(process.env.PRIVACY_RESTORE_TEST_URL))(
  'pre-erasure pg_dump restored into an isolated database stays excluded before readiness and across late purchase discovery',
  async () => {
    const address = process.env.PRIVACY_RESTORE_TEST_URL!;
    if (
      address !== process.env.DATABASE_URL ||
      !new URL(address).searchParams.get('host')?.startsWith('/tmp/insignia-restore-pg-')
    )
      throw new Error('Fresh private restore cluster required');
    const tools = process.env.PRIVACY_PG_TOOLS!;
    if (!tools) throw new Error('Existing PostgreSQL18 tools required');
    const db = await openTestDatabase();
    const source = new Pool({ connectionString: address });
    const restoredName = `privacy_restore_${randomUUID().replaceAll('-', '')}`;
    const targetAddress = new URL(address);
    targetAddress.pathname = `/${restoredName}`;
    const temporary = await mkdtemp(join(tmpdir(), 'insignia-erasure-restore-test-'));
    let target: Pool | undefined;
    const f = await purchaseFixture(db),
      late = await purchaseFixture(db),
      blocked = await purchaseFixture(db),
      staged = await purchaseFixture(db);
    async function assetOffer(f: Awaited<ReturnType<typeof purchaseFixture>>) {
      const assetId = randomUUID(),
        sessionId = randomUUID(),
        draftId = randomUUID();
      const design = { design: { placements: [{ artwork: { kind: 'revision', revisionId: assetId } }] } };
      const request = { groups: [{ group: design }] };
      await sql`INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES(${assetId}::uuid,${f.shopId},1,${'a'.repeat(64)},'guest','image/svg+xml',10,'UPLOADING',${assetId + '/q'},${assetId + '/o'},${assetId + '/p'},statement_timestamp(),statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '7 days')`.execute(
        db,
      );
      await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window) VALUES(${sessionId}::uuid,${f.shopId},1,${'b'.repeat(64)},statement_timestamp(),statement_timestamp()+interval '7 days',statement_timestamp())`.execute(
        db,
      );
      await sql`INSERT INTO design_drafts VALUES(${draftId}::uuid,${f.shopId},1,${sessionId}::uuid,1,${JSON.stringify(design)}::jsonb,statement_timestamp()+interval '6 days')`.execute(
        db,
      );
      await sql`INSERT INTO purchase_offer_payloads VALUES(${f.shopId},1,${f.quote.quoteId}::uuid,statement_timestamp(),statement_timestamp()+interval '7 days',${JSON.stringify(request)}::jsonb,NULL)`.execute(
        db,
      );
      return { assetId, draftId, request };
    }
    const existing = await assetOffer(f),
      later = await assetOffer(late),
      purchaseId = randomUUID(),
      blockedAsset = await assetOffer(blocked),
      stagedAsset = await assetOffer(staged);
    await source.query(
      'UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1 AND generation=1',
      [staged.shopId],
    );
    await source.query(
      "INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES($1,$2,1,'gid://shopify/Order/101',clock_timestamp(),'USD',2001)",
      [purchaseId, f.shopId],
    );
    await source.query('INSERT INTO purchase_bindings VALUES($1,1,$2,$3,$4,$5)', [
      f.shopId,
      purchaseId,
      f.quote.quoteId,
      f.authorization.setId,
      { immutable: 'economics' },
    ]);
    await source.query(
      "INSERT INTO purchase_design_payloads VALUES($1,1,$2,$3,statement_timestamp(),statement_timestamp()+interval '7 days',$4,NULL)",
      [f.shopId, purchaseId, f.authorization.setId, { request: existing.request }],
    );
    for (const fixture of [blocked, staged]) {
      await source.query('INSERT INTO method_catalog(shop_id,method_id,name) VALUES($1,$2,$3)', [
        fixture.shopId,
        randomUUID(),
        'Private method template',
      ]);
      await source.query(
        "INSERT INTO idempotency_records(shop_id,namespace,idempotency_key,request_digest,status,result_ref,completed_at) VALUES($1,'merchant-method-create:1:old','restore-method-key',$2,'completed',$3,clock_timestamp())",
        [
          fixture.shopId,
          'e'.repeat(64),
          JSON.stringify({ kind: 'created', method: { name: 'Private method template' } }),
        ],
      );
    }
    const economics = async (pool: Pool) =>
      (
        await pool.query(
          "SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(b) ORDER BY b.purchase_id)::text,'UTF8')),'hex') AS digest FROM purchase_bindings b",
        )
      ).rows[0].digest;
    const deadlines = async (pool: Pool) =>
      (
        await pool.query(
          'SELECT asset_id::text,expires_at::text,upload_until::text,collected_at::text FROM artwork_assets ORDER BY asset_id',
        )
      ).rows;
    try {
      const economicBefore = await economics(source),
        deadlinesBefore = await deadlines(source);
      // Related order transport can be erased without its own privacy receipt.
      const orderReceipt = await createShopifyWebhookRepository(db).receive({
        shopDomain: 'untrusted-routing.myshopify.com',
        topic: 'orders/create',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(
          '{"id":101,"admin_graphql_api_id":"gid://shopify/Order/101","updated_at":"2026-10-17T00:00:00Z"}',
        ),
      });
      // Only independently settled economic transport is eligible for early
      // privacy cleanup. Pending notifications keep their reconciliation job.
      await source.query("UPDATE inbox_messages SET state='processed' WHERE id=$1", [orderReceipt.id]);
      const backup = join(temporary, 'before-erasure.dump');
      execFileSync(join(tools, 'pg_dump'), ['--format=custom', '--file', backup, '--dbname', address], {
        env: process.env,
        stdio: 'pipe',
      });
      for (const [fixture, order] of [
        [f, '101'],
        [late, '202'],
      ] as const) {
        const receipt = await createShopifyWebhookRepository(db).receive({
          shopDomain: 'untrusted-routing.myshopify.com',
          topic: 'customers/redact',
          apiVersion: '2026-07',
          deliveryId: randomUUID(),
          triggeredAt: new Date(),
          eventId: null,
          name: null,
          rawBody: Buffer.from(
            `{"shop_id":${fixture.shopifyShopId},"customer":{"id":1,"email":"do-not-export@example.invalid"},"orders_to_redact":[${order}]}`,
          ),
        });
        await createCustomerPrivacyRepository(db).processInbox(receipt.id);
      }
      const request = await createShopifyWebhookRepository(db).receive({
        shopDomain: 'untrusted-routing.myshopify.com',
        topic: 'customers/data_request',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(
          `{"shop_id":${f.shopifyShopId},"customer":{"id":1,"email":"pending-private@example.invalid"},"data_request":{"id":99},"orders_requested":[101]}`,
        ),
      });
      await createCustomerPrivacyRepository(db).processInbox(request.id);
      for (const fixture of [blocked, staged]) {
        const receipt = await createShopifyWebhookRepository(db).receive({
          shopDomain: 'untrusted-routing.myshopify.com',
          topic: 'shop/redact',
          apiVersion: '2026-07',
          deliveryId: randomUUID(),
          triggeredAt: new Date(),
          eventId: null,
          name: null,
          rawBody: Buffer.from(`{"shop_id":${fixture.shopifyShopId},"shop_domain":"${fixture.shopId}.test.example"}`),
        });
        await createCustomerPrivacyRepository(db).processInbox(receipt.id);
      }
      await source.query('SELECT public.cleanup_customer_privacy_inboxes(100)');
      const exclusions = await exportErasureExclusions(source);
      expect(exclusions.data.receipts.map((r: { operation: string }) => r.operation).sort()).toEqual([
        'DATA_REQUEST_PENDING_EXPORT',
        'ERASURE_STAGED',
        'ERASURE_STAGED',
        'SHOP_ERASURE_BLOCKED',
        'SHOP_ERASURE_STAGED',
      ]);
      expect(exclusions.data.inboxes.some((r: { id: string }) => r.id === orderReceipt.id)).toBe(true);
      expect(JSON.stringify(exclusions)).not.toContain('pending-private@example.invalid');
      expect(JSON.stringify(exclusions)).not.toContain('do-not-export@example.invalid');
      expect(JSON.stringify(exclusions)).not.toContain(existing.assetId + '/o');
      const exclusionPath = join(temporary, 'exclusions.json');
      await writeExclusions(exclusionPath, exclusions);
      expect((await stat(exclusionPath)).mode & 0o777).toBe(0o600);
      expect(await readExclusions(exclusionPath)).toEqual(exclusions);
      await expect(writeExclusions(exclusionPath, exclusions)).rejects.toMatchObject({ code: 'EEXIST' });
      await chmod(exclusionPath, 0o644);
      await expect(readExclusions(exclusionPath)).rejects.toThrow('private owner exclusion file required');
      await chmod(exclusionPath, 0o600);
      const reseal = (copy: typeof exclusions) => {
        copy.sha256 = createHash('sha256')
          .update(
            JSON.stringify(copy.data, (_key, value) =>
              value && typeof value === 'object' && !Array.isArray(value)
                ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
                : value,
            ),
          )
          .digest('hex');
        return copy;
      };

      await source.query(`CREATE DATABASE ${restoredName}`);
      execFileSync(
        join(tools, 'pg_restore'),
        ['--no-owner', '--exit-on-error', '--dbname', targetAddress.href, backup],
        { env: process.env, stdio: 'pipe' },
      );
      target = new Pool({ connectionString: targetAddress.href });
      expect(
        (
          await target.query(
            'SELECT payload IS NOT NULL AS retained FROM purchase_design_payloads WHERE purchase_id=$1',
            [purchaseId],
          )
        ).rows[0].retained,
      ).toBe(true);
      const guardState = async () =>
        (
          await target!.query(
            "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.inbox_messages'::regclass AND tgname='inbox_collection_guard'",
          )
        ).rows[0].tgenabled;
      const invalidSchema = structuredClone(exclusions);
      invalidSchema.data.schemaIdentity = '0'.repeat(64);
      await expect(importErasureExclusions(target, reseal(invalidSchema))).rejects.toThrow('schema mismatch');
      const missing = JSON.parse(JSON.stringify(exclusions).replaceAll(f.shopId, randomUUID()));
      await expect(importErasureExclusions(target, reseal(missing))).rejects.toThrow('missing tenant');
      const drift = structuredClone(exclusions);
      drift.data.generations = drift.data.generations.map((row) =>
        row.shop_id === f.shopId ? { ...row, authorization_generation: randomUUID() } : row,
      );
      await expect(importErasureExclusions(target, reseal(drift))).rejects.toThrow('installation identity drift');
      const corrupt = structuredClone(exclusions);
      const receiptId = required(corrupt.data.receipts.find((row) => row.shop_id === f.shopId)).inbox_id;
      corrupt.data.inboxes = corrupt.data.inboxes.map((row) => (row.id === receiptId ? { ...row, attempts: -1 } : row));
      await expect(importErasureExclusions(target, reseal(corrupt))).rejects.toMatchObject({ code: '23514' });
      expect(await guardState()).toBe('O');
      expect(
        (await target.query('SELECT 1 FROM customer_privacy_receipts WHERE shop_id=$1', [f.shopId])).rowCount,
      ).toBe(0);
      const otherSession = new Pool({ connectionString: targetAddress.href });
      try {
        await otherSession.query('SELECT 1');
        await expect(importErasureExclusions(target, exclusions)).rejects.toThrow('target is not offline');
      } finally {
        await otherSession.end();
      }
      const login = `privacy_restore_login_${randomUUID().replaceAll('-', '')}`;
      const workerAddress = new URL(address);
      workerAddress.username = login;
      await source.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      const worker = new Pool({ connectionString: workerAddress.href });
      try {
        expect((await worker.query('SELECT current_user,session_user')).rows[0]).toEqual({
          current_user: login,
          session_user: login,
        });
        await expect(exportErasureExclusions(worker)).rejects.toThrow('schema owner required');
        await expect(importErasureExclusions(worker, exclusions)).rejects.toThrow('schema owner required');
      } finally {
        await worker.end();
        await source.query(`DROP ROLE ${login}`);
      }
      const promoted = structuredClone(exclusions);
      const blockedReceipt = required(promoted.data.receipts.find((r) => r.operation === 'SHOP_ERASURE_BLOCKED'));
      promoted.data.shopFences.push({
        shop_id: blocked.shopId,
        installation_generation: '1',
        source_inbox_id: blockedReceipt.inbox_id,
        created_at: blockedReceipt.staged_at,
      });
      await expect(importErasureExclusions(target, reseal(promoted))).rejects.toThrow('foreign erasure fence');
      const result = await importErasureExclusions(target, exclusions);
      expect((await target.query('SELECT name FROM method_catalog WHERE shop_id=$1', [staged.shopId])).rows).toEqual(
        [],
      );
      expect(
        JSON.stringify(
          (await target.query('SELECT result_ref FROM idempotency_records WHERE shop_id=$1', [staged.shopId])).rows,
        ),
      ).not.toContain('Private method template');
      expect((await target.query('SELECT name FROM method_catalog WHERE shop_id=$1', [blocked.shopId])).rows).toEqual([
        { name: 'Private method template' },
      ]);

      expect(await guardState()).toBe('O');
      expect(
        (
          await target.query(
            `SELECT 1 FROM inbox_messages actual JOIN jsonb_populate_recordset(NULL::public.inbox_messages,$1::jsonb) expected USING(id) WHERE actual.collected_at IS DISTINCT FROM expected.collected_at OR actual.purge_after IS DISTINCT FROM expected.purge_after`,
            [JSON.stringify(exclusions.data.inboxes)],
          )
        ).rowCount,
      ).toBe(0);
      const ordinary = (
        await target.query(
          `INSERT INTO inbox_messages(id,source,payload,payload_sha256,received_at,collected_at,retention_class,purge_after) VALUES($1,'synthetic','synthetic'::bytea,encode(sha256('synthetic'::bytea),'hex'),clock_timestamp(),'2000-01-01T00:00:00Z','synthetic',clock_timestamp()+interval '1 day') RETURNING collected_at`,
          [randomUUID()],
        )
      ).rows[0];
      expect(+ordinary.collected_at).toBeGreaterThan(Date.UTC(2026, 0, 1));

      expect(
        (await target.query('SELECT payload FROM purchase_design_payloads WHERE purchase_id=$1', [purchaseId])).rows[0]
          .payload,
      ).toBeNull();
      expect((await target.query('SELECT 1 FROM design_drafts WHERE design_id=$1', [existing.draftId])).rowCount).toBe(
        0,
      );
      expect(
        (await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [existing.assetId])).rows[0].state,
      ).toBe('DELETING');
      expect(await economics(target)).toBe(economicBefore);
      expect(await deadlines(target)).toEqual(deadlinesBefore);
      expect(result.readiness).toBe('HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION');
      expect(
        (await target.query('SELECT operation FROM customer_privacy_receipts WHERE inbox_id=$1', [request.id])).rows[0]
          .operation,
      ).toBe('DATA_REQUEST_PENDING_EXPORT');
      expect(
        (await target.query('SELECT octet_length(payload) AS bytes FROM inbox_messages WHERE id=$1', [orderReceipt.id]))
          .rows[0].bytes,
      ).toBe(0);
      expect(
        (await target.query('SELECT 1 FROM customer_privacy_order_links WHERE inbox_id=$1', [request.id])).rowCount,
      ).toBe(1);
      expect(
        (await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [stagedAsset.assetId])).rows[0].state,
      ).toBe('DELETING');
      expect(
        (await target.query('SELECT payload FROM purchase_offer_payloads WHERE quote_id=$1', [staged.quote.quoteId]))
          .rows[0].payload,
      ).toBeNull();
      expect(
        (await target.query('SELECT 1 FROM design_drafts WHERE design_id=$1', [stagedAsset.draftId])).rowCount,
      ).toBe(0);
      expect(
        (await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [blockedAsset.assetId])).rows[0]
          .state,
      ).toBe('UPLOADING');
      expect(
        (
          await target.query('SELECT payload IS NOT NULL AS retained FROM purchase_offer_payloads WHERE quote_id=$1', [
            blocked.quote.quoteId,
          ])
        ).rows[0].retained,
      ).toBe(true);
      expect(
        (await target.query('SELECT 1 FROM shop_privacy_fences WHERE shop_id=$1', [blocked.shopId])).rowCount,
      ).toBe(0);
      expect(
        (
          await target.query(
            'SELECT count(*)::integer AS n FROM customer_privacy_receipts WHERE shop_id=ANY($1::text[])',
            [[f.shopId, late.shopId]],
          )
        ).rows[0].n,
      ).toBe(3);
      const latePurchase = randomUUID();
      await target.query(
        "INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES($1,$2,1,'gid://shopify/Order/202',clock_timestamp(),'USD',2001)",
        [latePurchase, late.shopId],
      );
      await target.query('INSERT INTO purchase_bindings VALUES($1,1,$2,$3,$4,$5)', [
        late.shopId,
        latePurchase,
        late.quote.quoteId,
        late.authorization.setId,
        { immutable: 'economics' },
      ]);
      expect(
        (await target.query('SELECT payload FROM purchase_offer_payloads WHERE quote_id=$1', [late.quote.quoteId]))
          .rows[0].payload,
      ).toBeNull();
      expect((await target.query('SELECT 1 FROM design_drafts WHERE design_id=$1', [later.draftId])).rowCount).toBe(0);
      expect(
        (await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [later.assetId])).rows[0].state,
      ).toBe('DELETING');
      await expect(
        target.query("UPDATE artwork_assets SET state='QUEUED' WHERE asset_id=$1", [later.assetId]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await importErasureExclusions(target, exclusions)).toMatchObject({
        readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      });
      const conflict = structuredClone(exclusions);
      conflict.data.receipts = conflict.data.receipts.map((row) =>
        row.shop_id === f.shopId ? { ...row, staged_at: '2026-01-01T00:00:00Z' } : row,
      );
      await expect(importErasureExclusions(target, reseal(conflict))).rejects.toThrow(
        'conflicting copied erasure identity',
      );
      expect(await guardState()).toBe('O');
      await target.query(
        'UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1 AND generation=1',
        [blocked.shopId],
      );
      const retried = (
        await target.query('SELECT public.process_customer_privacy_inbox($1) AS result', [blockedReceipt.inbox_id])
      ).rows[0].result;
      expect(retried.kind).toBe('SHOP_ERASURE_BLOCKED');
      await source.query(
        `INSERT INTO webhook_obligation_facts(inbox_id,raw_body_sha256,collected_at,fulfill_by,forget_after,captured_fields)
        SELECT id,payload_sha256,collected_at,collected_at+interval '30 days',collected_at+interval '180 days','{"unresolved":true}'::jsonb FROM inbox_messages WHERE id=$1`,
        [orderReceipt.id],
      );
      await expect(exportErasureExclusions(source)).rejects.toThrow('unresolved transport obligation');
      expect(
        (await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [blockedAsset.assetId])).rows[0]
          .state,
      ).toBe('UPLOADING');
    } finally {
      await target?.end();
      await source.query(`DROP DATABASE IF EXISTS ${restoredName}`);
      await source.end();
      await db.destroy();
      await rm(temporary, { recursive: true, force: true });
    }
  },
  30000,
);

it.runIf(Boolean(process.env.PRIVACY_RESTORE_TEST_URL))(
  'exact-generation uninstall recovery survives actual restore without promoting the original blocked receipt',
  async () => {
    const address = process.env.PRIVACY_RESTORE_TEST_URL!;
    if (
      address !== process.env.DATABASE_URL ||
      !new URL(address).searchParams.get('host')?.startsWith('/tmp/insignia-restore-pg-')
    )
      throw Error('Fresh private restore cluster required');
    const tools = process.env.PRIVACY_PG_TOOLS!;
    const { createDatabase } = await import('../src/client/database.js');
    const { createTenantRepository } = await import('../src/repositories/tenant.js');
    const { createUninstallPrivacyRepository } = await import('../src/repositories/uninstall-privacy.js');
    const admin = new Pool({ connectionString: address });
    const suffix = randomUUID().replaceAll('-', '');
    const sourceName = 'uninstall_source_' + suffix,
      targetName = 'uninstall_target_' + suffix;
    const sourceUrl = new URL(address);
    sourceUrl.pathname = '/' + sourceName;
    const targetUrl = new URL(address);
    targetUrl.pathname = '/' + targetName;
    const temporary = await mkdtemp(join(tmpdir(), 'insignia-uninstall-restore-'));
    let source: Pool | undefined, target: Pool | undefined, db: ReturnType<typeof createDatabase> | undefined;
    try {
      const schema = join(temporary, 'schema.dump');
      execFileSync(
        join(tools, 'pg_dump'),
        ['--schema-only', '--format=custom', '--file', schema, '--dbname', address],
        { stdio: 'pipe' },
      );
      await admin.query('CREATE DATABASE ' + sourceName);
      await admin.query('CREATE DATABASE ' + targetName);
      execFileSync(join(tools, 'pg_restore'), ['--no-owner', '--exit-on-error', '--dbname', sourceUrl.href, schema], {
        stdio: 'pipe',
      });
      source = new Pool({ connectionString: sourceUrl.href });
      await source.query(
        'INSERT INTO schema_migrations(version) SELECT version FROM jsonb_to_recordset($1::jsonb) AS rows(version text)',
        [JSON.stringify((await admin.query('SELECT version FROM schema_migrations')).rows)],
      );
      db = createDatabase(new Pool({ connectionString: sourceUrl.href }));
      const shopId = randomUUID(),
        domain = 'r' + suffix + '.myshopify.com',
        provider = '987654321' + Math.floor(Math.random() * 10000);
      await db.transaction().execute((tx) =>
        createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: domain,
          shopifyShopId: provider,
          externalInstallationId: 'gid://shopify/AppInstallation/777',
        }),
      );
      const assetId = randomUUID();
      await source.query(
        "INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES($1,$2,1,$3,'guest','image/svg+xml',10,'UPLOADING',$4,$5,$6,statement_timestamp(),statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '7 days')",
        [assetId, shopId, 'a'.repeat(64), assetId + '/q', assetId + '/o', assetId + '/p'],
      );
      const hooks = createShopifyWebhookRepository(db);
      const privacy = await hooks.receive({
        shopDomain: domain,
        topic: 'shop/redact',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(JSON.stringify({ shop_id: provider, shop_domain: domain })),
      });
      await createCustomerPrivacyRepository(db).processInbox(privacy.id);
      const uninstall = await hooks.receive({
        shopDomain: domain,
        topic: 'app/uninstalled',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(JSON.stringify({ id: provider, myshopify_domain: domain })),
      });
      const digest = createHash('sha256').update(suffix).digest('hex');
      await source.query(
        "INSERT INTO uninstall_destinations(capability_digest,shop_id,installation_generation,external_installation_id,state) VALUES($1,$2,1,'gid://shopify/AppInstallation/777','prepared')",
        [digest, shopId],
      );
      await source.query(
        "UPDATE uninstall_destinations SET state='dispatched',dispatched_at=clock_timestamp() WHERE capability_digest=$1",
        [digest],
      );
      await source.query('INSERT INTO uninstall_delivery_authority VALUES($1,$2,clock_timestamp())', [
        uninstall.id,
        digest,
      ]);
      await db.transaction().execute((tx) => createTenantRepository(tx).deactivateCurrent(tx, shopId, '1'));
      await db.transaction().execute((tx) => createTenantRepository(tx).startInstallation(tx, shopId));
      const backup = join(temporary, 'before-recovery.dump');
      execFileSync(join(tools, 'pg_dump'), ['--format=custom', '--file', backup, '--dbname', sourceUrl.href], {
        stdio: 'pipe',
      });
      await createUninstallPrivacyRepository(db).recover(privacy.id, uninstall.id);
      await source.query('SELECT public.cleanup_customer_privacy_inboxes(100)');
      const exclusions = await exportErasureExclusions(source);
      expect(exclusions.format).toBe('insignia-privacy-erasure-exclusions-v2');
      expect(exclusions.data.uninstallRecoveries).toHaveLength(1);
      expect(exclusions.data.uninstallScopes).toMatchObject([
        { generation_ceiling: '1', observation_kind: 'original_processing' },
      ]);
      expect(required(exclusions.data.receipts[0]).operation).toBe('SHOP_ERASURE_BLOCKED');
      execFileSync(join(tools, 'pg_restore'), ['--no-owner', '--exit-on-error', '--dbname', targetUrl.href, backup], {
        stdio: 'pipe',
      });
      target = new Pool({ connectionString: targetUrl.href });
      const reseal = (copy: typeof exclusions) => {
        copy.sha256 = createHash('sha256')
          .update(
            JSON.stringify(copy.data, (_key, value) =>
              value && typeof value === 'object' && !Array.isArray(value)
                ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
                : value,
            ),
          )
          .digest('hex');
        return copy;
      };
      const widenedScope = structuredClone(exclusions);
      widenedScope.data.uninstallScopes = required(widenedScope.data.uninstallScopes).map((row, index) =>
        index === 0 ? { ...row, generation_ceiling: '2' } : row,
      );
      await expect(importErasureExclusions(target, reseal(widenedScope))).rejects.toThrow(
        'conflicting copied erasure identity',
      );
      const widened = structuredClone(exclusions);
      widened.data.assetFences.push({
        shop_id: shopId,
        asset_id: randomUUID(),
        source_inbox_id: privacy.id,
        created_at: new Date().toISOString(),
      });
      widened.sha256 = createHash('sha256')
        .update(
          JSON.stringify(widened.data, (_key, value) =>
            value && typeof value === 'object' && !Array.isArray(value)
              ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
              : value,
          ),
        )
        .digest('hex');
      await expect(importErasureExclusions(target, widened)).rejects.toThrow('foreign erasure fence');
      expect(await importErasureExclusions(target, exclusions)).toMatchObject({
        readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      });
      expect((await target.query('SELECT state FROM artwork_assets WHERE asset_id=$1', [assetId])).rows[0].state).toBe(
        'DELETING',
      );
      expect(
        (await target.query('SELECT installation_generation::text FROM shop_privacy_fences WHERE shop_id=$1', [shopId]))
          .rows,
      ).toEqual([{ installation_generation: '1' }]);
      expect(
        (
          await target.query('SELECT deactivated_at FROM installation_generations WHERE shop_id=$1 AND generation=2', [
            shopId,
          ])
        ).rows[0].deactivated_at,
      ).toBe(null);
      expect(
        (await target.query('SELECT operation FROM customer_privacy_receipts WHERE inbox_id=$1', [privacy.id])).rows[0]
          .operation,
      ).toBe('SHOP_ERASURE_BLOCKED');
      expect(
        (await target.query('SELECT count(*)::integer AS count FROM uninstall_privacy_recoveries')).rows[0].count,
      ).toBe(1);
      expect(await importErasureExclusions(target, exclusions)).toMatchObject({
        readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      });
    } finally {
      await db?.destroy();
      await source?.end();
      await target?.end();
      await admin.query('DROP DATABASE IF EXISTS ' + targetName);
      await admin.query('DROP DATABASE IF EXISTS ' + sourceName);
      await admin.end();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
