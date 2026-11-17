import { createPrivateKey, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

type Db = Awaited<ReturnType<typeof openTestDatabase>>;
const SENTINEL = 0x7fffffff;
const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': randomBytes(32) } };

async function shopWithActiveKey(db: Db) {
  const shopId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await createTenantRepository(tx).createShop(tx, {
      shopId,
      shopDomain: `${shopId}.myshopify.com`,
      shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 5n).toString(),
    });
  });
  const store = new PgSigningKeyRepository(db, { privateHalves: true });
  const lifecycle = new SigningKeyLifecycle(store, ring);
  const scope = await store.getActiveScope(shopId, '1');
  if (!scope) throw new Error('Test installation missing');
  await lifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: SENTINEL });
  await lifecycle.activate(scope, 1);
  // A signature the active key made, as an already-recorded order carries.
  const seed = await lifecycle.openActiveSeed(scope, 1);
  const message = Buffer.from(`order authorization ${shopId}`);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const signature = sign(null, message, createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }));
  seed.fill(0);
  return { shopId, store, scope, message, signature };
}

/** Read as the schema owner: list() refuses an inactive installation by design. */
async function keys(db: Db, shopId: string, generation = '1') {
  const result = await sql<{
    key_id: number;
    state: string;
    private_envelope: unknown;
    wrapping_key_id: string | null;
    public_key: Buffer;
    public_key_fingerprint: string;
    destroyed_at: Date | null;
  }>`SELECT key_id, state, private_envelope, wrapping_key_id, public_key, public_key_fingerprint, destroyed_at
    FROM signing_keys WHERE shop_id=${shopId} AND installation_generation=${generation}::bigint ORDER BY key_id`.execute(
    db,
  );
  return result.rows;
}

function verifies(publicKey: Buffer, message: Buffer, signature: Buffer) {
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]);
  return verify(null, message, { key: spki, format: 'der', type: 'spki' }, signature);
}

async function deactivate(db: Db, shopId: string, how: 'uninstall' | 'reinstall') {
  await db.transaction().execute(async (tx) => {
    const tenants = createTenantRepository(tx);
    if (how === 'uninstall') expect(await tenants.deactivateCurrent(tx, shopId, '1')).toBe('deactivated');
    else expect(await tenants.startInstallation(tx, shopId)).toBe('2');
  });
}

describe.runIf(Boolean(process.env.DATABASE_URL))('installation deactivation destroys its signing keys', () => {
  for (const how of ['uninstall', 'reinstall'] as const)
    it(`${how}: the generation's private halves are destroyed; public keys still verify its orders`, async () => {
      const db = await openTestDatabase();
      try {
        const target = await shopWithActiveKey(db);
        const bystander = await shopWithActiveKey(db);
        const [before] = await keys(db, target.shopId);
        await deactivate(db, target.shopId, how);
        const [after] = await keys(db, target.shopId);
        expect(after).toMatchObject({
          key_id: 1,
          state: 'destroyed',
          private_envelope: null,
          wrapping_key_id: null,
          public_key_fingerprint: before?.public_key_fingerprint,
        });
        expect(after?.destroyed_at).toBeInstanceOf(Date);
        if (!after || !before) throw new Error('Signing key missing');
        expect(after.public_key.equals(before.public_key)).toBe(true);
        expect(verifies(after.public_key, target.message, target.signature)).toBe(true);
        // Another installation keeps its signing key.
        const [untouched] = await bystander.store.list(bystander.scope);
        expect(untouched).toMatchObject({ state: 'active', wrappingKeyId: 'test-wrap' });
        expect(untouched?.privateEnvelope).not.toBeNull();
        // Destruction already happened; the explicit lifecycle call finds nothing left.
        expect(await new PgSigningKeyRepository(db).destroyInactiveInstallationKeys(target.shopId, '1')).toBe(0);
        if (how === 'reinstall') {
          // The new generation starts without keys and gets its own.
          const fresh = await target.store.getActiveScope(target.shopId, '2');
          if (!fresh) throw new Error('Reinstalled generation missing');
          expect(await target.store.list(fresh)).toEqual([]);
          const lifecycle = new SigningKeyLifecycle(target.store, ring);
          await lifecycle.createPending({ scope: fresh, keyId: 1, firstDay: 100, lastDay: SENTINEL });
          await lifecycle.activate(fresh, 1);
          expect((await target.store.list(fresh))[0]?.state).toBe('active');
        }
      } finally {
        await db.destroy();
      }
    });

  it('a deactivation that changes nothing destroys nothing again', async () => {
    const db = await openTestDatabase();
    try {
      const target = await shopWithActiveKey(db);
      await deactivate(db, target.shopId, 'uninstall');
      const destroyed = await keys(db, target.shopId);
      expect(destroyed.map((key) => key.state)).toEqual(['destroyed']);
      await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${target.shopId}`.execute(
        db,
      );
      expect(await keys(db, target.shopId)).toEqual(destroyed);
    } finally {
      await db.destroy();
    }
  });
});
