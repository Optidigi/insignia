import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('durable signing key lifecycle', () => {
  it('encrypts raw seed and fences rotation, epoch, and reinstall', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    const seed = Buffer.alloc(32, 0x42);
    const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': Buffer.alloc(32, 0x6a) } };
    try {
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString(),
        });
      });
      const store = new PgSigningKeyRepository(db);
      const lifecycle = new SigningKeyLifecycle(store, ring);
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      await lifecycle.createPending({ scope, keyId: 7, firstDay: 100, lastDay: 104, seed });
      const raw = await sql<{
        value: string;
      }>`SELECT row_to_json(k)::text AS value FROM signing_keys k WHERE shop_id=${shopId} AND key_id=7`.execute(db);
      expect(raw.rows[0]?.value).not.toContain(seed.toString('hex'));
      expect(raw.rows[0]?.value).not.toContain(seed.toString('base64'));
      await lifecycle.activate(scope, 7);
      expect(await lifecycle.openActiveSeed(scope, 7)).toEqual(seed);
      await lifecycle.createPending({ scope, keyId: 8, firstDay: 102, lastDay: 106 });
      await lifecycle.activate(scope, 8);
      expect((await store.list(scope)).find((key) => key.keyId === 7)?.state).toBe('retiring');
      const requestDigest = createHash('sha256').update('emergency').digest('hex');
      expect(await lifecycle.incrementEpoch({ scope, commandKey: 'incident-1', requestDigest })).toBe(1);
      expect(await lifecycle.incrementEpoch({ scope, commandKey: 'incident-1', requestDigest })).toBe(1);
      await expect(lifecycle.incrementEpoch({ scope, commandKey: 'incident-2', requestDigest })).rejects.toThrow();
      const nextScope = await store.getActiveScope(shopId, '1');
      if (!nextScope) throw new Error('Test installation missing');
      await lifecycle.revoke(nextScope, 8, 'incident-1', 'Synthetic compromised key');
      expect((await store.list(nextScope)).find((key) => key.keyId === 8)?.state).toBe('revoked');
      await lifecycle.destroy(nextScope, 7);
      expect((await store.list(nextScope)).find((key) => key.keyId === 7)?.privateEnvelope).toBeNull();
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).startInstallation(tx, shopId);
      });
      await expect(lifecycle.desiredPublicConfig(nextScope)).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });

  it('fails closed when stored ciphertext changes or the wrapping key is unavailable', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    try {
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString(),
        });
      });
      const store = new PgSigningKeyRepository(db);
      const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': Buffer.alloc(32, 0x6a) } };
      const lifecycle = new SigningKeyLifecycle(store, ring);
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      await lifecycle.createPending({ scope, keyId: 9, firstDay: 100, lastDay: 104 });
      await lifecycle.activate(scope, 9);
      await expect(
        new SigningKeyLifecycle(store, { currentKeyId: 'missing', keys: {} }).openActiveSeed(scope, 9),
      ).rejects.toThrow();
      await sql`UPDATE signing_keys SET private_envelope=jsonb_set(private_envelope,'{tag}','"AAAAAAAAAAAAAAAAAAAAAA"') WHERE shop_id=${shopId} AND key_id=9`.execute(
        db,
      );
      await expect(lifecycle.openActiveSeed(scope, 9)).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });
});
