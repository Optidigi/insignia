import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createUninstallPrivacyRepository } from '../src/repositories/uninstall-privacy.js';
import { openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('independent generation-only uninstall privacy recovery', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  async function fixture() {
    const shopId = randomUUID(),
      shopDomain = `p${randomBytes(12).toString('hex')}.myshopify.com`,
      shopifyShopId = BigInt('0x' + randomBytes(6).toString('hex')).toString();
    await db.transaction().execute((tx) =>
      createTenantRepository(tx).createShop(tx, {
        shopId,
        shopDomain,
        shopifyShopId,
        externalInstallationId: 'gid://shopify/AppInstallation/7',
      }),
    );
    const hooks = createShopifyWebhookRepository(db);
    const uninstall = await hooks.receive({
      shopDomain,
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain })),
    });
    const privacy = await hooks.receive({
      shopDomain,
      topic: 'shop/redact',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ shop_id: shopifyShopId, shop_domain: shopDomain })),
    });
    await createCustomerPrivacyRepository(db).processInbox(privacy.id);
    const asset = randomUUID();
    await sql`INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES(${asset}::uuid,${shopId},1,${'a'.repeat(64)},'guest','image/svg+xml',10,'UPLOADING',${asset + '/q'},${asset + '/o'},${asset + '/p'},statement_timestamp(),statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '7 days')`.execute(
      db,
    );
    return { shopId, uninstall: uninstall.id, privacy: privacy.id, asset };
  }
  async function qualify(f: Awaited<ReturnType<typeof fixture>>) {
    const digest = randomBytes(32).toString('hex');
    await sql`INSERT INTO uninstall_destinations(capability_digest,shop_id,installation_generation,external_installation_id,state) VALUES(${digest},${f.shopId},1,'gid://shopify/AppInstallation/7','prepared')`.execute(
      db,
    );
    await sql`UPDATE uninstall_destinations SET state='dispatched',dispatched_at=clock_timestamp() WHERE capability_digest=${digest}`.execute(
      db,
    );
    await sql`INSERT INTO uninstall_delivery_authority(inbox_id,capability_digest) VALUES(${f.uninstall}::uuid,${digest})`.execute(
      db,
    );
  }
  it('generic receipt remains held, then qualified inactive generation stages cleanup without changing original BLOCKED', async () => {
    const f = await fixture();
    const repo = createUninstallPrivacyRepository(db);
    const originalDates = (
      await sql`SELECT collected_at,expires_at,upload_until FROM artwork_assets WHERE asset_id=${f.asset}::uuid`.execute(
        db,
      )
    ).rows;
    await expect(repo.recover(f.privacy, f.uninstall)).rejects.toThrow();
    await qualify(f);
    await expect(repo.recover(f.privacy, f.uninstall)).rejects.toThrow();
    await db.transaction().execute((tx) => createTenantRepository(tx).deactivateCurrent(tx, f.shopId, '1'));
    expect(await repo.recover(f.privacy, f.uninstall)).toMatchObject({
      kind: 'GENERATION_ERASURE_STAGED',
      shopId: f.shopId,
      installationGeneration: '1',
    });
    expect(await repo.recover(f.privacy, f.uninstall)).toMatchObject({ installationGeneration: '1' });
    expect(
      (
        await sql<{
          operation: string;
        }>`SELECT operation FROM customer_privacy_receipts WHERE inbox_id=${f.privacy}::uuid`.execute(db)
      ).rows[0]?.operation,
    ).toBe('SHOP_ERASURE_BLOCKED');
    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${f.asset}::uuid`.execute(db))
        .rows[0]?.state,
    ).toBe('DELETING');
    expect(
      (
        await sql<{
          count: string;
        }>`SELECT count(*)::text FROM uninstall_privacy_recoveries WHERE privacy_inbox_id=${f.privacy}::uuid`.execute(
          db,
        )
      ).rows[0]?.count,
    ).toBe('1');
    expect(
      (
        await sql`SELECT collected_at,expires_at,upload_until FROM artwork_assets WHERE asset_id=${f.asset}::uuid`.execute(
          db,
        )
      ).rows,
    ).toEqual(originalDates);
    expect(
      (await sql`SELECT inbox_id FROM customer_privacy_receipts WHERE inbox_id=${f.uninstall}::uuid`.execute(db)).rows,
    ).toHaveLength(0);
    await expect(
      sql`UPDATE uninstall_privacy_recoveries SET decided_at=clock_timestamp() WHERE privacy_inbox_id=${f.privacy}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
  });
  it('recovery after reinstall fences only old independently inactive generation and keeps new active generation untouched', async () => {
    const f = await fixture();
    await qualify(f);
    await db.transaction().execute((tx) => createTenantRepository(tx).deactivateCurrent(tx, f.shopId, '1'));
    await db.transaction().execute((tx) => createTenantRepository(tx).startInstallation(tx, f.shopId));
    expect(await createUninstallPrivacyRepository(db).recoverPending(100)).toBeGreaterThanOrEqual(1);
    expect(
      (
        await sql<{
          generation: string;
        }>`SELECT installation_generation::text AS generation FROM shop_privacy_fences WHERE shop_id=${f.shopId}`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ generation: '1' }]);
    expect(await createTenantRepository(db).getCurrentAdminInstallation(f.shopId)).toMatchObject({
      generation: '2',
      active: true,
    });
    expect(await createUninstallPrivacyRepository(db).status()).toMatchObject({
      activeGenerationHoldCount: expect.any(Number),
      blockedReceiptCount: expect.any(Number),
    });
    const foreign = await fixture();
    await expect(createUninstallPrivacyRepository(db).recover(foreign.privacy, f.uninstall)).rejects.toThrow();
  });
  it('restricted recovery caller has EXECUTE only and cannot read or rewrite authority decisions', async () => {
    const role = 'uninstall_recovery_' + randomUUID().replaceAll('-', '');
    await sql.raw(`CREATE ROLE ${role}`).execute(db);
    try {
      await sql.raw(`GRANT USAGE ON SCHEMA public TO ${role}`).execute(db);
      await sql.raw(`GRANT EXECUTE ON FUNCTION public.uninstall_privacy_status() TO ${role}`).execute(db);
      const result = await db.transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL ROLE ${role}`).execute(tx);
        return (
          await sql<{
            value: { blockedReceiptCount: number };
          }>`SELECT public.uninstall_privacy_status() AS value`.execute(tx)
        ).rows[0]?.value;
      });
      expect(result?.blockedReceiptCount).toBeGreaterThanOrEqual(0);
      await expect(
        db.transaction().execute(async (tx) => {
          await sql.raw(`SET LOCAL ROLE ${role}`).execute(tx);
          await sql`SELECT * FROM uninstall_privacy_recoveries`.execute(tx);
        }),
      ).rejects.toThrow('permission denied');
      await expect(
        db.transaction().execute(async (tx) => {
          await sql.raw(`SET LOCAL ROLE ${role}`).execute(tx);
          await sql`SELECT public.recover_pending_uninstall_privacy(1)`.execute(tx);
        }),
      ).rejects.toThrow('permission denied');
    } finally {
      await sql.raw(`DROP OWNED BY ${role}`).execute(db);
      await sql.raw(`DROP ROLE ${role}`).execute(db);
    }
  });
});
