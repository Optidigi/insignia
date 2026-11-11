import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('durable signing key lifecycle', () => {
  it('keys are non-expiring until retirement shortens their window; destruction follows the shortened window', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': randomBytes(32) } };
    const SENTINEL = 0x7fffffff;
    try {
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 3n).toString(),
        });
      });
      const store = new PgSigningKeyRepository(db, { privateHalves: true });
      const lifecycle = new SigningKeyLifecycle(store, ring);
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      await expect(lifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: 0xffffffff })).rejects.toThrow();
      await lifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: SENTINEL });
      // A pending key cannot be scheduled; only the active issuer can.
      await expect(store.scheduleRetirement(scope, 1, 105)).rejects.toThrow(/Active signing key required/);
      await lifecycle.activate(scope, 1);
      expect((await store.list(scope)).find((key) => key.keyId === 1)?.lastDay).toBe(SENTINEL);
      // Shorten only: a later day cannot extend it, and the trigger refuses any direct extension.
      await lifecycle.scheduleRetirement(scope, 1, 105);
      await lifecycle.scheduleRetirement(scope, 1, 2000);
      expect((await store.list(scope)).find((key) => key.keyId === 1)?.lastDay).toBe(105);
      await expect(
        sql`UPDATE signing_keys SET last_valid_day=106 WHERE shop_id=${shopId} AND key_id=1`.execute(db),
      ).rejects.toThrow(/may only shorten/);
      // The window never ends before the key's first day.
      await lifecycle.scheduleRetirement(scope, 1, 50);
      expect((await store.list(scope)).find((key) => key.keyId === 1)?.lastDay).toBe(100);
      await lifecycle.createPending({ scope, keyId: 2, firstDay: 100, lastDay: SENTINEL });
      await lifecycle.activate(scope, 2);
      expect((await store.list(scope)).map(({ keyId, state, lastDay }) => ({ keyId, state, lastDay }))).toEqual([
        { keyId: 1, state: 'retiring', lastDay: 100 },
        { keyId: 2, state: 'active', lastDay: SENTINEL },
      ]);
      // The shortened window is long past, so the retired key can be destroyed; the open-ended one cannot.
      await lifecycle.destroy(scope, 1);
      expect((await store.list(scope)).find((key) => key.keyId === 1)?.state).toBe('destroyed');
      // Activation without a scheduled window still bounds the retiring key (UTC day + 4).
      await lifecycle.createPending({ scope, keyId: 3, firstDay: 100, lastDay: SENTINEL });
      await lifecycle.activate(scope, 3);
      const utcDay = Math.floor(Date.now() / 86_400_000);
      const bounded = (await store.list(scope)).find((key) => key.keyId === 2);
      expect(bounded?.state).toBe('retiring');
      expect(bounded?.lastDay).toBeGreaterThanOrEqual(utcDay + 3);
      expect(bounded?.lastDay).toBeLessThanOrEqual(utcDay + 4);
      await expect(lifecycle.destroy(scope, 2)).rejects.toThrow(/destruction window/);
      // Revocation shortens an open-ended window to UTC day + 3, so destruction can close later.
      await lifecycle.revoke(scope, 3, 'incident-key-3', 'suspected leak');
      const today = Math.floor(Date.now() / 86_400_000);
      const revoked = (await store.list(scope)).find((key) => key.keyId === 3);
      expect(revoked?.state).toBe('revoked');
      expect(revoked?.lastDay).toBeGreaterThanOrEqual(today + 2);
      expect(revoked?.lastDay).toBeLessThanOrEqual(today + 3);
      await expect(lifecycle.destroy(scope, 3)).rejects.toThrow(/destruction window/);
    } finally {
      await db.destroy();
    }
  });

  it('scrubs the private half when a key leaves active, one way, and the worker destroys closed windows', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': randomBytes(32) } };
    try {
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
      await lifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: 0x7fffffff });
      await lifecycle.activate(scope, 1);
      await lifecycle.scheduleRetirement(scope, 1, 105);
      const before = await lifecycle.desiredPublicConfig(scope);
      await lifecycle.createPending({ scope, keyId: 2, firstDay: 100, lastDay: 0x7fffffff });
      const pendingConfig = await lifecycle.desiredPublicConfig(scope);
      await lifecycle.activate(scope, 2);
      const keys = await store.list(scope);
      const retired = keys.find((key) => key.keyId === 1);
      // Same public key, window and published bytes; only the private half is gone.
      expect(retired).toMatchObject({ state: 'retiring', lastDay: 105, privateEnvelope: null, wrappingKeyId: null });
      expect(
        Buffer.from(retired?.publicKey ?? []).equals(
          Buffer.from(before.keys[0] ? Buffer.from(before.keys[0].publicHex, 'hex') : []),
        ),
      ).toBe(true);
      expect((await lifecycle.desiredPublicConfig(scope)).value).toBe(pendingConfig.value);
      // No path opens a retired key's seed; re-wrap skips it.
      await expect(lifecycle.openActiveSeed(scope, 1)).rejects.toThrow();
      expect(await lifecycle.rewrap(scope, 1)).toBeNull();
      // One way: neither a direct restore nor a return to signing is accepted.
      await expect(
        sql`UPDATE signing_keys SET private_envelope='{}'::jsonb, wrapping_key_id='test-wrap' WHERE shop_id=${shopId} AND key_id=1`.execute(
          db,
        ),
      ).rejects.toThrow(/cannot be restored/);
      await expect(
        sql`UPDATE signing_keys SET state='active' WHERE shop_id=${shopId} AND key_id=1`.execute(db),
      ).rejects.toThrow();
      // Revocation of a pending key scrubs it too.
      await lifecycle.createPending({ scope, keyId: 3, firstDay: 100, lastDay: 0x7fffffff });
      await lifecycle.revoke(scope, 3, 'incident-3', 'suspected leak');
      expect((await store.list(scope)).find((key) => key.keyId === 3)).toMatchObject({
        state: 'revoked',
        privateEnvelope: null,
        wrappingKeyId: null,
      });
      // The daily job destroys only closed windows (key 1, day 105) and is idempotent.
      const destroyed = await store.destroyExpired(100);
      expect(destroyed).toBeGreaterThanOrEqual(1);
      expect((await store.list(scope)).map(({ keyId, state }) => ({ keyId, state }))).toEqual([
        { keyId: 1, state: 'destroyed' },
        { keyId: 2, state: 'active' },
        { keyId: 3, state: 'revoked' },
      ]);
      await store.destroyExpired(100);
      expect((await store.list(scope)).find((key) => key.keyId === 3)?.state).toBe('revoked');
      await expect(store.destroyExpired(0)).rejects.toThrow();
      // Revocation and destruction are final.
      for (const statement of [
        sql`UPDATE signing_keys SET state='retiring' WHERE shop_id=${shopId} AND key_id=3`,
        sql`UPDATE signing_keys SET state='retiring' WHERE shop_id=${shopId} AND key_id=1`,
      ])
        await expect(statement.execute(db)).rejects.toThrow(/cannot be restored/);
      const envelopes = await sql<{ key_id: number }>`SELECT key_id FROM signing_keys
        WHERE shop_id=${shopId} AND private_envelope IS NOT NULL ORDER BY key_id`.execute(db);
      expect(envelopes.rows.map((row) => row.key_id)).toEqual([2]);
    } finally {
      await db.destroy();
    }
  });

  it('migration 57 scrubs existing retired envelopes on a table that still has the old constraint', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    const up = (
      await readFile(new URL('../migrations/20261112000100_signing_key_private_scrub.sql', import.meta.url), 'utf8')
    ).split('-- migrate:down')[0] as string;
    const rollback = new Error('rollback');
    try {
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 9n).toString(),
        });
        // Recreate the pre-57 shape: old constraint, no destroy function, a retiring key with an envelope.
        await sql`ALTER TABLE signing_keys DROP CONSTRAINT signing_keys_private_half_by_state`.execute(tx);
        await sql`ALTER TABLE signing_keys ADD CONSTRAINT signing_keys_check1 CHECK (
            (state = 'destroyed' AND private_envelope IS NULL AND wrapping_key_id IS NULL)
            OR (state <> 'destroyed' AND private_envelope IS NOT NULL AND wrapping_key_id IS NOT NULL AND wrapping_key_id <> '')) NOT VALID`.execute(
          tx,
        );
        await sql`DROP FUNCTION destroy_expired_signing_keys(integer)`.execute(tx);
        for (const [keyId, state] of [
          [1, 'retiring'],
          [2, 'active'],
        ] as const)
          await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
              public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
              SELECT ${shopId}, 1, authorization_generation, ${keyId}, ${randomBytes(32)}, ${randomBytes(32).toString('hex')},
                '{"v":1}'::jsonb, 'old-kek', ${state}, 100, 200
              FROM installation_generations WHERE shop_id=${shopId} AND generation=1`.execute(tx);
        await sql.raw(up).execute(tx);
        const rows = await sql<{ key_id: number; held: boolean; kid: string | null }>`SELECT key_id,
            private_envelope IS NOT NULL AS held, wrapping_key_id AS kid FROM signing_keys WHERE shop_id=${shopId} ORDER BY key_id`.execute(
          tx,
        );
        expect(rows.rows).toEqual([
          { key_id: 1, held: false, kid: null },
          { key_id: 2, held: true, kid: 'old-kek' },
        ]);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.destroy();
    }
  });

  it('encrypts raw seed and fences rotation, epoch, and reinstall', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    const seed = randomBytes(32);
    const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': randomBytes(32) } };
    try {
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString(),
        });
      });
      const store = new PgSigningKeyRepository(db, { privateHalves: true });
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
      const retained = (await store.list(scope)).find((key) => key.keyId === 7);
      if (!retained) throw new Error('Retained key missing');
      const retainedDigest = createHash('sha256')
        .update(
          JSON.stringify({
            ...retained,
            state: undefined,
            retiredAt: undefined,
            privateEnvelope: undefined,
            wrappingKeyId: undefined,
          }),
        )
        .digest('hex');
      await lifecycle.createPending({ scope, keyId: 8, firstDay: 102, lastDay: 106 });
      expect((await store.list(scope)).find((key) => key.keyId === 8)?.state).toBe('pending');
      await lifecycle.activate(scope, 8);
      expect((await store.list(scope)).find((key) => key.keyId === 7)?.state).toBe('retiring');
      const rotated = await store.list(scope);
      const old = rotated.find((key) => key.keyId === 7);
      if (!old) throw new Error('Retained key missing after rotation');
      expect(
        createHash('sha256')
          .update(
            JSON.stringify({
              ...old,
              state: undefined,
              retiredAt: undefined,
              privateEnvelope: undefined,
              wrappingKeyId: undefined,
            }),
          )
          .digest('hex'),
      ).toBe(retainedDigest);
      // Retirement scrubs the private half in the same transaction; public key and window stay.
      expect(old.privateEnvelope).toBeNull();
      expect(old.wrappingKeyId).toBeNull();
      expect(old.retiredAt).toBeInstanceOf(Date);
      expect(rotated.filter((key) => key.state === 'active').map((key) => key.keyId)).toEqual([8]);
      expect(await store.getActiveScope(shopId, '1')).toEqual(scope);
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
      await expect(lifecycle.destroyInactiveInstallationKeys(shopId, '1')).rejects.toThrow();
      await db.transaction().execute(async (tx) => {
        await createTenantRepository(tx).startInstallation(tx, shopId);
      });
      await expect(lifecycle.desiredPublicConfig(nextScope)).rejects.toThrow();
      expect(await lifecycle.destroyInactiveInstallationKeys(shopId, '1')).toBe(1);
      const oldPrivate = await sql<{ private_envelope: unknown }>`SELECT private_envelope FROM signing_keys
        WHERE shop_id=${shopId} AND installation_generation=1 AND key_id=8`.execute(db);
      expect(oldPrivate.rows[0]?.private_envelope).toBeNull();
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
      const store = new PgSigningKeyRepository(db, { privateHalves: true });
      const ring = { currentKeyId: 'test-wrap', keys: { 'test-wrap': randomBytes(32) } };
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

  it('rejects a fifth non-destroyed key before public config becomes unpublishable', async () => {
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
      const store = new PgSigningKeyRepository(db, { privateHalves: true });
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      const lifecycle = new SigningKeyLifecycle(store, {
        currentKeyId: 'test-wrap',
        keys: { 'test-wrap': randomBytes(32) },
      });
      for (let keyId = 1; keyId <= 4; keyId++)
        await lifecycle.createPending({ scope, keyId, firstDay: 100, lastDay: 104 });
      await expect(lifecycle.createPending({ scope, keyId: 5, firstDay: 100, lastDay: 104 })).rejects.toThrow(
        /capacity reached/,
      );
      expect(await store.list(scope)).toHaveLength(4);
    } finally {
      await db.destroy();
    }
  });
  it('rechecks signing write authority after PostgreSQL installation lock waits', async () => {
    const db = await openTestDatabase();
    const shopId = randomUUID();
    try {
      await db.transaction().execute((tx) =>
        createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString(),
        }),
      );
      const store = new PgSigningKeyRepository(db, { privateHalves: true });
      const lifecycle = new SigningKeyLifecycle(store, {
        currentKeyId: 'test-wrap',
        keys: { 'test-wrap': randomBytes(32) },
      });
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      for (const operation of ['create', 'activate']) {
        let unlock!: () => void, locked!: (pid: number) => void;
        const acquired = new Promise<number>((resolve) => {
          locked = resolve;
        });
        const release = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const blocker = db.transaction().execute(async (tx) => {
          await sql`SELECT shop_id FROM shops WHERE shop_id=${shopId} FOR UPDATE`.execute(tx);
          const pid = await sql<{ pid: number }>`SELECT pg_backend_pid() pid`.execute(tx);
          const value = pid.rows[0]?.pid;
          if (!value) throw new Error('PostgreSQL holder missing');
          locked(value);
          await release;
        });
        const holder = await acquired;
        let allowed = true;
        const guard = () => allowed;
        const write =
          operation === 'create'
            ? lifecycle.createPending({ scope, keyId: 7, firstDay: 100, lastDay: 104, beforeWrite: guard })
            : lifecycle.activate(scope, 7, guard);
        const outcome = write.then(
          () => 'written',
          () => 'denied',
        );
        try {
          let observed = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const wait = await sql<{
              blocked: boolean;
            }>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${holder}=ANY(pg_blocking_pids(pid))) blocked`.execute(
              db,
            );
            if (wait.rows[0]?.blocked) {
              observed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          expect(observed).toBe(true);
          allowed = false;
        } finally {
          unlock();
          await blocker;
        }
        expect(await outcome).toBe('denied');
        if (operation === 'create') {
          expect(await store.list(scope)).toHaveLength(0);
          await lifecycle.createPending({ scope, keyId: 7, firstDay: 100, lastDay: 104 });
        } else expect((await store.list(scope))[0]?.state).toBe('pending');
      }
    } finally {
      await db.destroy();
    }
  });
});
