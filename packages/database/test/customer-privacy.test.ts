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
    expect(await repo.readDataRequest({ shopId: f.shopId, installationGeneration: '1' }, receipt)).toMatchObject({
      orders: [{ purchaseId, orderId: `gid://shopify/Order/${id}` }],
    });
    expect(
      (await sql`SELECT 1 FROM customer_order_erasure_fences WHERE shop_id=${f.shopId}`.execute(db)).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql<{
          erasure_state: string;
        }>`SELECT erasure_state FROM inbox_messages WHERE id=${receipt}::uuid`.execute(db)
      ).rows[0]?.erasure_state,
    ).toBe('erased');
  });
  it('makes requested records available only to the current merchant of the signed shop, including retained design and exact money', async () => {
    const f = await purchaseFixture(db),
      other = await purchaseFixture(db);
    const purchaseId = await order(f, '909'),
      assetId = await asset(f.shopId);
    await bind(f, purchaseId, assetId);
    await sql`INSERT INTO purchase_lines VALUES(${f.shopId},1,${purchaseId}::uuid,${f.authorization.setId}::uuid,'gid://shopify/LineItem/909',0,'p','v',1,9007199254740993)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_refund_facts VALUES(${f.shopId},1,${purchaseId}::uuid,'gid://shopify/Refund/909',clock_timestamp(),'USD',9007199254740993,'[]')`.execute(
      db,
    );
    await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) VALUES(${randomUUID()}::uuid,${f.shopId},1,${purchaseId}::uuid,1,'ATTACH',0,'expired-private-placement',${assetId}::uuid,clock_timestamp()-interval '1 second')`.execute(
      db,
    );
    const inbox = await receive(f.shopifyShopId, ['909'], 'request');
    const repo = createCustomerPrivacyRepository(db);
    await repo.processInbox(inbox);
    const scope = { shopId: f.shopId, installationGeneration: '1' };
    expect(await repo.listDataRequests(scope)).toMatchObject([
      { inboxId: inbox, requestId: '42', requestedOrderCount: 1 },
    ]);
    const manifest = await repo.readDataRequest(scope, inbox);
    expect(manifest).toMatchObject({ inboxId: inbox, orders: [{ orderId: 'gid://shopify/Order/909', purchaseId }] });
    const record = await repo.exportOrder(scope, inbox, purchaseId, f.authorization.setId);
    expect(record).toMatchObject({
      order: { orderId: 'gid://shopify/Order/909', originalTotalMinor: '2001' },
      lines: [{ unit_price_minor: '9007199254740993' }],
      refunds: [{ amount_minor: '9007199254740993' }],
      artworkEvents: [{ asset_id: null, placement_id: null, group_index: null }],
      designs: [
        {
          payload: {
            request: {
              groups: [{ group: { design: { placements: [{ artwork: { revisionId: assetId } }] } } }],
            },
          },
        },
      ],
    });
    expect(await repo.exportOrder(scope, inbox, purchaseId)).toMatchObject({
      designs: [{ payload: null, hasRetainedPayload: true }],
    });
    expect(JSON.stringify(record)).not.toMatch(/fixture@example|original_key|preview_key|owner_hash|envelope/);
    expect(await repo.readDataRequest({ shopId: other.shopId, installationGeneration: '1' }, inbox)).toBeNull();
    expect(await repo.exportOrder(scope, inbox, randomUUID())).toBeNull();
    expect(await repo.readDataRequest({ ...scope, installationGeneration: '2' }, inbox)).toBeNull();
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
    const related = await receive(
      f.shopifyShopId,
      [],
      'redact',
      'orders/updated',
      '{"id":101,"admin_graphql_api_id":"gid://shopify/Order/101","customer":{"email":"remove@example.invalid"}}',
    );
    const foreign = await receive(
      other.shopifyShopId,
      [],
      'redact',
      'orders/updated',
      '{"id":999,"admin_graphql_api_id":"gid://shopify/Order/999","customer":{"email":"keep@example.invalid"}}',
    );
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
    await sql`UPDATE inbox_messages SET state='processed' WHERE id=${related}::uuid`.execute(db);
    const pendingRefund = await receive(
      f.shopifyShopId,
      [],
      'redact',
      'refunds/create',
      '{"id":88,"admin_graphql_api_id":"gid://shopify/Refund/88","order_id":101}',
    );
    await repo.cleanupInboxes(100);
    expect(
      (
        await sql<{
          state: string;
          erasure_state: string;
        }>`SELECT state,erasure_state FROM inbox_messages WHERE id=${pendingRefund}::uuid`.execute(db)
      ).rows[0],
    ).toEqual({ state: 'pending', erasure_state: 'retained' });
    expect(
      (
        await sql<{
          erasure_state: string;
        }>`SELECT erasure_state FROM inbox_messages WHERE id=${related}::uuid`.execute(db)
      ).rows[0]?.erasure_state,
    ).toBe('erased');
    expect(
      (
        await sql<{
          erasure_state: string;
        }>`SELECT erasure_state FROM inbox_messages WHERE id=${foreign}::uuid`.execute(db)
      ).rows[0]?.erasure_state,
    ).toBe('retained');
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
  it('stages shop erasure only for an independently inactive current generation and never erases an active installation', async () => {
    const active = await purchaseFixture(db),
      inactive = await purchaseFixture(db);
    const keep = await asset(active.shopId),
      remove = await asset(inactive.shopId);
    await sql`UPDATE shops SET shop_domain=shop_id||'.myshopify.com' WHERE shop_id IN (${active.shopId},${inactive.shopId})`.execute(
      db,
    );
    const historyBefore = (
      await sql`SELECT revision_id,published_value,content_hash FROM config_revisions WHERE shop_id=${inactive.shopId} ORDER BY revision_id`.execute(
        db,
      )
    ).rows;
    const activeTemplate = randomUUID(),
      inactiveTemplate = randomUUID();
    for (const [shopId, id] of [
      [active.shopId, activeTemplate],
      [inactive.shopId, inactiveTemplate],
    ]) {
      await sql`INSERT INTO method_catalog(shop_id,method_id,name) VALUES(${shopId},${id}::uuid,'Private shop label')`.execute(
        db,
      );
      await sql`INSERT INTO idempotency_records(shop_id,namespace,idempotency_key,request_digest,status,result_ref,completed_at) VALUES(${shopId},'merchant-method-create:1:old','legacy-method-key',${'d'.repeat(64)},'completed','{"kind":"created","method":{"name":"Private shop label"}}',clock_timestamp())`.execute(
        db,
      );
    }
    const blocked = await receive(
      active.shopifyShopId,
      [],
      'redact',
      'shop/redact',
      `{"shop_id":${active.shopifyShopId},"shop_domain":"${active.shopId}.myshopify.com"}`,
    );
    const repo = createCustomerPrivacyRepository(db);
    expect(await repo.processInbox(blocked)).toMatchObject({ kind: 'SHOP_ERASURE_BLOCKED', shopId: active.shopId });
    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${keep}::uuid`.execute(db)).rows[0]
        ?.state,
    ).toBe('UPLOADING');
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${inactive.shopId}`.execute(
      db,
    );
    const inbox = await receive(
      inactive.shopifyShopId,
      [],
      'redact',
      'shop/redact',
      `{"shop_id":${inactive.shopifyShopId},"shop_domain":"${inactive.shopId}.myshopify.com"}`,
    );
    expect(await repo.processInbox(inbox)).toMatchObject({ kind: 'SHOP_ERASURE_STAGED', shopId: inactive.shopId });
    expect(await repo.processInbox(inbox)).toMatchObject({ kind: 'SHOP_ERASURE_STAGED' });
    expect((await sql`SELECT name FROM method_catalog WHERE shop_id=${inactive.shopId}`.execute(db)).rows).toHaveLength(
      0,
    );
    expect(
      JSON.stringify(
        (await sql`SELECT result_ref FROM idempotency_records WHERE shop_id=${inactive.shopId}`.execute(db)).rows,
      ),
    ).not.toContain('Private shop label');
    expect((await sql`SELECT name FROM method_catalog WHERE shop_id=${active.shopId}`.execute(db)).rows).toEqual([
      { name: 'Private shop label' },
    ]);
    expect(
      JSON.stringify(
        (await sql`SELECT result_ref FROM idempotency_records WHERE shop_id=${active.shopId}`.execute(db)).rows,
      ),
    ).toContain('Private shop label');
    expect(
      (
        await sql`SELECT revision_id,published_value,content_hash FROM config_revisions WHERE shop_id=${inactive.shopId} ORDER BY revision_id`.execute(
          db,
        )
      ).rows,
    ).toEqual(historyBefore);
    // A settled old receipt cannot erase names created by a new installation.
    await sql`INSERT INTO installation_generations(shop_id,generation) VALUES(${inactive.shopId},2)`.execute(db);
    await sql`UPDATE shops SET current_generation=current_generation+1 WHERE shop_id=${inactive.shopId}`.execute(db);
    await sql`INSERT INTO method_catalog(shop_id,method_id,name) VALUES(${inactive.shopId},${randomUUID()}::uuid,'New install label')`.execute(
      db,
    );
    expect(await repo.processInbox(inbox)).toMatchObject({ kind: 'SHOP_ERASURE_STAGED' });
    expect((await sql`SELECT name FROM method_catalog WHERE shop_id=${inactive.shopId}`.execute(db)).rows).toEqual([
      { name: 'New install label' },
    ]);

    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${remove}::uuid`.execute(db))
        .rows[0]?.state,
    ).toBe('DELETING');
    expect(
      (
        await sql`SELECT 1 FROM shop_privacy_fences WHERE shop_id=${inactive.shopId} AND installation_generation=1`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    const delayed = await receive(
      active.shopifyShopId,
      [],
      'redact',
      'shop/redact',
      `{"shop_id":${active.shopifyShopId},"shop_domain":"${active.shopId}.myshopify.com"}`,
    );
    // A request captured during an active installation never becomes retrospective
    // authority merely because that installation later deactivates.
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${active.shopId}`.execute(
      db,
    );
    expect(await repo.processInbox(blocked)).toMatchObject({ kind: 'SHOP_ERASURE_BLOCKED' });
    expect(await repo.processInbox(delayed)).toMatchObject({ kind: 'SHOP_ERASURE_BLOCKED' });
    expect((await sql`SELECT name FROM method_catalog WHERE shop_id=${active.shopId}`.execute(db)).rows).toEqual([
      { name: 'Private shop label' },
    ]);

    expect(
      (await sql<{ state: string }>`SELECT state FROM artwork_assets WHERE asset_id=${keep}::uuid`.execute(db)).rows[0]
        ?.state,
    ).toBe('UPLOADING');
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
