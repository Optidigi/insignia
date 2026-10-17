import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('body-bound customer privacy processing', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  async function receive(
    shopifyShopId: string,
    orderIds: string[],
    operation: 'request' | 'redact',
    topic = 'customers/redact',
    rawOverride?: string,
  ) {
    const body =
      rawOverride ??
      `{"shop_id":${shopifyShopId},"customer":{"id":9007199254740993,"email":"fixture@example.invalid"},${operation === 'request' ? '"data_request":{"id":42},"orders_requested"' : '"orders_to_redact"'}:[${orderIds.join(',')}]}`;
    const received = await createShopifyWebhookRepository(db).receive({
      shopDomain: 'untrusted-routing.myshopify.com',
      topic,
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(body),
    });
    return received.id;
  }
  async function order(f: Awaited<ReturnType<typeof purchaseFixture>>, id: string) {
    const purchaseId = randomUUID();
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES(${purchaseId}::uuid,${f.shopId},1,${`gid://shopify/Order/${id}`},clock_timestamp(),'USD',2001)`.execute(
      db,
    );
    return purchaseId;
  }
  async function bind(f: Awaited<ReturnType<typeof purchaseFixture>>, purchaseId: string, assetId: string) {
    await sql`INSERT INTO purchase_bindings VALUES(${f.shopId},1,${purchaseId}::uuid,${f.quote.quoteId}::uuid,${f.authorization.setId}::uuid,'{"immutable":"economics"}'::jsonb)`.execute(
      db,
    );
    const request = {
      groups: [{ group: { design: { placements: [{ artwork: { kind: 'revision', revisionId: assetId } }] } } }],
    };
    await sql`INSERT INTO purchase_offer_payloads VALUES(${f.shopId},1,${f.quote.quoteId}::uuid,clock_timestamp(),clock_timestamp()+interval '7 days',${JSON.stringify(request)}::jsonb,NULL)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_design_payloads VALUES(${f.shopId},1,${purchaseId}::uuid,${f.authorization.setId}::uuid,clock_timestamp(),clock_timestamp()+interval '7 days',${JSON.stringify({ request })}::jsonb,NULL)`.execute(
      db,
    );
  }
  async function asset(shopId: string) {
    const id = randomUUID();
    await sql`INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES(${id}::uuid,${shopId},1,${'a'.repeat(64)},'guest','image/svg+xml',10,'UPLOADING',${`${id}/q`},${`${id}/o`},${`${id}/p`},statement_timestamp(),statement_timestamp()+interval '5 minutes',statement_timestamp()+interval '7 days')`.execute(
      db,
    );
    return id;
  }
  it('signed request fields remain export-pending despite an unsigned redact topic; numeric IDs stay exact', async () => {
    const f = await purchaseFixture(db),
      id = '18446744073709551614',
      purchaseId = await order(f, id);
    const receipt = await receive(f.shopifyShopId, [id], 'request');
    const repo = createCustomerPrivacyRepository(db);
    expect(await repo.processInbox(receipt)).toMatchObject({
      kind: 'DATA_REQUEST_PENDING_EXPORT',
      shopId: f.shopId,
      requestedOrderCount: 1,
    });
    expect(await repo.lookupDataRequest(receipt)).toEqual([
      { purchaseId, orderId: `gid://shopify/Order/${id}`, hasPrivateDesign: false },
    ]);
    expect(
      (await sql`SELECT 1 FROM customer_order_erasure_fences WHERE shop_id=${f.shopId}`.execute(db)).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql<{
          erasure_state: string;
        }>`SELECT erasure_state FROM inbox_messages WHERE id=${receipt}::uuid`.execute(db)
      ).rows[0]?.erasure_state,
    ).toBe('retained');
  });
  it('redacts exact purchase/offer and ATTACH assets, stages existing cleanup without changing deadlines or economics, and replays safely', async () => {
    const f = await purchaseFixture(db),
      other = await purchaseFixture(db);
    const purchaseId = await order(f, '101'),
      primary = await asset(f.shopId),
      attached = await asset(f.shopId),
      unrelated = await asset(other.shopId);
    await bind(f, purchaseId, primary);
    await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) SELECT ${randomUUID()}::uuid,${f.shopId},1,${purchaseId}::uuid,1,'ATTACH',0,'front',asset_id,expires_at FROM artwork_assets WHERE asset_id=${attached}::uuid`.execute(
      db,
    );
    const before = (
      await sql<{ expires_at: Date }>`SELECT expires_at FROM artwork_assets WHERE asset_id=${primary}::uuid`.execute(db)
    ).rows[0]?.expires_at;
    const receipt = await receive(f.shopifyShopId, ['101'], 'redact', 'customers/data_request');
    const repo = createCustomerPrivacyRepository(db),
      result = await repo.processInbox(receipt);
    expect(result).toMatchObject({
      kind: 'ERASURE_STAGED',
      shopId: f.shopId,
      requestedOrderCount: 1,
      matchedPurchaseCount: 1,
    });
    expect(await repo.processInbox(receipt)).toEqual(result);
    expect(
      (
        await sql<{
          state: string;
          expires_at: Date;
        }>`SELECT state,expires_at FROM artwork_assets WHERE asset_id=${primary}::uuid`.execute(db)
      ).rows[0],
    ).toEqual({ state: 'DELETING', expires_at: before });
    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${attached}::uuid`.execute(db))
        .rows[0]?.state,
    ).toBe('DELETING');
    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${unrelated}::uuid`.execute(db))
        .rows[0]?.state,
    ).toBe('UPLOADING');
    expect(
      (
        await sql<{
          payload: unknown;
        }>`SELECT payload FROM purchase_design_payloads WHERE purchase_id=${purchaseId}::uuid`.execute(db)
      ).rows[0]?.payload,
    ).toBeNull();
    expect(
      (
        await sql<{
          asset_id: string | null;
        }>`SELECT asset_id FROM purchase_artwork_events WHERE purchase_id=${purchaseId}::uuid`.execute(db)
      ).rows[0]?.asset_id,
    ).toBeNull();
    expect(
      (
        await sql<{
          economics: unknown;
        }>`SELECT economics FROM purchase_bindings WHERE purchase_id=${purchaseId}::uuid`.execute(db)
      ).rows[0]?.economics,
    ).toEqual({ immutable: 'economics' });
    expect(
      (
        await sql<{
          erasure_state: string;
        }>`SELECT erasure_state FROM inbox_messages WHERE id=${receipt}::uuid`.execute(db)
      ).rows[0]?.erasure_state,
    ).toBe('erased');
    await expect(
      sql`UPDATE artwork_assets SET state='QUEUED' WHERE asset_id=${primary}::uuid`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('order fences survive a request before discovery and prevent late payload or merchant attachment reingestion', async () => {
    const f = await purchaseFixture(db),
      receipt = await receive(f.shopifyShopId, ['202'], 'redact');
    const repo = createCustomerPrivacyRepository(db);
    expect(await repo.processInbox(receipt)).toMatchObject({ matchedPurchaseCount: 0 });
    const purchaseId = await order(f, '202'),
      assetId = await asset(f.shopId),
      sessionId = randomUUID(),
      draftId = randomUUID();
    await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window) VALUES(${sessionId}::uuid,${f.shopId},1,${'b'.repeat(64)},statement_timestamp(),statement_timestamp()+interval '1 day',statement_timestamp())`.execute(
      db,
    );
    const draft = { design: { placements: [{ artwork: { kind: 'revision', revisionId: assetId } }] } };
    await sql`INSERT INTO design_drafts VALUES(${draftId}::uuid,${f.shopId},1,${sessionId}::uuid,1,${JSON.stringify(draft)}::jsonb,statement_timestamp()+interval '5 minutes')`.execute(
      db,
    );
    await bind(f, purchaseId, assetId);
    expect((await sql`SELECT 1 FROM design_drafts WHERE design_id=${draftId}::uuid`.execute(db)).rows).toHaveLength(0);
    await expect(
      sql`INSERT INTO design_drafts VALUES(${randomUUID()}::uuid,${f.shopId},1,${sessionId}::uuid,1,${JSON.stringify(draft)}::jsonb,statement_timestamp()+interval '5 minutes')`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await sql<{
          payload: unknown;
        }>`SELECT payload FROM purchase_design_payloads WHERE purchase_id=${purchaseId}::uuid`.execute(db)
      ).rows[0]?.payload,
    ).toBeNull();
    expect(
      (
        await sql<{
          payload: unknown;
        }>`SELECT payload FROM purchase_offer_payloads WHERE quote_id=${f.quote.quoteId}::uuid`.execute(db)
      ).rows[0]?.payload,
    ).toBeNull();
    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${assetId}::uuid`.execute(db))
        .rows[0]?.state,
    ).toBe('DELETING');
    const replacement = await asset(f.shopId);
    await expect(
      sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) SELECT ${randomUUID()}::uuid,${f.shopId},1,${purchaseId}::uuid,1,'ATTACH',0,'front',asset_id,expires_at FROM artwork_assets WHERE asset_id=${replacement}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects corrupt raw bytes before creating any erasure fence', async () => {
    const f = await purchaseFixture(db),
      receipt = await receive(f.shopifyShopId, ['303'], 'redact');
    await sql`UPDATE inbox_messages SET payload=convert_to('{"shop_id":1}','UTF8') WHERE id=${receipt}::uuid`.execute(
      db,
    );
    await expect(createCustomerPrivacyRepository(db).processInbox(receipt)).rejects.toThrow();
    expect(
      (await sql`SELECT 1 FROM customer_order_erasure_fences WHERE shop_id=${f.shopId}`.execute(db)).rows,
    ).toHaveLength(0);
  });
  it('uses signed-body shape and resolved shop consistently; public callers cannot forge fences or helper authority', async () => {
    const f = await purchaseFixture(db),
      other = await purchaseFixture(db);
    for (const body of [
      `{"shop_id":${f.shopifyShopId},"shop_domain":"ignored.myshopify.com"}`,
      `{"shop_id":${f.shopifyShopId},"customer":{"id":1},"orders_requested":[404],"orders_to_redact":[404],"data_request":{"id":1}}`,
      `{"shop_id":${f.shopifyShopId},"customer":{"id":1},"orders_to_redact":[18446744073709551616]}`,
    ]) {
      const inbox = await receive(f.shopifyShopId, [], 'redact', 'customers/redact', body);
      await expect(createCustomerPrivacyRepository(db).processInbox(inbox)).rejects.toThrow();
    }
    const routed = await receive(f.shopifyShopId, ['404'], 'redact');
    await sql`UPDATE inbox_messages SET shop_id=${other.shopId},installation_generation=1 WHERE id=${routed}::uuid`.execute(
      db,
    );
    await expect(createCustomerPrivacyRepository(db).processInbox(routed)).rejects.toThrow(
      'privacy inbox changed or routed to another shop',
    );
    expect(
      (
        await sql`SELECT 1 FROM customer_order_erasure_fences WHERE shop_id IN (${f.shopId},${other.shopId})`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    const privileges = (
      await sql<{ process: boolean; helper: boolean; fence: boolean }>`SELECT
      has_function_privilege('pg_read_all_stats','public.process_customer_privacy_inbox(uuid)','EXECUTE') AS process,
      has_function_privilege('pg_read_all_stats','public.customer_privacy_fence_quote(text,uuid,uuid)','EXECUTE') AS helper,
      has_table_privilege('pg_read_all_stats','public.customer_order_erasure_fences','INSERT') AS fence`.execute(db)
    ).rows[0];
    expect(privileges).toEqual({ process: false, helper: false, fence: false });
  });
  it('inbox contention has no partial effect and the same durable delivery can settle after the lock releases', async () => {
    const f = await purchaseFixture(db),
      inbox = await receive(f.shopifyShopId, ['505'], 'redact');
    await db.transaction().execute(async (transaction) => {
      await sql`SELECT 1 FROM inbox_messages WHERE id=${inbox}::uuid FOR UPDATE`.execute(transaction);
      await expect(createCustomerPrivacyRepository(db).processInbox(inbox)).rejects.toMatchObject({ code: '55P03' });
      expect(
        (await sql`SELECT 1 FROM customer_privacy_receipts WHERE inbox_id=${inbox}::uuid`.execute(transaction)).rows,
      ).toHaveLength(0);
    });
    expect(await createCustomerPrivacyRepository(db).processInbox(inbox)).toMatchObject({
      kind: 'ERASURE_STAGED',
      requestedOrderCount: 1,
    });
  });
});
