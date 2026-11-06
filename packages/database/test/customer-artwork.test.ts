import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectDatabaseSnapshot } from '../../../scripts/operations/heartbeat-snapshot.mts';
import { createDurableCore } from '../src/index.js';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createCustomerArtworkRepository } from '../src/repositories/customer-artwork.js';
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
  async function fixture() {
    const base = await purchaseFixture(db);
    const purchaseId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const scope = { kind: 'merchant' as const, shopId: base.shopId, installationGeneration: base.generation };
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES(${purchaseId}::uuid,${base.shopId},${base.generation}::bigint,${`gid://shopify/Order/${BigInt(`0x${purchaseId.replaceAll('-', '').slice(0, 12)}`)}`},clock_timestamp(),'USD',2001)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_bindings(shop_id,installation_generation,purchase_id,quote_id,set_id,economics) VALUES(${base.shopId},${base.generation}::bigint,${purchaseId}::uuid,${base.quote.quoteId}::uuid,${base.authorization.setId}::uuid,'{}'::jsonb)`.execute(
      db,
    );
    const payload = {
      version: 'm8-purchase-design-v1',
      collectedAt: new Date().toISOString(),
      revisions: [],
      request: {
        groups: [
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
  it('allows merchant links before payment, caps expiry and replays issuance without extending authority', async () => {
    const f = await fixture();
    const first = await f.repo.issue(f.scope, f.request);
    expect(first?.slots.map((slot) => slot.placementId)).toEqual(['front']);
    expect(first?.expiresAt).toBe(f.expiresAt.toISOString());
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
