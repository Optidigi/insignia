import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { createDatabase } from '../src/client/database.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

// Applies the shipped delta to a disposable copy of the legacy blanket web grant.
describe.runIf(Boolean(process.env.DATABASE_URL))('signing key runtime grants', () => {
  it('lets the web role run the whole key lifecycle but not delete keys or change their identity', async () => {
    const owner = await openTestDatabase();
    const role = `synthetic_signing_web_${randomUUID().replaceAll('-', '')}`;
    const password = randomBytes(16).toString('hex');
    let pool: Pool | undefined;
    const ownerUrl = new URL(process.env.DATABASE_URL ?? '');
    const raw = new Pool({ connectionString: ownerUrl.href, max: 1 });
    try {
      await raw.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD '${password}'; END IF; END $$`,
      );
      await raw.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_worker') THEN CREATE ROLE insignia_worker NOLOGIN; END IF; END $$`,
      );
      await raw.query(
        `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      );
      const delta = (
        await readFile(
          new URL('../../../deployment/m5-runtime/signing-key-runtime-grants.sql', import.meta.url),
          'utf8',
        )
      ).replaceAll('insignia_runtime', role);
      await raw.query(delta);
      // Migration 58 grants the scope function to the deployed web role; mirror it for the copy.
      await raw.query(`GRANT EXECUTE ON FUNCTION public.signing_key_scope(text, bigint, boolean) TO ${role}`);
      const shopId = randomUUID();
      await owner.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 7n).toString(),
        });
      });
      const webUrl = new URL(ownerUrl);
      webUrl.username = role;
      webUrl.password = password;
      pool = new Pool({ connectionString: webUrl.href, max: 2 });
      const web = createDatabase(pool);
      // This legacy delta still let web read envelopes; the signer delta (signer-grants.test) removes it.
      const store = new PgSigningKeyRepository(web, { privateHalves: true });
      const oldRing = { currentKeyId: 'credential-1', keys: { 'credential-1': randomBytes(32) } };
      const scope = await store.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      const lifecycle = new SigningKeyLifecycle(store, oldRing);
      await lifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: 0x7fffffff });
      await lifecycle.activate(scope, 1);
      await lifecycle.scheduleRetirement(scope, 1, 150);
      // KEK rotation: a dedicated signing ring re-seals the envelope; the seed still opens and matches.
      const signingRing = { currentKeyId: 'signing-1', keys: { 'signing-1': randomBytes(32), ...oldRing.keys } };
      const rotated = new SigningKeyLifecycle(store, signingRing);
      expect(await rotated.rewrap(scope, 1)).toEqual({ from: 'credential-1', to: 'signing-1' });
      expect(await rotated.rewrap(scope, 1)).toEqual({ from: 'signing-1', to: 'signing-1' });
      const onlySigning = new SigningKeyLifecycle(store, {
        currentKeyId: 'signing-1',
        keys: { 'signing-1': signingRing.keys['signing-1'] },
      });
      expect((await onlySigning.openActiveSeed(scope, 1)).byteLength).toBe(32);
      await expect(new SigningKeyLifecycle(store, oldRing).openActiveSeed(scope, 1)).rejects.toThrow();
      await rotated.createPending({ scope, keyId: 2, firstDay: 100, lastDay: 0x7fffffff });
      await rotated.activate(scope, 2);
      await rotated.destroy(scope, 1);
      await rotated.revoke(scope, 2, 'incident-2', 'suspected leak');
      for (const statement of [
        `DELETE FROM signing_keys WHERE shop_id='${shopId}'`,
        `UPDATE signing_keys SET public_key=public_key WHERE shop_id='${shopId}'`,
        `UPDATE signing_keys SET first_valid_day=first_valid_day WHERE shop_id='${shopId}'`,
      ])
        await expect(pool.query(statement)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await pool?.end();
      await raw.query(`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`).catch(() => {});
      await raw.end();
      await owner.destroy();
    }
  });
});
