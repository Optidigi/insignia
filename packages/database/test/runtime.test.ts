import { createHash, randomUUID } from 'node:crypto';
import { newOutboxEvent } from '@insignia/application';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CredentialAuthenticationError,
  createDurableCore,
  MissingCredentialKeyError,
  ShopifyDeliveryConflictError,
} from '../src/index.js';
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
      await expect(
        core.webhooks.receive({
          ...delivery(otherDomain, randomUUID(), 'app/uninstalled'),
          rawBody: delivery(domain, randomUUID(), 'app/uninstalled').rawBody,
        }),
      ).rejects.toThrow(/domain conflicts/);
      await expect(
        core.webhooks.receive({
          ...delivery(domain, randomUUID(), 'app/uninstalled'),
          rawBody: Buffer.from('{"id":105501393179}'),
        }),
      ).rejects.toThrow(/domain conflicts/);
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

  it('quarantines body-authentic but topic-unverifiable uninstall, then fences a separately authorized deactivation', async () => {
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
      expect(await core.webhooks.processUninstall(first.id)).toBe('unverified');
      expect((await core.webhooks.getById(first.id))?.state).toBe('failed');
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
      ).toBe('usable');
      // This direct local call represents a separately authenticated lifecycle
      // decision; the webhook above is not sufficient authority to invoke it.
      expect(await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, shopId, '1'))).toBe('deactivated');
      expect((await core.webhooks.receive(input)).id).toBe(first.id);
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
