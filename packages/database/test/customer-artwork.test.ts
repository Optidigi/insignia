import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectDatabaseSnapshot } from '../../../scripts/operations/heartbeat-snapshot.mts';
import { createDurableCore } from '../src/index.js';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createCustomerArtworkRepository } from '../src/repositories/customer-artwork.js';
import { createMerchantPreferencesRepository } from '../src/repositories/merchant-preferences.js';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import { openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('customer purchase artwork authority', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  async function fixture(subset = false) {
    const base = await purchaseFixture(db);
    const purchaseId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const scope = { kind: 'merchant' as const, shopId: base.shopId, installationGeneration: base.generation };
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES(${purchaseId}::uuid,${base.shopId},${base.generation}::bigint,${`gid://shopify/Order/${BigInt(`0x${purchaseId.replaceAll('-', '').slice(0, 12)}`)}`},clock_timestamp(),'USD',2001)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_bindings(shop_id,installation_generation,purchase_id,quote_id,set_id,economics) VALUES(${base.shopId},${base.generation}::bigint,${purchaseId}::uuid,${base.quote.quoteId}::uuid,${base.authorization.setId}::uuid,${subset ? JSON.stringify({ economics: base.quote.economics }) : '{}'}::jsonb)`.execute(
      db,
    );
    // Subset: two signed designs, only design 1 (economics line 1) ordered.
    if (subset)
      await sql`INSERT INTO purchase_lines VALUES(${base.shopId},${base.generation}::bigint,${purchaseId}::uuid,${base.authorization.setId}::uuid,'gid://shopify/LineItem/56',1,${base.productId},'2',4,1000)`.execute(
        db,
      );
    const subsetGroups = ['front', 'back'].map((placementId, index) => ({
      group: {
        productId: base.productId,
        configRevisionId: base.revisionId,
        variants: [{ variantId: String(index + 1), quantity: 1 }],
        design: {
          placements: [
            { placementId, methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: placementId } },
          ],
        },
      },
    }));
    const payload = {
      version: 'm8-purchase-design-v1',
      collectedAt: new Date().toISOString(),
      revisions: [],
      request: {
        groups: subset
          ? subsetGroups
          : [
              {
                group: {
                  productId: base.productId,
                  configRevisionId: base.revisionId,
                  design: {
                    placements: [
                      {
                        placementId: 'front',
                        methodId: 'print',
                        stepId: 'small',
                        artwork: { kind: 'deferred', intentId: 'later' },
                      },
                    ],
                  },
                },
              },
            ],
      },
    };
    await sql`INSERT INTO purchase_design_payloads(shop_id,installation_generation,purchase_id,set_id,collected_at,expires_at,payload) VALUES(${base.shopId},${base.generation}::bigint,${purchaseId}::uuid,${base.authorization.setId}::uuid,clock_timestamp(),${expiresAt},${JSON.stringify(payload)}::jsonb)`.execute(
      db,
    );
    const repo = createCustomerArtworkRepository(db);
    const hash = 'a'.repeat(64);
    const request = { purchaseId, requestId: randomUUID(), purpose: 'merchant' as const, capabilityHash: hash };
    // Every fixture has a distinct capability, even when concurrent suites use the same database.
    request.capabilityHash = purchaseId.replaceAll('-', '').repeat(2);
    return { ...base, scope, purchaseId, expiresAt, repo, request };
  }
  async function artwork(shopId: string, ownerHash: string) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const store = createArtworkRepository(pool);
      const assetId = randomUUID(),
        claimId = randomUUID(),
        now = new Date();
      await store.create({
        assetId,
        shopId,
        installationGeneration: '1',
        ownerHash,
        ownerKind: 'guest',
        declaredMime: 'image/png',
        declaredBytes: 10,
        state: 'UPLOADING',
        quarantineKey: `q/${assetId}`,
        originalKey: `o/${assetId}`,
        previewKey: `p/${assetId}`,
        collectedAt: now,
        uploadUntil: new Date(+now + 300000),
        expiresAt: new Date(+now + 604800000),
        claimId: null,
        manifest: null,
        rejection: null,
      });
      await store.complete({ kind: 'guest', shopId, installationGeneration: '1', ownerHash }, assetId, now);
      await store.claim(assetId, claimId, now, new Date(+now + 60000));
      await store.prepare(
        assetId,
        claimId,
        {
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          byteLength: 10,
          sha256: '1'.repeat(64),
          width: 1,
          height: 1,
          previewSha256: '2'.repeat(64),
          previewByteLength: 10,
        },
        now,
      );
      await store.settle(assetId, claimId, now);
      return assetId;
    } finally {
      await pool.end();
    }
  }
  it('customer links ask only for artwork of ordered designs, at their signed index', async () => {
    const f = await fixture(true);
    const issued = await f.repo.issue(f.scope, f.request);
    expect(issued?.slots.map((slot) => [slot.groupIndex, slot.placementId])).toEqual([[1, 'back']]);
  });
  it('allows merchant links before payment, caps expiry and replays issuance without extending authority', async () => {
    const f = await fixture();
    const first = await f.repo.issue(f.scope, f.request);
    expect(first?.slots.map((slot) => slot.placementId)).toEqual(['front']);
    // The link lasts as long as the recorded order's design: six months from collection, not the 7-day draft.
    const design = (
      await sql<{
        expires_at: Date;
      }>`SELECT expires_at FROM purchase_design_payloads WHERE purchase_id=${f.purchaseId}::uuid`.execute(db)
    ).rows[0];
    expect(first?.expiresAt).toBe(design?.expires_at.toISOString());
    expect(+design!.expires_at).toBeGreaterThan(+f.expiresAt + 150 * 86400000);
    expect(await f.repo.issue(f.scope, f.request)).toEqual(first);
    expect(await f.repo.issue(f.scope, { ...f.request, requestId: randomUUID(), purpose: 'paid-email' })).toBeNull();
    await expect(f.repo.issue({ ...f.scope, shopId: randomUUID() }, f.request)).rejects.toThrow(
      'CUSTOMER_ARTWORK_UNAVAILABLE',
    );
  });
  it('atomically accepts one first fill and rejects replacement, cross-grant assets and stale concurrent first fills', async () => {
    const f = await fixture();
    await f.repo.issue(f.scope, f.request);
    const assetId = await artwork(f.shopId, f.request.capabilityHash);
    const wrong = await artwork(f.shopId, 'b'.repeat(64));
    const command = {
      groupIndex: 0,
      placementId: 'front',
      expectedVersion: 0,
      assetId: wrong,
      requestId: randomUUID(),
    };
    await expect(f.repo.attach(f.request.capabilityHash, command)).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
    const first = { ...command, assetId, requestId: randomUUID() };
    const second = { ...first, requestId: randomUUID() };
    const attempts = await Promise.allSettled([
      f.repo.attach(f.request.capabilityHash, first),
      f.repo.attach(f.request.capabilityHash, second),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect((await f.repo.resolve(f.request.capabilityHash))?.slots).toEqual([]);
    await expect(
      f.repo.attach(f.request.capabilityHash, { ...first, expectedVersion: 1, requestId: randomUUID() }),
    ).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
    const purchase = await createPurchaseRepository(db).get(f.scope, f.purchaseId);
    expect(purchase?.originalTotalMinor).toBe('2001');
    expect(purchase?.artworkEvents).toHaveLength(1);
    // Artwork supplied through the link is the order's artwork: kept with the order, not 7 days.
    const kept = (
      await sql<{
        expires_at: Date;
        deadline: Date;
        unused: Date;
      }>`SELECT a.expires_at,least(public.purchased_retention_deadline(a.collected_at),p.expires_at) AS deadline,w.expires_at AS unused FROM artwork_assets a,purchase_design_payloads p,artwork_assets w WHERE a.asset_id=${assetId}::uuid AND p.purchase_id=${f.purchaseId}::uuid AND w.asset_id=${wrong}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    expect(kept.expires_at).toEqual(kept.deadline);
    expect(purchase?.artworkEvents[0]?.expiresAt).toBe(kept.expires_at.toISOString());
    expect(+kept.unused).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
  });
  it('revokes immediately, rejects expired payloads and deactivated installations without resurrecting missing work', async () => {
    const f = await fixture();
    await f.repo.issue(f.scope, f.request);
    await f.repo.revoke(f.scope, f.purchaseId);
    expect(await f.repo.resolve(f.request.capabilityHash)).toBeNull();
    await expect(f.repo.issue(f.scope, f.request)).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
    const other = await fixture();
    await other.repo.issue(other.scope, other.request);
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${other.shopId}`.execute(
      db,
    );
    await expect(other.repo.resolve(other.request.capabilityHash)).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
  });
  it('plans email exactly once on verified full payment and never reclaims an uncertain delivery', async () => {
    const f = await fixture();
    expect((await f.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === f.purchaseId)).toBe(false);
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${f.purchaseId}::uuid,${f.shopId},${f.generation}::bigint,clock_timestamp()) ON CONFLICT DO NOTHING`.execute(
      db,
    );
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${f.purchaseId}::uuid,${f.shopId},${f.generation}::bigint,clock_timestamp()) ON CONFLICT DO NOTHING`.execute(
      db,
    );
    const planned = (await f.repo.pendingNotifications(100)).filter((notice) => notice.purchaseId === f.purchaseId);
    expect(planned).toHaveLength(1);
    const notice = planned[0];
    if (!notice) throw new Error('Missing planned notification');
    await f.repo.deferNotification(notice.notificationId);
    expect((await f.repo.pendingNotifications(100)).some((row) => row.notificationId === notice.notificationId)).toBe(
      false,
    );
    const deferred = await sql<{
      state: string;
      attempts: number;
    }>`SELECT state,attempts FROM customer_artwork_notifications WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect(deferred.rows[0]).toEqual({ state: 'PENDING', attempts: 0 });
    await sql`UPDATE customer_artwork_notifications SET retry_at=clock_timestamp()-interval '1 minute' WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect((await f.repo.pendingNotifications(100)).some((row) => row.notificationId === notice.notificationId)).toBe(
      true,
    );
    const hash = notice.notificationId.replaceAll('-', '').repeat(2);
    await f.repo.issue(f.scope, {
      ...f.request,
      requestId: notice.notificationId,
      purpose: 'paid-email',
      capabilityHash: hash,
    });
    await sql`UPDATE customer_artwork_notifications SET state='NO_EFFECT',attempts=12,retry_at=clock_timestamp()-interval '1 minute' WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect((await f.repo.pendingNotifications(100)).some((row) => row.notificationId === notice.notificationId)).toBe(
      true,
    );
    expect(await f.repo.claimNotification(notice.notificationId, hash)).toBe(true);
    const retried = await sql<{
      attempts: number;
    }>`SELECT attempts FROM customer_artwork_notifications WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect(retried.rows[0]?.attempts).toBe(13);

    expect(await f.repo.claimNotification(notice.notificationId, hash)).toBe(false);
    await f.repo.settleNotification(notice.notificationId, 'NO_EFFECT');
    expect(await f.repo.claimNotification(notice.notificationId, hash)).toBe(false);
    const delayed = await sql<{
      long_backoff: boolean;
    }>`SELECT retry_at>clock_timestamp()+interval '50 minutes' AS long_backoff FROM customer_artwork_notifications WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect(delayed.rows[0]?.long_backoff).toBe(true);
    await sql`UPDATE customer_artwork_notifications SET retry_at=clock_timestamp()-interval '1 minute' WHERE notification_id=${notice.notificationId}::uuid`.execute(
      db,
    );
    expect(await f.repo.claimNotification(notice.notificationId, hash)).toBe(true);
    await f.repo.settleNotification(notice.notificationId, 'UNCERTAIN');
    expect((await f.repo.pendingNotifications(100)).some((row) => row.notificationId === notice.notificationId)).toBe(
      false,
    );
    expect(await f.repo.claimNotification(notice.notificationId, hash)).toBe(false);
  });
  it('a store that turns customer email off settles its notices as SUPPRESSED and never sends them later', async () => {
    const f = await fixture();
    const preferences = createMerchantPreferencesRepository(db);
    const shop = 'customer-email-off.myshopify.com';
    const authority = 'c'.repeat(64);
    const fresh = await preferences.read(f.shopId, shop, authority);
    expect(fresh.notifications).toEqual({ customerArtworkEmail: true });
    expect(fresh.notificationsVersion).toBe('0');
    const pay = (purchaseId: string) =>
      sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${purchaseId}::uuid,${f.shopId},${f.generation}::bigint,clock_timestamp()) ON CONFLICT DO NOTHING`.execute(
        db,
      );
    const state = async (notificationId: string) =>
      (
        await sql<{
          state: string;
          settled: boolean;
          attempts: number;
        }>`SELECT state,settled_at IS NOT NULL AS settled,attempts FROM customer_artwork_notifications WHERE notification_id=${notificationId}::uuid`.execute(
          db,
        )
      ).rows[0];
    await pay(f.purchaseId);
    const listed = (await f.repo.pendingNotifications(100)).find((notice) => notice.purchaseId === f.purchaseId);
    if (!listed) throw new Error('Missing planned notification');
    // The merchant turns it off after the notice was selected but before it is claimed: the claim is fenced.
    const off = await preferences.save(f.shopId, shop, {
      action: 'notifications',
      authority,
      expectedVersion: '0',
      notifications: { customerArtworkEmail: false },
    });
    expect(off?.notifications).toEqual({ customerArtworkEmail: false });
    expect(off?.notificationsVersion).toBe('1');
    expect(off?.guidanceVersion).toBe('0');
    const hash = listed.notificationId.replaceAll('-', '').repeat(2);
    await f.repo.issue(f.scope, {
      ...f.request,
      requestId: listed.notificationId,
      purpose: 'paid-email',
      capabilityHash: hash,
    });
    expect(await f.repo.claimNotification(listed.notificationId, hash)).toBe(false);
    expect(await state(listed.notificationId)).toEqual({ state: 'SUPPRESSED', settled: true, attempts: 0 });
    // A stale version does not overwrite the choice.
    expect(
      await preferences.save(f.shopId, shop, {
        action: 'notifications',
        authority,
        expectedVersion: '0',
        notifications: { customerArtworkEmail: true },
      }),
    ).toBeNull();
    // A notice planned while it is off (another store, turned off before payment) is settled at the next scan.
    const later = await fixture();
    expect(
      (
        await preferences.save(later.shopId, 'customer-email-later.myshopify.com', {
          action: 'notifications',
          authority,
          expectedVersion: '0',
          notifications: { customerArtworkEmail: false },
        })
      )?.notifications,
    ).toEqual({ customerArtworkEmail: false });
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${later.purchaseId}::uuid,${later.shopId},${later.generation}::bigint,clock_timestamp())`.execute(
      db,
    );
    const planned = (
      await sql<{
        notification_id: string;
      }>`SELECT notification_id::text FROM customer_artwork_notifications WHERE purchase_id=${later.purchaseId}::uuid`.execute(
        db,
      )
    ).rows[0];
    if (!planned) throw new Error('Missing notice planned while off');
    expect((await later.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === later.purchaseId)).toBe(
      false,
    );
    expect(await state(planned.notification_id)).toEqual({ state: 'SUPPRESSED', settled: true, attempts: 0 });
    const second = await fixture();
    // Turning it back on does not revive suppressed notices; another store was never affected.
    const on = await preferences.save(f.shopId, shop, {
      action: 'notifications',
      authority,
      expectedVersion: '1',
      notifications: { customerArtworkEmail: true },
    });
    expect(on?.notifications).toEqual({ customerArtworkEmail: true });
    expect((await f.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === f.purchaseId)).toBe(false);
    expect(await state(listed.notificationId)).toEqual({ state: 'SUPPRESSED', settled: true, attempts: 0 });
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${second.purchaseId}::uuid,${second.shopId},${second.generation}::bigint,clock_timestamp())`.execute(
      db,
    );
    expect(
      (await second.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === second.purchaseId),
    ).toBe(true);
  });
  it('does not plan missing-artwork email when the customer already filled every slot before payment', async () => {
    const f = await fixture();
    await f.repo.issue(f.scope, f.request);
    const assetId = await artwork(f.shopId, f.request.capabilityHash);
    await f.repo.attach(f.request.capabilityHash, {
      groupIndex: 0,
      placementId: 'front',
      expectedVersion: 0,
      assetId,
      requestId: randomUUID(),
    });
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${f.purchaseId}::uuid,${f.shopId},${f.generation}::bigint,clock_timestamp())`.execute(
      db,
    );
    expect((await f.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === f.purchaseId)).toBe(false);
  });

  it('original design erasure deletes customer authority without deleting purchase economics', async () => {
    const f = await fixture();
    await f.repo.issue(f.scope, f.request);
    await sql`INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES(${f.purchaseId}::uuid,${f.shopId},${f.generation}::bigint,clock_timestamp())`.execute(
      db,
    );
    await sql`UPDATE purchase_design_payloads SET payload=NULL,erased_at=clock_timestamp() WHERE purchase_id=${f.purchaseId}::uuid`.execute(
      db,
    );
    expect(await f.repo.resolve(f.request.capabilityHash)).toBeNull();
    expect((await f.repo.pendingNotifications(100)).some((notice) => notice.purchaseId === f.purchaseId)).toBe(false);
    const retained = await createPurchaseRepository(db).get(f.scope, f.purchaseId);
    expect(retained?.originalTotalMinor).toBe('2001');
    expect(retained?.artworkState).toBe('ERASED');
    await expect(f.repo.issue(f.scope, { ...f.request, requestId: randomUUID() })).rejects.toThrow(
      'CUSTOMER_ARTWORK_UNAVAILABLE',
    );
  });
  it('real restricted web grants issue/revoke scoped links but cannot rewrite link identity, slots or restore epoch', async () => {
    const f = await fixture();
    const role = `customer_web_${randomUUID().replaceAll('-', '')}`;
    const password = `synthetic-${randomUUID()}`;
    const owner = new Pool({ connectionString: process.env.DATABASE_URL });
    let runtime: ReturnType<typeof createDurableCore> | undefined;
    try {
      await owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await owner.query(
        `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON public.shops,public.installation_generations TO ${role}; GRANT UPDATE(updated_at) ON public.shops TO ${role}; GRANT UPDATE(deactivated_at) ON public.installation_generations TO ${role}`,
      );
      const script = await readFile(
        new URL('../../../deployment/m8-journey/web-runtime-grants.sql', import.meta.url),
        'utf8',
      );
      const grants = script.match(/GRANT[\s\S]*?TO insignia_runtime;/g) ?? [];
      expect(grants.length).toBeGreaterThan(10);
      for (const grant of grants) await owner.query(grant.replaceAll('insignia_runtime', role));
      const address = new URL(process.env.DATABASE_URL ?? '');
      address.username = role;
      address.password = password;
      const pool = new Pool({ connectionString: address.href });
      runtime = createDurableCore(pool);
      expect((await runtime.customerArtwork.issue(f.scope, f.request))?.purchaseId).toBe(f.purchaseId);
      expect(await runtime.customerArtwork.epoch()).toMatch(/^[a-f0-9-]{36}$/);
      await owner.query(
        'INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES($1,$2,$3,clock_timestamp())',
        [f.purchaseId, f.shopId, f.generation],
      );
      const notice = (await runtime.customerArtwork.pendingNotifications(100)).find(
        (row) => row.purchaseId === f.purchaseId,
      );
      if (!notice) throw new Error('Missing restricted-role notice');
      await runtime.customerArtwork.deferNotification(notice.notificationId);
      expect(
        (await runtime.customerArtwork.pendingNotifications(100)).some(
          (row) => row.notificationId === notice.notificationId,
        ),
      ).toBe(false);
      await owner.query(
        "UPDATE customer_artwork_notifications SET retry_at=clock_timestamp()-interval '1 minute' WHERE notification_id=$1",
        [notice.notificationId],
      );
      const deliveryHash = notice.notificationId.replaceAll('-', '').repeat(2);
      await runtime.customerArtwork.issue(f.scope, {
        purchaseId: f.purchaseId,
        requestId: notice.notificationId,
        purpose: 'paid-email',
        capabilityHash: deliveryHash,
      });
      expect(await runtime.customerArtwork.claimNotification(notice.notificationId, deliveryHash)).toBe(true);
      expect(await runtime.customerArtwork.claimNotification(notice.notificationId, deliveryHash)).toBe(false);
      await runtime.customerArtwork.settleNotification(notice.notificationId, 'UNCERTAIN');
      expect(
        (await runtime.customerArtwork.pendingNotifications(100)).some(
          (row) => row.notificationId === notice.notificationId,
        ),
      ).toBe(false);
      // The web role alone can turn the store's customer email off and settle a waiting notice (#D7).
      const core = runtime;
      const later = await fixture();
      await owner.query(
        'INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES($1,$2,$3,clock_timestamp())',
        [later.purchaseId, later.shopId, later.generation],
      );
      const waiting = (await core.customerArtwork.pendingNotifications(100)).find(
        (row) => row.purchaseId === later.purchaseId,
      );
      if (!waiting) throw new Error('Missing restricted-role notice for the email setting');
      const saved = await core.transactions.run((tx) =>
        core.preferences.save(tx, later.shopId, 'restricted-email.myshopify.com', {
          action: 'notifications',
          authority: 'd'.repeat(64),
          expectedVersion: '0',
          notifications: { customerArtworkEmail: false },
        }),
      );
      expect(saved?.notifications).toEqual({ customerArtworkEmail: false });
      const waitingHash = waiting.notificationId.replaceAll('-', '').repeat(2);
      await core.customerArtwork.issue(later.scope, {
        purchaseId: later.purchaseId,
        requestId: waiting.notificationId,
        purpose: 'paid-email',
        capabilityHash: waitingHash,
      });
      expect(await core.customerArtwork.claimNotification(waiting.notificationId, waitingHash)).toBe(false);
      expect(
        (
          await owner.query('SELECT state FROM customer_artwork_notifications WHERE notification_id=$1', [
            waiting.notificationId,
          ])
        ).rows[0],
      ).toEqual({ state: 'SUPPRESSED' });

      for (const query of [
        "UPDATE customer_artwork_grants SET slots='[]'::jsonb",
        "UPDATE customer_artwork_grants SET capability_hash=repeat('b',64)",
        'UPDATE customer_artwork_epoch SET value=gen_random_uuid()',
        'DELETE FROM merchant_preferences',
        'DELETE FROM purchase_order_labels',
      ])
        await expect(pool.query(query)).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await pool.query(
            "SELECT has_table_privilege(current_user,'merchant_preferences','SELECT,INSERT,UPDATE') AS preferences,has_table_privilege(current_user,'purchase_order_labels','SELECT,INSERT,UPDATE') AS labels",
          )
        ).rows[0],
      ).toEqual({ preferences: true, labels: true });
      await runtime.customerArtwork.revoke(f.scope, f.purchaseId);
      expect(await runtime.customerArtwork.resolve(f.request.capabilityHash)).toBeNull();
    } finally {
      await runtime?.close();
      await owner.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
      await owner.end();
    }
  });
  it('expired prior attachment does not become a new customer missing-artwork request before cleanup', async () => {
    const f = await fixture();
    const assetId = await artwork(f.shopId, f.request.capabilityHash);
    await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) VALUES(${randomUUID()}::uuid,${f.shopId},${f.generation}::bigint,${f.purchaseId}::uuid,1,'ATTACH',0,'front',${assetId}::uuid,clock_timestamp()-interval '1 minute')`.execute(
      db,
    );
    await expect(f.repo.issue(f.scope, f.request)).rejects.toThrow('CUSTOMER_ARTWORK_UNAVAILABLE');
  });

  it('actual restricted monitor grants expose stalled delivery and expired authority counts without capability payloads', async () => {
    const f = await fixture();
    await f.repo.issue(f.scope, f.request);
    const role = `customer_monitor_${randomUUID().replaceAll('-', '')}`;
    const password = `synthetic-${randomUUID()}`;
    const owner = new Pool({ connectionString: process.env.DATABASE_URL });
    let monitor: Pool | undefined;
    try {
      await owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      const script = await readFile(new URL('../../../deployment/alerts/monitor-grants.sql', import.meta.url), 'utf8');
      await owner.query(script.replaceAll(':"monitor_role"', role));
      const address = new URL(process.env.DATABASE_URL ?? '');
      address.username = role;
      address.password = password;
      monitor = new Pool({ connectionString: address.href });
      const before = await collectDatabaseSnapshot(monitor);
      await owner.query(
        'INSERT INTO purchase_paid_facts(purchase_id,shop_id,installation_generation,occurred_at) VALUES($1,$2,$3,clock_timestamp())',
        [f.purchaseId, f.shopId, f.generation],
      );
      await owner.query("UPDATE customer_artwork_notifications SET state='UNCERTAIN' WHERE purchase_id=$1", [
        f.purchaseId,
      ]);
      await owner.query(
        "UPDATE customer_artwork_grants SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE purchase_id=$1",
        [f.purchaseId],
      );
      const after = await collectDatabaseSnapshot(monitor);
      expect(after.processing.stalledCount).toBe(before.processing.stalledCount + 1);
      expect(after.deletion.overdueCount).toBe(before.deletion.overdueCount + 1);
      for (const query of [
        'SELECT capability_hash FROM customer_artwork_grants',
        'SELECT slots FROM customer_artwork_grants',
        'SELECT provider_receipt FROM customer_artwork_notifications',
        "UPDATE customer_artwork_notifications SET state='PENDING'",
      ])
        await expect(monitor.query(query)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await monitor?.end();
      await owner.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
      await owner.end();
    }
  });
});
