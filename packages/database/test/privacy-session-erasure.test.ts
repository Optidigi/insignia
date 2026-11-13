import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUYER_SESSION_POLICY, createBuyerRepository } from '../src/repositories/buyer.js';
import { createCustomerPrivacyRepository } from '../src/repositories/customer-privacy.js';
import { createShopifyWebhookRepository } from '../src/repositories/shopify-webhooks.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createUninstallPrivacyRepository } from '../src/repositories/uninstall-privacy.js';
import { openTestDatabase } from './support/postgres.js';

/**
 * #406: a shop's buyer sessions cascade to ~1,600 rows each when full (100 drafts, 1,000
 * proposals, 250 cart applications). Erasure must never delete them in one statement; the worker's
 * statement timeout would roll the whole erasure back and retry it forever.
 */
describe.runIf(Boolean(process.env.DATABASE_URL))('uninstall/privacy erasure of buyer sessions (#406)', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  const SESSIONS = 45;
  const bound = BUYER_SESSION_POLICY.cleanupSessionsPerStatement;
  beforeAll(async () => {
    db = await openTestDatabase();
    // Test-only audit: every DELETE statement on buyer_sessions records how many sessions it removed.
    await sql`CREATE TABLE IF NOT EXISTS public.test_session_delete_audit(shop_id text NOT NULL, erased integer NOT NULL)`.execute(
      db,
    );
    await sql`CREATE OR REPLACE FUNCTION public.test_session_delete_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.test_session_delete_audit SELECT shop_id,count(*) FROM old_rows GROUP BY shop_id; RETURN NULL; END $$`.execute(
      db,
    );
    await sql`DROP TRIGGER IF EXISTS test_session_delete_audit ON public.buyer_sessions`.execute(db);
    await sql`CREATE TRIGGER test_session_delete_audit AFTER DELETE ON public.buyer_sessions
      REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.test_session_delete_audit()`.execute(
      db,
    );
  });
  afterAll(async () => {
    await sql`DROP TRIGGER IF EXISTS test_session_delete_audit ON public.buyer_sessions`.execute(db);
    await sql`DROP FUNCTION IF EXISTS public.test_session_delete_audit()`.execute(db);
    await sql`DROP TABLE IF EXISTS public.test_session_delete_audit`.execute(db);
    await db?.destroy();
  });

  async function shopWithFullSessions() {
    const shopId = randomUUID(),
      shopDomain = `p${randomBytes(12).toString('hex')}.myshopify.com`,
      shopifyShopId = BigInt(`0x${randomBytes(6).toString('hex')}`).toString();
    await db.transaction().execute((tx) =>
      createTenantRepository(tx).createShop(tx, {
        shopId,
        shopDomain,
        shopifyShopId,
        externalInstallationId: 'gid://shopify/AppInstallation/7',
      }),
    );
    // Bulk-insert full sessions: 100 drafts and 1,000 retained proposals each.
    await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window)
      SELECT gen_random_uuid(),${shopId},1,lpad(to_hex(n),64,'0'),clock_timestamp(),clock_timestamp()+interval '3 days',clock_timestamp()
      FROM generate_series(1,${SESSIONS}) n`.execute(db);
    await sql`INSERT INTO design_drafts(design_id,shop_id,installation_generation,session_id,version,payload,expires_at)
      SELECT gen_random_uuid(),b.shop_id,1,b.session_id,1,'{}'::jsonb,b.expires_at FROM buyer_sessions b, generate_series(1,100) WHERE b.shop_id=${shopId}`.execute(
      db,
    );
    await sql`INSERT INTO quote_proposals(proposal_id,shop_id,installation_generation,session_id,request_digest,material_hash,desired_request,candidate,created_at,expires_at,retain_private_until)
      SELECT gen_random_uuid(),b.shop_id,1,b.session_id,repeat('d',64),repeat('e',64),'{}'::jsonb,'{}'::jsonb,
        now(),now()+interval '5 minutes',b.expires_at FROM buyer_sessions b, generate_series(1,1000) WHERE b.shop_id=${shopId}`.execute(
      db,
    );
    const receive = async (topic: string, body: object) =>
      (
        await createShopifyWebhookRepository(db).receive({
          shopDomain,
          topic,
          apiVersion: '2026-07',
          deliveryId: randomUUID(),
          triggeredAt: new Date(),
          eventId: null,
          name: null,
          rawBody: Buffer.from(JSON.stringify(body)),
        })
      ).id;
    return { shopId, shopDomain, shopifyShopId, receive };
  }
  const remaining = async (shopId: string) =>
    Number(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_sessions WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    );
  const rowsLeft = async (shopId: string) =>
    Number(
      (
        await sql<{
          n: string;
        }>`SELECT ((SELECT count(*) FROM design_drafts WHERE shop_id=${shopId})+(SELECT count(*) FROM quote_proposals WHERE shop_id=${shopId}))::text n`.execute(
          db,
        )
      ).rows[0]?.n,
    );
  const statements = async (shopId: string) =>
    (
      await sql<{ erased: number }>`SELECT erased FROM test_session_delete_audit WHERE shop_id=${shopId}`.execute(db)
    ).rows.map((r) => r.erased);
  /** The worker's own pass; it spends its budget in statements of at most `bound` sessions. */
  const sweep = () => createBuyerRepository(db).cleanupDue(100);

  it('shop erasure never deletes sessions in one statement; the bounded sweep then removes every one', async () => {
    const f = await shopWithFullSessions();
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${f.shopId}`.execute(
      db,
    );
    const privacy = await f.receive('shop/redact', { shop_id: f.shopifyShopId, shop_domain: f.shopDomain });
    expect(await createCustomerPrivacyRepository(db).processInbox(privacy)).toMatchObject({
      kind: 'SHOP_ERASURE_STAGED',
    });
    // Staging records the fence; it must not touch the sessions' ~50,000 rows in its own statement.
    expect(Math.max(0, ...(await statements(f.shopId)))).toBeLessThanOrEqual(bound);
    // Fenced: the erased generation cannot take private data again, whatever happens to the sessions.
    const someSession = (
      await sql<{
        session_id: string;
      }>`SELECT session_id FROM buyer_sessions WHERE shop_id=${f.shopId} LIMIT 1`.execute(db)
    ).rows[0];
    if (someSession)
      await expect(
        sql`INSERT INTO design_drafts VALUES(${randomUUID()}::uuid,${f.shopId},1,${someSession.session_id}::uuid,1,'{}'::jsonb,clock_timestamp()+interval '1 hour')`.execute(
          db,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    // Drain: each pass is bounded; stop as soon as this shop is clear.
    for (let pass = 0; pass < 20 && (await remaining(f.shopId)); pass++) await sweep();
    expect(await remaining(f.shopId)).toBe(0);
    expect(await rowsLeft(f.shopId)).toBe(0);
    const sizes = await statements(f.shopId);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(SESSIONS);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(bound);
    expect(sizes.length).toBeGreaterThanOrEqual(SESSIONS / bound);
    // Idempotent: processing again and sweeping again changes nothing and fails nothing.
    expect(await createCustomerPrivacyRepository(db).processInbox(privacy)).toMatchObject({
      kind: 'SHOP_ERASURE_STAGED',
    });
    await sweep();
    expect(await remaining(f.shopId)).toBe(0);
  }, 120_000);

  it('resumes after an interruption between batches: the remainder stays fenced and the next pass finishes it', async () => {
    const f = await shopWithFullSessions();
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${f.shopId}`.execute(
      db,
    );
    const privacy = await f.receive('shop/redact', { shop_id: f.shopifyShopId, shop_domain: f.shopDomain });
    await createCustomerPrivacyRepository(db).processInbox(privacy);
    // Simulate a crash after exactly one bounded statement: only that statement committed.
    const before = await remaining(f.shopId);
    await sql`SELECT public.cleanup_buyer_payloads(${bound})`.execute(db);
    const afterOne = await remaining(f.shopId);
    expect(before - afterOne).toBeLessThanOrEqual(bound);
    expect(afterOne).toBeGreaterThan(0);
    // The session of an erased generation can neither be created nor used meanwhile.
    await expect(
      createBuyerRepository(db).issueSession({
        scope: { shopId: f.shopId, installationGeneration: '1', ownerHash: 'f'.repeat(64) },
        sessionId: randomUUID(),
        now: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (let pass = 0; pass < 20 && (await remaining(f.shopId)); pass++) await sweep();
    expect(await remaining(f.shopId)).toBe(0);
    expect(Math.max(...(await statements(f.shopId)))).toBeLessThanOrEqual(bound);
  }, 120_000);

  it('uninstall recovery of a generation is bounded the same way, without touching the reinstalled generation', async () => {
    const f = await shopWithFullSessions();
    const privacy = await f.receive('shop/redact', { shop_id: f.shopifyShopId, shop_domain: f.shopDomain });
    // Active at receipt: a permanent hold, so recovery is what later erases generation 1.
    expect(await createCustomerPrivacyRepository(db).processInbox(privacy)).toMatchObject({
      kind: 'SHOP_ERASURE_BLOCKED',
    });
    const uninstall = await f.receive('app/uninstalled', { id: f.shopifyShopId, myshopify_domain: f.shopDomain });
    const digest = randomBytes(32).toString('hex');
    await sql`INSERT INTO uninstall_destinations(capability_digest,shop_id,installation_generation,external_installation_id,state) VALUES(${digest},${f.shopId},1,'gid://shopify/AppInstallation/7','prepared')`.execute(
      db,
    );
    await sql`UPDATE uninstall_destinations SET state='dispatched',dispatched_at=clock_timestamp() WHERE capability_digest=${digest}`.execute(
      db,
    );
    await sql`INSERT INTO uninstall_delivery_authority(inbox_id,capability_digest) VALUES(${uninstall}::uuid,${digest})`.execute(
      db,
    );
    await db.transaction().execute((tx) => createTenantRepository(tx).deactivateCurrent(tx, f.shopId, '1'));
    await db.transaction().execute((tx) => createTenantRepository(tx).startInstallation(tx, f.shopId));
    const fresh = randomUUID();
    await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window) VALUES(${fresh}::uuid,${f.shopId},2,${'a'.repeat(64)},clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())`.execute(
      db,
    );
    await createUninstallPrivacyRepository(db).recover(privacy, uninstall);
    expect(Math.max(0, ...(await statements(f.shopId)))).toBeLessThanOrEqual(bound);
    for (let pass = 0; pass < 20 && (await remaining(f.shopId)) > 1; pass++) await sweep();
    expect(
      (await sql<{ session_id: string }>`SELECT session_id FROM buyer_sessions WHERE shop_id=${f.shopId}`.execute(db))
        .rows,
    ).toEqual([{ session_id: fresh }]);
    expect(Math.max(...(await statements(f.shopId)))).toBeLessThanOrEqual(bound);
    expect(await rowsLeft(f.shopId)).toBe(0);
  }, 120_000);
});
