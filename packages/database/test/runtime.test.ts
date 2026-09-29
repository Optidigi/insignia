import { createHash, randomUUID } from 'node:crypto';
import { newOutboxEvent } from '@insignia/application';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CredentialAuthenticationError,
  createDurableCore,
  MissingCredentialKeyError,
  ShopifyDeliveryConflictError,
} from '../src/index.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

const connectionString = process.env.DATABASE_URL;
const keys = { currentKeyId: 'synthetic-k1', keys: { 'synthetic-k1': Buffer.alloc(32, 41) } };
function signedShopId(domain: string): string {
  return (BigInt(`0x${createHash('sha256').update(domain).digest('hex').slice(0, 12)}`) + 1n).toString();
}

function delivery(domain: string, id = randomUUID(), topic = 'products/update') {
  return {
    shopDomain: domain,
    deliveryId: id,
    topic,
    apiVersion: '2026-07',
    triggeredAt: new Date(),
    eventId: randomUUID(),
    name: null,
    rawBody: Buffer.from(
      JSON.stringify(
        topic === 'app/uninstalled' ? { id: Number(signedShopId(domain)), myshopify_domain: domain } : { id, topic },
      ),
    ),
  };
}

function pair(accessToken: string, refreshToken: string, accessMs = 60_000) {
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(Date.now() + accessMs),
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
    scopes: 'read_products',
  };
}

describe('M3-002 PostgreSQL 18 runtime invariants', () => {
  it('exposes provider shop identity only for the exact active installation generation', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const shopifyShopId = signedShopId(domain);
    try {
      await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId }));
      expect(await core.tenants.getActiveProviderScope({ shopId, installationGeneration: '1' })).toEqual({
        shopId,
        shopDomain: domain,
        shopifyShopId,
        installationGeneration: '1',
      });
      expect(
        await core.tenants.getActiveProviderScope({ shopId: randomUUID(), installationGeneration: '1' }),
      ).toBeNull();
      expect(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId))).toBe('2');
      expect(await core.tenants.getActiveProviderScope({ shopId, installationGeneration: '1' })).toBeNull();
      expect(await core.tenants.getActiveProviderScope({ shopId, installationGeneration: '2' })).toMatchObject({
        shopifyShopId,
        installationGeneration: '2',
      });
      await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, shopId, '2'));
      expect(await core.tenants.getActiveProviderScope({ shopId, installationGeneration: '2' })).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });
  it('keeps a Shopify delivery identity stable across preinstall resolution and concurrent replay', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const peer = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const input = delivery(domain);
    try {
      const first = await core.webhooks.receive(input);
      expect(first).toMatchObject({ kind: 'received', shopId: null, installationGeneration: null });
      expect(await core.webhooks.unresolvedBacklogCount()).toBeGreaterThanOrEqual(1);
      expect(await core.webhooks.receive(input)).toMatchObject({ kind: 'duplicate', id: first.id, shopId: null });
      const installation = core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain }));
      const racing = Promise.all(Array.from({ length: 8 }, () => peer.webhooks.receive(input)));
      await installation;
      const replays = await racing;
      const finalReplay = await core.webhooks.receive(input);
      expect(finalReplay).toMatchObject({ id: first.id, shopId, installationGeneration: '1' });
      expect((await core.webhooks.getById(first.id))?.resolution).toBe('resolved');
      expect(replays.every((item) => item.id === first.id)).toBe(true);
      const rows = await database
        .selectFrom('inbox_messages')
        .select(['id', 'shop_id', 'installation_generation'])
        .where('source', '=', 'shopify')
        .where('external_delivery_id', '=', `${domain}:${input.deliveryId}`)
        .execute();
      expect(rows).toEqual([{ id: first.id, shop_id: shopId, installation_generation: '1' }]);
      expect((await core.webhooks.getById(first.id))?.resolution).toBe('resolved');
      await expect(core.webhooks.receive({ ...input, rawBody: Buffer.from('different') })).rejects.toBeInstanceOf(
        ShopifyDeliveryConflictError,
      );
      expect(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId))).toBe('2');
      const oldReplay = await core.webhooks.receive(input);
      expect(oldReplay.id).toBe(first.id);
      expect(oldReplay.installationGeneration).toBe('1');
      expect((await core.webhooks.getById(first.id))?.resolution).toBe('stale');
    } finally {
      await Promise.all([core.close(), peer.close(), database.destroy()]);
    }
  });

  it('encrypts complete expiring pairs and serializes refresh claims across connections', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const other = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain }));
      await core.credentials.install({
        shopId,
        installationGeneration: '1',
        pair: pair('synthetic-access-old', 'synthetic-refresh-old', 20_000),
      });
      const raw = await database
        .selectFrom('shop_credentials')
        .selectAll()
        .where('shop_id', '=', shopId)
        .executeTakeFirstOrThrow();
      const serialized = JSON.stringify(raw);
      expect(serialized).not.toContain('synthetic-access-old');
      expect(serialized).not.toContain('synthetic-refresh-old');
      const [a, b] = await Promise.all([
        core.credentials.acquire({
          shopId,
          installationGeneration: '1',
          minimumRemainingMs: 30_000,
          claimLeaseMs: 30_000,
        }),
        other.credentials.acquire({
          shopId,
          installationGeneration: '1',
          minimumRemainingMs: 30_000,
          claimLeaseMs: 30_000,
        }),
      ]);
      const claimed = a.kind === 'claimed' ? a : b.kind === 'claimed' ? b : null;
      expect(claimed?.kind).toBe('claimed');
      expect([a.kind, b.kind].sort()).toEqual(['busy', 'claimed']);
      if (!claimed) throw new Error('claim missing');
      expect(claimed.refreshToken).toBe('synthetic-refresh-old');
      const replacement = pair('synthetic-access-new', 'synthetic-refresh-new');
      expect(
        await core.credentials.replaceClaim({
          shopId,
          installationGeneration: '1',
          claimId: claimed.claimId,
          credentialVersion: claimed.credentialVersion,
          pair: replacement,
        }),
      ).toBe('replaced');
      expect(
        await other.credentials.replaceClaim({
          shopId,
          installationGeneration: '1',
          claimId: claimed.claimId,
          credentialVersion: claimed.credentialVersion,
          pair: replacement,
        }),
      ).toBe('stale');
      expect(
        await other.credentials.acquire({
          shopId,
          installationGeneration: '1',
          minimumRemainingMs: 0,
          claimLeaseMs: 30_000,
        }),
      ).toMatchObject({ kind: 'usable', accessToken: 'synthetic-access-new' });
    } finally {
      await Promise.all([core.close(), other.close(), database.destroy()]);
    }
  });

  it('does not bind a preinstall uninstall to a later newly created first generation', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      const preinstall = delivery(domain, randomUUID(), 'app/uninstalled');
      preinstall.triggeredAt = new Date(Date.now() - 60_000);
      const received = await core.webhooks.receive(preinstall);
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      expect(await core.webhooks.pendingUninstallIds(100)).toContain(received.id);
      expect((await core.webhooks.getById(received.id))?.resolution).toBe('stale');
      expect(await core.webhooks.processUninstall(received.id)).toBe('stale');
      expect(await core.webhooks.pendingUninstallIds(100)).not.toContain(received.id);
      expect(
        (
          await database
            .selectFrom('installation_generations')
            .select('deactivated_at')
            .where('shop_id', '=', shopId)
            .executeTakeFirstOrThrow()
        ).deactivated_at,
      ).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('rejects same-ID topic, time and body conflicts and does not turn Shop-shaped updates into uninstalls', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      const input = delivery(domain, randomUUID(), 'app/uninstalled');
      const first = await core.webhooks.receive(input);
      await expect(core.webhooks.receive({ ...input, topic: 'shop/update' })).rejects.toBeInstanceOf(
        ShopifyDeliveryConflictError,
      );
      await expect(
        core.webhooks.receive({ ...input, triggeredAt: new Date(input.triggeredAt.getTime() + 1000) }),
      ).rejects.toBeInstanceOf(ShopifyDeliveryConflictError);
      await expect(
        core.webhooks.receive({ ...input, rawBody: Buffer.from('{"id":1,"myshopify_domain":null}') }),
      ).rejects.toBeInstanceOf(ShopifyDeliveryConflictError);
      expect((await core.webhooks.getById(first.id))?.state).toBe('pending');

      const update = {
        ...delivery(domain, randomUUID(), 'shop/update'),
        rawBody: input.rawBody,
      };
      const updateReceipt = await core.webhooks.receive(update);
      expect((await core.webhooks.getById(updateReceipt.id))?.topic).toBe('shop/update');
      await expect(core.webhooks.processUninstall(updateReceipt.id)).rejects.toThrow('not an uninstall');
      expect(
        (
          await database
            .selectFrom('installation_generations')
            .select('deactivated_at')
            .where('shop_id', '=', shopId)
            .executeTakeFirstOrThrow()
        ).deactivated_at,
      ).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('keeps an old uninstall stale after reinstall, including a delayed first delivery', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      const old = delivery(domain, randomUUID(), 'app/uninstalled');
      const bound = await core.webhooks.receive(old);
      expect(bound.installationGeneration).toBe('1');
      expect(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId))).toBe('2');
      expect(await core.webhooks.processUninstall(bound.id)).toBe('stale');
      const delayed = { ...delivery(domain, randomUUID(), 'app/uninstalled'), triggeredAt: old.triggeredAt };
      const lateReceipt = await core.webhooks.receive(delayed);
      expect(lateReceipt.shopId).toBeNull();
      expect(await core.webhooks.processUninstall(lateReceipt.id)).toBe('stale');
      expect((await core.webhooks.receive(old)).id).toBe(bound.id);
      expect(
        (
          await database
            .selectFrom('installation_generations')
            .select('deactivated_at')
            .where('shop_id', '=', shopId)
            .where('generation', '=', '2')
            .executeTakeFirstOrThrow()
        ).deactivated_at,
      ).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('serializes a current uninstall behind reinstall and cannot deactivate the new generation', async () => {
    const database = await openTestDatabase();
    const peer = createDurableCore(new Pool({ connectionString, application_name: 'insignia_uninstall_race' }), {
      credentialKeys: keys,
    });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await database.transaction().execute((tx) =>
        createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: domain,
          shopifyShopId: signedShopId(domain),
        }),
      );
      const receipt = await peer.webhooks.receive(delivery(domain, randomUUID(), 'app/uninstalled'));
      let pending: Promise<unknown> | undefined;
      await database.transaction().execute(async (tx) => {
        await tx
          .selectFrom('shops')
          .select('shop_id')
          .where('shop_id', '=', shopId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        pending = peer.webhooks.processUninstall(receipt.id);
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const activity = await sql<{ n: string }>`select count(*)::text as n from pg_stat_activity
            where application_name = 'insignia_uninstall_race' and wait_event_type = 'Lock'`.execute(database);
          if (Number(activity.rows[0]?.n) > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        expect(await createTenantRepository(tx).startInstallation(tx, shopId)).toBe('2');
      });
      expect(await pending).toBe('stale');
      expect(
        (
          await database
            .selectFrom('installation_generations')
            .select('deactivated_at')
            .where('shop_id', '=', shopId)
            .where('generation', '=', '2')
            .executeTakeFirstOrThrow()
        ).deactivated_at,
      ).toBeNull();
    } finally {
      await Promise.all([peer.close(), database.destroy()]);
    }
  });

  it('rolls back deactivation when inbox completion fails, then safely retries', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const trigger = `test_uninstall_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    let installed = false;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      await core.credentials.install({
        shopId,
        installationGeneration: '1',
        pair: pair('synthetic-rollback-access', 'synthetic-rollback-refresh'),
      });
      const receipt = await core.webhooks.receive(delivery(domain, randomUUID(), 'app/uninstalled'));
      await sql
        .raw(
          `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic inbox failure'; END; $$`,
        )
        .execute(database);
      await sql
        .raw(
          `CREATE TRIGGER ${trigger} BEFORE UPDATE ON inbox_messages FOR EACH ROW WHEN (NEW.id = '${receipt.id}'::uuid AND NEW.state = 'processed') EXECUTE FUNCTION ${trigger}()`,
        )
        .execute(database);
      installed = true;
      await expect(core.webhooks.processUninstall(receipt.id)).rejects.toThrow('synthetic inbox failure');
      expect((await core.webhooks.getById(receipt.id))?.state).toBe('pending');
      expect(
        (
          await database
            .selectFrom('installation_generations')
            .select('deactivated_at')
            .where('shop_id', '=', shopId)
            .where('generation', '=', '1')
            .executeTakeFirstOrThrow()
        ).deactivated_at,
      ).toBeNull();
      expect(
        (
          await core.credentials.acquire({
            shopId,
            installationGeneration: '1',
            minimumRemainingMs: 0,
            claimLeaseMs: 30_000,
          })
        ).kind,
      ).toBe('usable');
      await sql.raw(`DROP TRIGGER ${trigger} ON inbox_messages`).execute(database);
      await sql.raw(`DROP FUNCTION ${trigger}()`).execute(database);
      installed = false;
      expect(await core.webhooks.processUninstall(receipt.id)).toBe('processed');
    } finally {
      if (installed) {
        await sql.raw(`DROP TRIGGER ${trigger} ON inbox_messages`).execute(database);
        await sql.raw(`DROP FUNCTION ${trigger}()`).execute(database);
      }
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('requires signed Shopify Shop identity before uninstall can fence an installation', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const otherDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      const mismatched = delivery(domain, randomUUID(), 'app/uninstalled');
      mismatched.rawBody = Buffer.from(JSON.stringify({ id: 999999999, myshopify_domain: domain }));
      const received = await core.webhooks.receive(mismatched);
      expect(received.shopId).toBeNull();
      expect((await core.webhooks.getById(received.id))?.resolution).toBe('unverified');
      expect(await core.webhooks.processUninstall(received.id)).toBe('unverified');
      expect((await core.webhooks.getById(received.id))?.state).toBe('failed');
      expect(await core.webhooks.pendingUninstallIds(100)).not.toContain(received.id);
      const domainMismatch = delivery(domain, randomUUID(), 'app/uninstalled');
      domainMismatch.rawBody = Buffer.from(
        JSON.stringify({ id: Number(signedShopId(domain)), myshopify_domain: otherDomain }),
      );
      const mismatchedDomainReceipt = await core.webhooks.receive(domainMismatch);
      expect((await core.webhooks.getById(mismatchedDomainReceipt.id))?.resolution).toBe('unverified');
      expect(await core.webhooks.processUninstall(mismatchedDomainReceipt.id)).toBe('unverified');
      expect((await core.webhooks.getById(mismatchedDomainReceipt.id))?.state).toBe('failed');
      await expect(
        core.webhooks.receive({
          ...delivery(domain, randomUUID(), 'app/uninstalled'),
          rawBody: Buffer.from('{"id":105501393179}'),
        }),
      ).rejects.toThrow(/valid Shop domain/);
      const generation = await database
        .selectFrom('installation_generations')
        .select('deactivated_at')
        .where('shop_id', '=', shopId)
        .executeTakeFirstOrThrow();
      expect(generation.deactivated_at).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('atomically processes a current uninstall and fences credentials and outbox', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: signedShopId(domain) }),
      );
      await core.credentials.install({
        shopId,
        installationGeneration: '1',
        pair: pair('synthetic-access', 'synthetic-refresh'),
      });
      const configId = randomUUID();
      const productId = randomUUID();
      const revisionId = randomUUID();
      const operationId = randomUUID();
      const config = createConfigRepositoryInternal(database);
      await config.createConfig({
        shopId,
        configId,
        externalProductId: productId,
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: {},
      });
      await config.createRevision({
        shopId,
        configId,
        revisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: {
          version: 'm2-published-config-v1',
          shopId,
          productId,
          revisionId,
          shopCurrency: 'USD',
          methods: [],
          placements: [],
          productionOptions: [],
          pricingRules: [],
        },
      });
      const projection = { policy: 'required', readiness: 'ready' };
      await database.transaction().execute(async (tx) => {
        const publication = createPublicationRepository(tx);
        await publication.request({
          shopId,
          configId,
          operationId,
          revisionId,
          installationGeneration: '1',
          expectedProjection: projection,
        });
        expect(await publication.acknowledge(shopId, configId, operationId)).toBe('acknowledged');
        expect(await publication.observe({ shopId, configId, operationId, projection })).toBe('observed');
        expect(await publication.activate(shopId, configId, operationId)).toBe('activated');
      });
      expect((await config.getConfig(shopId, configId))?.effectiveRevisionId).toBe(revisionId);
      const event = newOutboxEvent({
        shopId,
        installationGeneration: '1',
        eventType: 'synthetic.pending',
        schemaVersion: 1,
        aggregateRef: randomUUID(),
        payload: { value: 1 },
        businessKey: randomUUID(),
        occurredAt: new Date(),
        availableAt: new Date(),
        retentionClass: 'test-transient',
        purgeAfter: new Date(Date.now() + 60_000),
      });
      await core.transactions.run((tx) => core.outbox.add(tx, event));
      const input = delivery(domain, randomUUID(), 'app/uninstalled');
      const first = await core.webhooks.receive(input);
      expect(first.installationGeneration).toBe('1');
      expect(await core.webhooks.processUninstall(first.id)).toBe('processed');
      expect((await core.webhooks.getById(first.id))?.state).toBe('processed');
      expect((await config.getConfig(shopId, configId))?.effectiveRevisionId).toBeNull();
      await database.transaction().execute(async (tx) => {
        expect(await createPublicationRepository(tx).activate(shopId, configId, operationId)).toBe('stale');
      });
      await expect(
        database.transaction().execute((tx) =>
          createPublicationRepository(tx).request({
            shopId,
            configId,
            operationId: randomUUID(),
            revisionId,
            installationGeneration: '1',
            expectedProjection: projection,
          }),
        ),
      ).rejects.toThrow('inactive installation generation');
      expect(await core.webhooks.pendingUninstallIds(100)).not.toContain(first.id);
      expect(
        (
          await core.credentials.acquire({
            shopId,
            installationGeneration: '1',
            minimumRemainingMs: 0,
            claimLeaseMs: 30_000,
          })
        ).kind,
      ).toBe('inactive');
      expect(await core.webhooks.receive(input)).toMatchObject({ kind: 'processed', id: first.id });
      expect(await core.webhooks.processUninstall(first.id)).toBe('already_processed');
      expect(
        (
          await core.credentials.acquire({
            shopId,
            installationGeneration: '1',
            minimumRemainingMs: 0,
            claimLeaseMs: 30_000,
          })
        ).kind,
      ).toBe('inactive');
      expect(await core.outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
      await expect(
        core.transactions.run((tx) => core.outbox.add(tx, { ...event, id: randomUUID(), businessKey: randomUUID() })),
      ).rejects.toThrow('inactive');
      const stored = await database
        .selectFrom('shop_credentials')
        .select(['state', 'access_envelope', 'refresh_envelope'])
        .where('shop_id', '=', shopId)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ state: 'revoked', access_envelope: null, refresh_envelope: null });
      const inactive = await database
        .selectFrom('installation_generations')
        .select('deactivated_at')
        .where('shop_id', '=', shopId)
        .where('generation', '=', '1')
        .executeTakeFirstOrThrow();
      expect(inactive.deactivated_at).not.toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('fails closed when a wrapping key is missing or ciphertext/AAD is tampered', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
    const missing = createDurableCore(new Pool({ connectionString }), {
      credentialKeys: { currentKeyId: 'missing', keys: { missing: Buffer.alloc(32, 19) } },
    });
    const shopId = randomUUID();
    const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const input = { shopId, installationGeneration: '1', minimumRemainingMs: 0, claimLeaseMs: 30_000 };
    try {
      await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain }));
      await core.credentials.install({
        shopId,
        installationGeneration: '1',
        pair: pair('synthetic-access-aad', 'synthetic-refresh-aad'),
      });
      await expect(missing.credentials.acquire(input)).rejects.toBeInstanceOf(MissingCredentialKeyError);
      const original = await database
        .selectFrom('shop_credentials')
        .select('access_envelope')
        .where('shop_id', '=', shopId)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('shop_credentials')
        .set({ access_envelope: { ...(original.access_envelope as object), ciphertext: 'AAAA' } })
        .where('shop_id', '=', shopId)
        .execute();
      await expect(core.credentials.acquire(input)).rejects.toBeInstanceOf(CredentialAuthenticationError);
      await database
        .updateTable('shop_credentials')
        .set({ access_envelope: original.access_envelope, credential_version: '2' })
        .where('shop_id', '=', shopId)
        .execute();
      await expect(core.credentials.acquire(input)).rejects.toBeInstanceOf(CredentialAuthenticationError);
    } finally {
      await Promise.all([core.close(), missing.close(), database.destroy()]);
    }
  });
});
