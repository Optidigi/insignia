import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createSignerClient } from '../../../apps/web/src/server/signer-client.ts';
import { createSignerServer, type SignerAuditEntry } from '../../../apps/worker/src/signer/server.ts';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { issueLineSetV3, verifyLineSetV3 } from '../../cart-authorization/src/line-v3.ts';
import { createDatabase } from '../src/client/database.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createSignerKeyStore } from '../src/signer-store.js';
import { openTestDatabase } from './support/postgres.js';

async function delta(file: string, roles: Record<string, string>) {
  let text = await readFile(new URL(`../../../deployment/m5-runtime/${file}`, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(roles)) text = text.replaceAll(from, to);
  return text;
}

// Applies the shipped deltas to disposable copies of the web and signer roles, then issues a real
// v3 authorization through the signer socket.
describe.runIf(Boolean(process.env.DATABASE_URL))('separate signer grants and issuance', () => {
  it('only the signer reads private envelopes; web provisions and signs through the socket', async () => {
    const owner = await openTestDatabase();
    const suffix = randomUUID().replaceAll('-', '');
    const web = `synthetic_web_${suffix}`;
    const signerRole = `synthetic_signer_${suffix}`;
    const password = randomBytes(16).toString('hex');
    const ownerUrl = new URL(process.env.DATABASE_URL ?? '');
    const raw = new Pool({ connectionString: ownerUrl.href, max: 1 });
    const pools: Pool[] = [];
    const directory = await mkdtemp(join(tmpdir(), 'insignia-signer-'));
    const socketPath = join(directory, 'signer.sock');
    let server: ReturnType<typeof createSignerServer> | undefined;
    try {
      for (const role of [web, signerRole]) await raw.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await raw.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_worker') THEN CREATE ROLE insignia_worker NOLOGIN; END IF; END $$`,
      );
      await raw.query(
        `GRANT USAGE ON SCHEMA public TO ${web}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${web}`,
      );
      await raw.query(await delta('signing-key-runtime-grants.sql', { insignia_runtime: web }));
      await raw.query(await delta('signer-runtime-grants.sql', { insignia_runtime: web, insignia_signer: signerRole }));
      const shopId = randomUUID();
      await owner.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 11n).toString(),
        });
      });
      const connect = (role: string) => {
        const url = new URL(ownerUrl);
        url.username = role;
        url.password = password;
        const pool = new Pool({ connectionString: url.href, max: 3 });
        pools.push(pool);
        return pool;
      };
      const webPool = connect(web);
      const webStore = new PgSigningKeyRepository(createDatabase(webPool));
      const signer = createSignerKeyStore(connect(signerRole));
      const ring = { currentKeyId: 'signing-test', keys: { 'signing-test': randomBytes(32) } };
      const audit: SignerAuditEntry[] = [];
      server = createSignerServer({ store: signer.store, ring, audit: (entry) => audit.push(entry) });
      await new Promise<void>((resolve) => server?.listen(socketPath, resolve));
      const client = createSignerClient({ socketPath });
      const scope = await webStore.getActiveScope(shopId, '1');
      if (!scope) throw new Error('Test installation missing');
      const today = Math.floor(Date.now() / 86_400_000);

      // Provisioning: web receives only the public half.
      const created = await client.provision({ version: 1, scope, keyId: 1, firstDay: today - 1, lastDay: 0x7fffffff });
      expect(Object.keys(created).sort()).toEqual(['keyId', 'publicKeyFingerprint', 'publicKeyHex']);
      const listed = await webStore.list(scope);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ state: 'pending', wrappingKeyId: 'signing-test', privateEnvelope: null });
      await new SigningKeyLifecycle(webStore).activate(scope, 1);

      // Issuance through the socket verifies under the published public key.
      const signerForScope = client.authorizationSigner(scope);
      const started = performance.now();
      const issued = await issueLineSetV3(
        {
          keyId: 1,
          generationHex: scope.authorizationGeneration.replaceAll('-', ''),
          epoch: scope.authorizationEpoch,
          quoteHex: randomUUID().replaceAll('-', ''),
          setHex: randomUUID().replaceAll('-', ''),
          currency: 'USD',
          exponent: 2,
          country: 'US',
          marketId: '1',
          validThroughDay: today + 2,
        },
        [{ index: 0, variantId: '42', unitMinor: '1745' }],
        today,
        signerForScope,
      );
      const elapsedMs = performance.now() - started;
      expect(elapsedMs).toBeLessThan(2000);
      const config = await new SigningKeyLifecycle(webStore).desiredPublicConfig(scope);
      const publicHex = config.keys.find((key) => key.id === 1)?.publicHex ?? '';
      expect(publicHex).toBe(created.publicKeyHex);
      expect(verifyLineSetV3(issued.carriers, Buffer.from(publicHex, 'hex')).header.keyId).toBe(1);

      // Web cannot read or insert envelopes, delete keys or change identity.
      for (const statement of [
        `SELECT private_envelope FROM signing_keys WHERE shop_id='${shopId}'`,
        `SELECT * FROM signing_keys WHERE shop_id='${shopId}'`,
        `INSERT INTO signing_keys (shop_id) VALUES ('${shopId}')`,
        `DELETE FROM signing_keys WHERE shop_id='${shopId}'`,
        `UPDATE signing_keys SET public_key=public_key WHERE shop_id='${shopId}'`,
      ])
        await expect(webPool.query(statement)).rejects.toMatchObject({ code: '42501' });
      // The signer cannot delete keys, change their state or window, or read other tenant tables.
      const signerPool = pools[1] as Pool;
      for (const statement of [
        `DELETE FROM signing_keys WHERE shop_id='${shopId}'`,
        `UPDATE signing_keys SET state='retiring' WHERE shop_id='${shopId}'`,
        `UPDATE signing_keys SET last_valid_day=last_valid_day WHERE shop_id='${shopId}'`,
        `SELECT shop_id FROM shops LIMIT 1`,
      ])
        await expect(signerPool.query(statement)).rejects.toMatchObject({ code: '42501' });

      // Rotation: the signer creates key 2, web activates it and scrubs key 1 without reading it.
      await client.provision({ version: 1, scope, keyId: 2, firstDay: today - 1, lastDay: 0x7fffffff });
      await new SigningKeyLifecycle(webStore).activate(scope, 2);
      const envelopes = await raw.query(
        `SELECT key_id, private_envelope IS NOT NULL AS held FROM signing_keys WHERE shop_id=$1 ORDER BY key_id`,
        [shopId],
      );
      expect(envelopes.rows).toEqual([
        { key_id: 1, held: false },
        { key_id: 2, held: true },
      ]);
      // A retired key no longer signs; the active one does.
      await expect(
        client.authorizationSigner(scope).signWholeQuote({
          message: Buffer.alloc(0),
          keyId: 1,
          issuanceDay: today,
          validThroughDay: today + 2,
          generationHex: '',
          epoch: 0,
          quoteHex: '',
          setHex: '',
        }),
      ).rejects.toThrow();
      // KEK rotation through the signer store re-wraps only the private half that remains.
      const rotated = { currentKeyId: 'signing-next', keys: { 'signing-next': randomBytes(32), ...ring.keys } };
      const rewrap = new SigningKeyLifecycle(signer.store, rotated);
      expect(await rewrap.rewrap(scope, 1)).toBeNull();
      expect(await rewrap.rewrap(scope, 2)).toEqual({ from: 'signing-test', to: 'signing-next' });
      // Audit entries carry scope, key, outcome and duration only.
      for (const entry of audit)
        expect(
          Object.keys(entry).every((key) =>
            ['event', 'outcome', 'shopId', 'installationGeneration', 'keyId', 'ms'].includes(key),
          ),
        ).toBe(true);
      expect(audit.filter((entry) => entry.event === 'sign' && entry.outcome === 'ok')).toHaveLength(1);
      await new SigningKeyLifecycle(webStore).revoke(scope, 2, 'incident-signer', 'test');
      await signer.close();
    } finally {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      for (const pool of pools) await pool.end().catch(() => {});
      for (const role of [web, signerRole])
        await raw.query(`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`).catch(() => {});
      await raw.end();
      await owner.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
