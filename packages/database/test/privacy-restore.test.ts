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
} from '../../../scripts/privacy/restore-exclusions.mjs';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

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
      late = await purchaseFixture(db);
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
      purchaseId = randomUUID();
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
      const exclusions = await exportErasureExclusions(source);
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
      drift.data.generations.find((row: { shop_id: string }) => row.shop_id === f.shopId).authorization_generation =
        randomUUID();
      await expect(importErasureExclusions(target, reseal(drift))).rejects.toThrow('installation identity drift');
      const corrupt = structuredClone(exclusions);
      const receiptId = corrupt.data.receipts.find((row: { shop_id: string }) => row.shop_id === f.shopId).inbox_id;
      corrupt.data.inboxes.find((row: { id: string }) => row.id === receiptId).attempts = -1;
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
      const result = await importErasureExclusions(target, exclusions);
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
        (
          await target.query(
            'SELECT count(*)::integer AS n FROM customer_privacy_receipts WHERE shop_id=ANY($1::text[])',
            [[f.shopId, late.shopId]],
          )
        ).rows[0].n,
      ).toBe(2);
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
      conflict.data.receipts.find((row: { shop_id: string }) => row.shop_id === f.shopId).staged_at =
        '2026-01-01T00:00:00Z';
      await expect(importErasureExclusions(target, reseal(conflict))).rejects.toThrow(
        'conflicting copied erasure identity',
      );
      expect(await guardState()).toBe('O');
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
