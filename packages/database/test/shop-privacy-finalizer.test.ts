import { randomUUID } from 'node:crypto';
import { ARTWORK_POLICY, receiveVerifiedShopifyWebhook } from '@insignia/application';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('shop privacy finalizer', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => db?.destroy());

  async function fixture() {
    const shopId = randomUUID();
    const shopDomain = `${shopId}.myshopify.com`;
    const shopifyShopId = BigInt(`0x${shopId.replaceAll('-', '').slice(0, 14)}`).toString();
    const tenant = createTenantRepository(db);
    await db.transaction().execute((tx) =>
      tenant.createShop(tx, {
        shopId,
        shopDomain,
        shopifyShopId,
        externalInstallationId: 'gid://shopify/AppInstallation/1',
      }),
    );
    const deactivate = () =>
      sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${shopId} AND generation=1`.execute(
        db,
      );
    const receive = () => stage(shopDomain, shopifyShopId);
    return { shopId, shopDomain, shopifyShopId, deactivate, receive, tenant };
  }

  async function stage(shopDomain: string, shopifyShopId: string) {
    const receipt = await createShopifyWebhookRepository(db).receive({
      shopDomain: 'synthetic-routing.myshopify.com',
      topic: 'shop/redact',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      deliveryId: randomUUID(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ shop_id: shopifyShopId, shop_domain: shopDomain })),
    });
    return createCustomerPrivacyRepository(db).processInbox(receipt.id);
  }

  const insertConfig = (shopId: string, id: string) =>
    sql`INSERT INTO product_configs(shop_id,config_id,external_product_id,draft_schema_version,draft_value)
      VALUES(${shopId},${id},${id},'test','{"merchantData":true}')`.execute(db);
  const configs = async (shopId: string) =>
    (await sql<{ config_id: string }>`SELECT config_id FROM product_configs WHERE shop_id=${shopId}`.execute(db)).rows;
  async function finalize(shopId: string, generation = 1) {
    return (
      await sql<{
        result: string;
      }>`SELECT public.finalize_shop_privacy_generation(${shopId},${generation}::bigint,20) result`.execute(db)
    ).rows[0]?.result;
  }
  async function confirmFixtureQueueCleanup(shopId: string) {
    await sql`UPDATE shopify_webhook_deliveries d SET queue_cleanup_pending=false
      FROM shop_privacy_transport_scope t JOIN inbox_messages i ON i.id=t.inbox_id
      WHERE d.inbox_id=t.inbox_id AND t.shop_id=${shopId} AND i.erasure_state='erased'`.execute(db);
  }
  async function drain(shopId: string, cleanQueue = true) {
    for (let i = 0; i < 100; i++) {
      if (cleanQueue) await confirmFixtureQueueCleanup(shopId);
      const result = await finalize(shopId);
      if (result !== 'progress') return result;
    }
    throw new Error('Shop privacy finalizer did not converge');
  }

  it('holds a newly delivered generationless request after a reinstall has also deactivated', async () => {
    const f = await fixture();
    await f.deactivate();
    await db.transaction().execute((tx) => f.tenant.startInstallation(tx, f.shopId, 'gid://shopify/AppInstallation/2'));
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp()
      WHERE shop_id=${f.shopId} AND generation=2`.execute(db);

    expect(await f.receive()).toMatchObject({ kind: 'SHOP_ERASURE_BLOCKED' });
    expect(await finalize(f.shopId, 2)).toBe('no_authority');
  });

  it('removes raw delivery routing once the queue is clean and acknowledges only exact retries', async () => {
    const f = await fixture();
    await f.deactivate();
    const hooks = createShopifyWebhookRepository(db);
    const delivery = {
      shopDomain: f.shopDomain,
      topic: 'shop/redact',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      deliveryId: randomUUID(),
      eventId: randomUUID(),
      name: null,
      rawBody: Buffer.from(JSON.stringify({ shop_id: f.shopifyShopId, shop_domain: f.shopDomain })),
    };
    const receipt = await hooks.receive(delivery);
    await createCustomerPrivacyRepository(db).processInbox(receipt.id);
    expect(await drain(f.shopId, false)).toBe('dependency_pending');
    await confirmFixtureQueueCleanup(f.shopId);
    expect(await drain(f.shopId)).toBe('drained');
    expect(
      await receiveVerifiedShopifyWebhook(
        hooks,
        {
          async ensureEnqueued() {
            throw new Error('A completed retry must not send a job');
          },
        },
        delivery,
      ),
    ).toEqual({ kind: 'processed', inboxId: receipt.id, queue: 'not_needed' });
    await expect(hooks.receive({ ...delivery, eventId: randomUUID() })).rejects.toThrow('conflicts');
    expect(
      (await sql`SELECT external_delivery_id FROM inbox_messages WHERE id=${receipt.id}::uuid`.execute(db)).rows,
    ).toEqual([{ external_delivery_id: null }]);
    expect(
      (await sql`SELECT 1 FROM shopify_webhook_deliveries WHERE inbox_id=${receipt.id}::uuid`.execute(db)).rows,
    ).toEqual([]);
    await sql`UPDATE shop_privacy_replays SET forget_at=clock_timestamp()-interval '1 second'
      WHERE inbox_id=${receipt.id}::uuid`.execute(db);
    await sql`SELECT public.finalize_pending_shop_privacy(1)`.execute(db);
    expect((await sql`SELECT 1 FROM shop_privacy_replays WHERE inbox_id=${receipt.id}::uuid`.execute(db)).rows).toEqual(
      [],
    );
  });

  it('drains already-expired transport when its exact generation has erasure authority', async () => {
    const f = await fixture();
    const hooks = createShopifyWebhookRepository(db);
    const order = await hooks.receive({
      shopDomain: f.shopDomain,
      topic: 'orders/create',
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      deliveryId: randomUUID(),
      eventId: null,
      name: null,
      rawBody: Buffer.from('{"id":123}'),
    });
    await sql`UPDATE inbox_messages SET payload=''::bytea,erasure_state='erased'
      WHERE id=${order.id}::uuid`.execute(db);
    await f.deactivate();
    await f.receive();
    expect(await drain(f.shopId)).toBe('drained');
    expect(
      (await sql`SELECT state,external_delivery_id FROM inbox_messages WHERE id=${order.id}::uuid`.execute(db)).rows,
    ).toEqual([{ state: 'processed', external_delivery_id: null }]);
  });

  it('scrubs provider identity and requires a fresh confirmed installation before reconnecting the same tenant', async () => {
    const f = await fixture();
    await f.deactivate();
    await f.receive();
    expect(await drain(f.shopId)).toBe('drained');
    expect(
      (await sql`SELECT shop_domain,shopify_shop_id FROM shops WHERE shop_id=${f.shopId}`.execute(db)).rows,
    ).toEqual([{ shop_domain: `${f.shopId}.erased.invalid`, shopify_shop_id: null }]);
    const expected = await f.tenant.getManagedInstallationState(f.shopDomain);
    expect(expected).toMatchObject({ shopId: f.shopId, active: false, externalInstallationId: null });
    const install = (id: number) => {
      const identity = {
        shopDomain: f.shopDomain,
        shopifyShopId: f.shopifyShopId,
        externalInstallationId: `gid://shopify/AppInstallation/${id}`,
      };
      return db.transaction().execute((tx) =>
        f.tenant.ensureManagedInstallation(tx, {
          ...identity,
          expected,
          observationStartedAt: new Date(),
          confirmation: identity,
        }),
      );
    };
    await expect(install(1)).rejects.toMatchObject({ kind: 'state_changed' });
    expect(await install(2)).toMatchObject({
      outcome: 'REINSTALLED',
      state: { shopId: f.shopId, currentGeneration: '2', active: true },
    });
    expect(await finalize(f.shopId)).toBe('drained');
  });

  it('deletes shop-wide configuration only for a verified exact inactive current generation', async () => {
    const inactive = await fixture();
    await insertConfig(inactive.shopId, 'inactive');
    await inactive.deactivate();
    expect(await inactive.receive()).toMatchObject({ kind: 'SHOP_ERASURE_STAGED' });

    const blocked = await fixture();
    await insertConfig(blocked.shopId, 'blocked');
    expect(await blocked.receive()).toMatchObject({ kind: 'SHOP_ERASURE_BLOCKED' });
    await blocked.deactivate();
    expect(await finalize(blocked.shopId)).toBe('no_authority');
    expect(await configs(blocked.shopId)).toEqual([{ config_id: 'blocked' }]);

    const reinstalled = await fixture();
    await insertConfig(reinstalled.shopId, 'shared');
    await reinstalled.deactivate();
    expect(await reinstalled.receive()).toMatchObject({ kind: 'SHOP_ERASURE_STAGED' });
    await db.transaction().execute(async (tx) => {
      await reinstalled.tenant.startInstallation(tx, reinstalled.shopId, 'gid://shopify/AppInstallation/2');
      await expect(finalize(reinstalled.shopId)).rejects.toMatchObject({ code: '55P03' });
    });
    expect(await finalize(reinstalled.shopId, 2)).toBe('no_authority');
    expect(await drain(reinstalled.shopId)).toBe('dependency_pending');
    expect(await configs(reinstalled.shopId)).toEqual([{ config_id: 'shared' }]);

    expect(await drain(inactive.shopId)).toBe('drained');
    expect(await configs(inactive.shopId)).toEqual([]);
    expect(await finalize(inactive.shopId)).toBe('drained');
  });

  it('drains immutable purchase, quote and publication rows in FK order and scrubs a legacy private key first', async () => {
    const f = await purchaseFixture(db);
    const purchaseId = randomUUID();
    const orderCreated = new Date().toISOString();
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor,is_test)
      VALUES(${purchaseId}::uuid,${f.shopId},1,'gid://shopify/Order/101',${orderCreated}::timestamptz,'USD',2001,false)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_bindings VALUES(${f.shopId},1,${purchaseId}::uuid,${f.quote.quoteId}::uuid,${f.authorization.setId}::uuid,'{}')`.execute(
      db,
    );
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at)
      VALUES(${purchaseId}::uuid,${f.shopId},1,${orderCreated}::timestamptz)`.execute(db);
    const usageDecision = JSON.stringify({
      kind: 'ELIGIBLE',
      units: 1,
      shopId: f.shopId,
      installationGeneration: '1',
      orderId: 'gid://shopify/Order/101',
      occurredAt: orderCreated,
      policy: { id: 'retired-plan', version: 'v1' },
      cycleId: 'retired-cycle',
    });
    await sql`INSERT INTO m9_order_usage(purchase_id,shop_id,installation_generation,order_id,first_paid_at,qualification,decision,history_policy_hash)
      VALUES(${purchaseId}::uuid,${f.shopId},1,'gid://shopify/Order/101',${orderCreated}::timestamptz,'ELIGIBLE',${usageDecision}::jsonb,repeat('a',64))`.execute(
      db,
    );
    await sql`INSERT INTO m9_usage_delivery_intents(purchase_id,shop_id,installation_generation,order_id,occurred_at,units,policy_id,policy_version,cycle_id,app_id,provider_shop_id,meter_handle)
      VALUES(${purchaseId}::uuid,${f.shopId},1,'gid://shopify/Order/101',${orderCreated}::timestamptz,1,'retired-plan','v1','retired-cycle','gid://shopify/App/1234',${`gid://shopify/Shop/${f.shopifyShopId}`},'retired-meter')`.execute(
      db,
    );
    // Seed the real pre-migration-71 state: deactivation has happened and a
    // wrapped private key still exists. The fixture restores the trigger before committing.
    await db.transaction().execute(async (tx) => {
      await sql`ALTER TABLE installation_generations DISABLE TRIGGER installation_deactivation_destroys_signing_keys`.execute(
        tx,
      );
      await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${f.shopId}`.execute(
        tx,
      );
      await sql`ALTER TABLE installation_generations ENABLE TRIGGER installation_deactivation_destroys_signing_keys`.execute(
        tx,
      );
    });
    const shopDomain = `${f.shopId}.myshopify.com`;
    await sql`UPDATE shops SET shop_domain=${shopDomain} WHERE shop_id=${f.shopId}`.execute(db);
    expect(await stage(shopDomain, f.shopifyShopId)).toMatchObject({ kind: 'SHOP_ERASURE_STAGED' });
    await expect(sql`DELETE FROM purchase_orders WHERE shop_id=${f.shopId}`.execute(db)).rejects.toMatchObject({
      code: '23000',
    });
    expect(await finalize(f.shopId)).toBe('progress');
    expect(
      (await sql`SELECT state,private_envelope,wrapping_key_id FROM signing_keys WHERE shop_id=${f.shopId}`.execute(db))
        .rows,
    ).toEqual([{ state: 'destroyed', private_envelope: null, wrapping_key_id: null }]);
    expect(await drain(f.shopId)).toBe('drained');
    expect(
      (
        await sql`SELECT l.order_id FROM customer_privacy_order_links l
        JOIN customer_privacy_receipts r USING(inbox_id) WHERE r.shop_id=${f.shopId}`.execute(db)
      ).rows,
    ).toEqual([]);
    for (const relation of [
      'purchase_orders',
      'purchase_bindings',
      'purchase_paid_facts',
      'm9_order_usage',
      'm9_usage_delivery_intents',
      'accepted_quotes',
      'signing_keys',
      'quote_authorization_sets',
      'publication_operations',
      'config_revisions',
      'product_configs',
      'customer_order_erasure_fences',
    ]) {
      expect((await sql`SELECT 1 FROM ${sql.table(relation)} WHERE shop_id=${f.shopId}`.execute(db)).rows).toEqual([]);
    }
    const tenant = createTenantRepository(db);
    const successor = {
      shopDomain,
      shopifyShopId: f.shopifyShopId,
      externalInstallationId: 'gid://shopify/AppInstallation/2',
    };
    const expected = await tenant.getManagedInstallationState(shopDomain);
    await db.transaction().execute((tx) =>
      tenant.ensureManagedInstallation(tx, {
        ...successor,
        expected,
        confirmation: successor,
        observationStartedAt: new Date(),
      }),
    );
    expect(
      await createPurchaseRepository(db).reconcile({
        order: {
          shopId: f.shopId,
          installationGeneration: '2',
          orderId: 'gid://shopify/Order/101',
          createdAt: orderCreated,
          updatedAt: orderCreated,
          observedAt: new Date().toISOString(),
          currency: 'USD',
          country: 'US',
          marketId: '1',
          totalPriceMinor: '2001',
          contextVerified: true,
          test: true,
          sourceApiVersion: '2026-07',
          edited: false,
          complete: true,
          financialStatus: 'PAID',
          cancelledAt: null,
          lines: [],
          transactions: [],
          refunds: [],
        },
        bindings: [],
        exception: 'AUTHORIZATION_INCOMPLETE',
        firstPaidAt: null,
      }),
    ).toEqual({ kind: 'not_customized' });
  });

  it('erases retired usage records linked to retail orders under the exact shop fence', async () => {
    const f = await fixture();
    const purchaseId = randomUUID();
    await insertConfig(f.shopId, 'erasable');
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor,is_test)
      VALUES(${purchaseId}::uuid,${f.shopId},1,'gid://shopify/Order/102',clock_timestamp(),'USD',2001,true)`.execute(
      db,
    );
    await sql`INSERT INTO m9_order_usage(purchase_id,shop_id,installation_generation,order_id,qualification,decision,history_policy_hash)
      VALUES(${purchaseId}::uuid,${f.shopId},1,'gid://shopify/Order/102','EXCLUDED','{"kind":"EXCLUDED","units":0,"reason":"TEST_ORDER"}',repeat('a',64))`.execute(
      db,
    );
    await f.deactivate();
    await f.receive();
    await expect(sql`DELETE FROM m9_order_usage WHERE shop_id=${f.shopId}`.execute(db)).rejects.toMatchObject({
      code: '23514',
    });
    expect(await drain(f.shopId)).toBe('drained');
    expect(await configs(f.shopId)).toEqual([]);
    expect((await sql`SELECT 1 FROM m9_order_usage WHERE shop_id=${f.shopId}`.execute(db)).rows).toEqual([]);
    expect((await sql`SELECT 1 FROM purchase_orders WHERE shop_id=${f.shopId}`.execute(db)).rows).toEqual([]);
  });

  it('keeps object custody until a successful late-write sweep and resumes from the same fence', async () => {
    const f = await fixture();
    const assetId = randomUUID();
    await sql`INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,
      declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at)
      VALUES(${assetId}::uuid,${f.shopId},1,repeat('a',64),'guest','image/png',12,'UPLOADING',
      ${`${assetId}/q`},${`${assetId}/o`},${`${assetId}/p`},statement_timestamp(),
      statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '1 day')`.execute(db);
    await f.deactivate();
    await f.receive();
    expect(await drain(f.shopId)).toBe('storage_pending');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const storageCustody = createArtworkRepository(pool, db);
      const firstAttempt = new Date();
      expect(await storageCustody.markDeleting(assetId, firstAttempt)).toMatchObject({ state: 'DELETING' });
      await storageCustody.finishDeleting(assetId, firstAttempt);
      expect(await finalize(f.shopId)).toBe('storage_pending');
      const { rows } = await sql<{ settled_base: Date }>`
        SELECT greatest(updated_at,upload_until) AS settled_base FROM artwork_assets WHERE asset_id=${assetId}::uuid
      `.execute(db);
      const settledBase = rows[0]?.settled_base;
      if (!settledBase) throw new Error('Object custody disappeared before settlement');
      const boundary = +settledBase + ARTWORK_POLICY.leaseMs + 30_000;
      const earlyAttempt = new Date(boundary - 1);
      expect(await storageCustody.markDeleting(assetId, earlyAttempt)).toMatchObject({ state: 'DELETED' });
      await storageCustody.finishDeleting(assetId, earlyAttempt);
      expect(await finalize(f.shopId)).toBe('storage_pending');
      const lateAttempt = new Date(boundary + ARTWORK_POLICY.cleanup.resweepMs + 1);
      expect(await storageCustody.markDeleting(assetId, lateAttempt)).toMatchObject({ state: 'DELETED' });
      await storageCustody.finishDeleting(assetId, lateAttempt);
    } finally {
      await pool.end();
    }
    expect(await drain(f.shopId)).toBe('drained');
    expect((await sql`SELECT 1 FROM artwork_assets WHERE asset_id=${assetId}::uuid`.execute(db)).rows).toEqual([]);
  });

  it('accounts for the live PostgreSQL foreign keys that can hold purchase and object custody rows', async () => {
    const dependencies = await sql<{ parent: string; child: string }>`
      SELECT confrelid::regclass::text AS parent,conrelid::regclass::text AS child
      FROM pg_constraint WHERE contype='f' AND confrelid IN (
        'purchase_orders'::regclass,'artwork_assets'::regclass,'merchant_preview_assets'::regclass)
      ORDER BY parent,child`.execute(db);
    expect(dependencies.rows.map(({ parent, child }) => `${parent} <- ${child}`)).toEqual([
      'merchant_preview_assets <- config_revision_preview_assets',
      'purchase_orders <- customer_artwork_grants',
      'purchase_orders <- customer_artwork_notifications',
      'purchase_orders <- m9_order_usage',
      'purchase_orders <- m9_usage_delivery_intents',
      'purchase_orders <- purchase_artwork_events',
      'purchase_orders <- purchase_bindings',
      'purchase_orders <- purchase_design_payloads',
      'purchase_orders <- purchase_lines',
      'purchase_orders <- purchase_observations',
      'purchase_orders <- purchase_order_labels',
      'purchase_orders <- purchase_paid_facts',
      'purchase_orders <- purchase_refund_facts',
    ]);
  });
});
