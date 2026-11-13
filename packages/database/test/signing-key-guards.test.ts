import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createSignerClient } from '../../../apps/web/src/server/signer-client.ts';
import { createSignerServer } from '../../../apps/worker/src/signer/server.ts';
import { SigningKeyLifecycle } from '../../application/src/keys/lifecycle.js';
import { issueLineSetV3, verifyLineSetV3 } from '../../cart-authorization/src/line-v3.ts';
import { createDatabase } from '../src/client/database.js';
import { PgSigningKeyRepository } from '../src/repositories/signing-keys.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createSignerKeyStore } from '../src/signer-store.js';
import { openTestDatabase } from './support/postgres.js';

const SENTINEL = 0x7fffffff;
const today = Math.floor(Date.now() / 86_400_000);

/**
 * Disposable web and signer LOGIN roles (own generated password, so SCRAM is exercised where the
 * cluster requires it) with exactly the shipped signing-key deltas, and one installation.
 */
async function deployedRoles(run: (fixture: Awaited<ReturnType<typeof open>>) => Promise<void>) {
  const fixture = await open();
  try {
    await run(fixture);
  } finally {
    await fixture.close();
  }
}

async function open() {
  const owner = await openTestDatabase();
  const suffix = randomUUID().replaceAll('-', '');
  const web = `synthetic_web_${suffix}`;
  const signerRole = `synthetic_signer_${suffix}`;
  const password = randomBytes(16).toString('hex');
  const ownerUrl = new URL(process.env.DATABASE_URL ?? '');
  const raw = new Pool({ connectionString: ownerUrl.href, max: 2 });
  const pools: Pool[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'insignia-signer-guard-'));
  const servers: ReturnType<typeof createSignerServer>[] = [];
  const delta = async (file: string, from: string, to: string) =>
    (await readFile(new URL(`../../../deployment/m5-runtime/${file}`, import.meta.url), 'utf8')).replaceAll(from, to);
  for (const role of [web, signerRole]) await raw.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  await raw.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='insignia_worker') THEN CREATE ROLE insignia_worker NOLOGIN; END IF; END $$`,
  );
  await raw.query(
    `GRANT USAGE ON SCHEMA public TO ${web}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${web}`,
  );
  await raw.query(await delta('signing-key-runtime-grants.sql', 'insignia_runtime', web));
  await raw.query(await delta('signer-runtime-grants.sql', 'insignia_signer', signerRole));
  await raw.query(await delta('web-signing-envelope-revoke.sql', 'insignia_runtime', web));
  const shopId = randomUUID();
  await owner.transaction().execute(async (tx) => {
    await createTenantRepository(tx).createShop(tx, {
      shopId,
      shopDomain: `${shopId}.myshopify.com`,
      shopifyShopId: (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 17n).toString(),
    });
  });
  const connect = (role: string, max = 3) => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = password;
    const pool = new Pool({ connectionString: url.href, max });
    pools.push(pool);
    return pool;
  };
  const webPool = connect(web);
  const webStore = new PgSigningKeyRepository(createDatabase(webPool));
  const signerPool = connect(signerRole);
  const signer = createSignerKeyStore(signerPool);
  const ring = { currentKeyId: 'signing-test', keys: { 'signing-test': randomBytes(32) } };
  const scope = await webStore.getActiveScope(shopId, '1');
  if (!scope) throw new Error('Test installation missing');
  return {
    owner,
    raw,
    shopId,
    scope,
    ring,
    web: { pool: webPool, store: webStore, connect: (max?: number) => connect(web, max) },
    signer: { pool: signerPool, store: signer.store },
    async serve(beforeSign?: () => Promise<void>) {
      const socketPath = join(directory, `signer-${servers.length}.sock`);
      const server = createSignerServer({ store: signer.store, ring, beforeSign });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      return createSignerClient({ socketPath });
    },
    async close() {
      for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const pool of pools) await pool.end().catch(() => {});
      for (const role of [web, signerRole])
        await raw.query(`DROP OWNED BY ${role}; DROP ROLE IF EXISTS ${role}`).catch(() => {});
      await raw.end();
      await owner.destroy();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function issue(
  client: ReturnType<typeof createSignerClient>,
  scope: Awaited<ReturnType<typeof open>>['scope'],
  keyId: number,
) {
  return issueLineSetV3(
    {
      keyId,
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
    client.authorizationSigner(scope),
  );
}

async function envelopes(fixture: Awaited<ReturnType<typeof open>>) {
  const result = await fixture.raw.query(
    `SELECT key_id, state, private_envelope, wrapping_key_id FROM signing_keys WHERE shop_id=$1 ORDER BY key_id`,
    [fixture.shopId],
  );
  return result.rows as { key_id: number; state: string; private_envelope: unknown; wrapping_key_id: string | null }[];
}

describe.runIf(Boolean(process.env.DATABASE_URL))('signing-key envelope writer and revocation guards', () => {
  it('web can only scrub an envelope when a key leaves pending/active; the signer and owner still write them', async () => {
    await deployedRoles(async (fixture) => {
      const { scope, shopId } = fixture;
      const signerLifecycle = new SigningKeyLifecycle(fixture.signer.store, fixture.ring);
      const webLifecycle = new SigningKeyLifecycle(fixture.web.store);
      // Signer provision (INSERT) and web activation (state only).
      await signerLifecycle.createPending({ scope, keyId: 1, firstDay: 100, lastDay: SENTINEL });
      await webLifecycle.activate(scope, 1);
      const before = (await envelopes(fixture)).find((row) => row.key_id === 1);
      expect(before).toMatchObject({ state: 'active', wrapping_key_id: 'signing-test' });

      // Web cannot write, replace or drop the active key's envelope.
      const where = `WHERE shop_id='${shopId}' AND key_id=1`;
      for (const statement of [
        `UPDATE signing_keys SET private_envelope='{"kid":"garbage"}'::jsonb, wrapping_key_id='garbage' ${where}`,
        `UPDATE signing_keys SET private_envelope='{"kid":"signing-test"}'::jsonb ${where}`,
        `UPDATE signing_keys SET wrapping_key_id='garbage' ${where}`,
        `UPDATE signing_keys SET private_envelope=NULL, wrapping_key_id=NULL ${where}`,
      ])
        await expect(fixture.web.pool.query(statement)).rejects.toMatchObject({ code: '42501' });
      expect((await envelopes(fixture)).find((row) => row.key_id === 1)).toEqual(before);
      // Assigning the unchanged value is not an envelope write.
      await fixture.web.pool.query(`UPDATE signing_keys SET wrapping_key_id=wrapping_key_id ${where}`);

      // Signer KEK re-wrap of a pending/active envelope is allowed.
      const rotated = {
        currentKeyId: 'signing-next',
        keys: { 'signing-next': randomBytes(32), ...fixture.ring.keys },
      };
      expect(await new SigningKeyLifecycle(fixture.signer.store, rotated).rewrap(scope, 1)).toEqual({
        from: 'signing-test',
        to: 'signing-next',
      });
      // The schema owner (migrations) is not restricted.
      await fixture.raw.query(`UPDATE signing_keys SET wrapping_key_id='owner-kek' ${where}`);
      await fixture.raw.query(`UPDATE signing_keys SET wrapping_key_id='signing-next' ${where}`);

      // Rotation: web schedules the outgoing window, activates key 2 and scrubs key 1 in that statement.
      const ring2 = { currentKeyId: 'signing-next', keys: rotated.keys };
      await new SigningKeyLifecycle(fixture.signer.store, ring2).createPending({
        scope,
        keyId: 2,
        firstDay: 100,
        lastDay: SENTINEL,
      });
      await fixture.web.store.scheduleRetirement(scope, 1, 105);
      await webLifecycle.activate(scope, 2);
      // Web revokes a pending key and the active key, scrubbing each.
      await new SigningKeyLifecycle(fixture.signer.store, ring2).createPending({
        scope,
        keyId: 3,
        firstDay: 100,
        lastDay: SENTINEL,
      });
      await webLifecycle.revoke(scope, 3, 'guard-pending', 'test');
      await webLifecycle.revoke(scope, 2, 'guard-active', 'test');
      expect(
        (await envelopes(fixture)).map(({ key_id, state, private_envelope, wrapping_key_id }) => ({
          key_id,
          state,
          held: private_envelope !== null || wrapping_key_id !== null,
        })),
      ).toEqual([
        { key_id: 1, state: 'retiring', held: false },
        { key_id: 2, state: 'revoked', held: false },
        { key_id: 3, state: 'revoked', held: false },
      ]);
      // Worker destruction job (definer function) destroys the closed window.
      const owned = new PgSigningKeyRepository(fixture.owner);
      while ((await owned.destroyExpired(100)) > 0);
      expect((await envelopes(fixture)).find((row) => row.key_id === 1)?.state).toBe('destroyed');

      // Uninstall: web destroys an installation's keys, scrubbing the active key in the same statement.
      await new SigningKeyLifecycle(fixture.signer.store, ring2).createPending({
        scope,
        keyId: 4,
        firstDay: 100,
        lastDay: SENTINEL,
      });
      await webLifecycle.activate(scope, 4);
      await fixture.raw.query(
        `UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1 AND generation=1`,
        [shopId],
      );
      expect(await fixture.web.store.destroyInactiveInstallationKeys(shopId, '1')).toBe(3);
      expect(
        (await envelopes(fixture)).every((row) => row.private_envelope === null && row.state === 'destroyed'),
      ).toBe(true);
    });
  });

  it('a revoke waits for an in-flight signature, and a signature waits for an uncommitted revoke', async () => {
    await deployedRoles(async (fixture) => {
      const { scope, shopId } = fixture;
      const lifecycle = new SigningKeyLifecycle(fixture.signer.store, fixture.ring);
      await lifecycle.createPending({ scope, keyId: 1, firstDay: today - 1, lastDay: SENTINEL });
      await new SigningKeyLifecycle(fixture.web.store).activate(scope, 1);
      const publicHex = (
        await fixture.raw.query(`SELECT encode(public_key,'hex') AS hex FROM signing_keys WHERE shop_id=$1`, [shopId])
      ).rows[0].hex as string;

      // A revoke on its own web connection, whose backend pid lets us see it wait for a row lock.
      const revokePool = fixture.web.connect(1);
      const revokeStore = new PgSigningKeyRepository(createDatabase(revokePool));
      const revokePid = (await revokePool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const waiting = async () =>
        (await fixture.raw.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [revokePid])).rowCount === 1;

      // 1. The signer has checked the key and is about to sign when the revoke starts.
      let paused!: () => void;
      let release!: () => void;
      const atSign = new Promise<void>((resolve) => {
        paused = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const client = await fixture.serve(async () => {
        calls += 1;
        if (calls !== 1) return;
        paused();
        await gate;
      });
      const signed = issue(client, scope, 1);
      await atSign;
      let revoked = false;
      const revoke = revokeStore.revoke(scope, 1, 'race-1', 'test').then(() => {
        revoked = true;
      });
      const deadline = Date.now() + 5_000;
      while (!revoked && !(await waiting()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      // The revoke cannot commit while the signature is in flight.
      expect(revoked).toBe(false);
      expect(await waiting()).toBe(true);
      release();
      const issued = await signed;
      await revoke;
      expect(verifyLineSetV3(issued.carriers, Buffer.from(publicHex, 'hex')).header.keyId).toBe(1);
      // Every later signature sees the committed revocation.
      await expect(issue(client, scope, 1)).rejects.toThrow();

      // 2. A revoke that holds the row uncommitted: the signature waits and then sees it revoked.
      await new SigningKeyLifecycle(fixture.signer.store, fixture.ring).createPending({
        scope,
        keyId: 2,
        firstDay: today - 1,
        lastDay: SENTINEL,
      });
      await new SigningKeyLifecycle(fixture.web.store).activate(scope, 2);
      const pending = await revokePool.connect();
      try {
        await pending.query('BEGIN');
        await pending.query(
          `UPDATE signing_keys SET state='revoked', revoked_at=clock_timestamp(), revocation_command_key='race-2',
            revocation_reason='test', private_envelope=NULL, wrapping_key_id=NULL WHERE shop_id=$1 AND key_id=2`,
          [shopId],
        );
        let settled = false;
        const blocked = issue(client, scope, 2).then(
          () => {
            settled = true;
            return 'signed';
          },
          () => {
            settled = true;
            return 'refused';
          },
        );
        const signerWaits = async () =>
          (
            await fixture.raw.query(
              `SELECT 1 FROM pg_locks w JOIN pg_locks h ON h.locktype='transactionid'
                 AND h.transactionid=w.transactionid AND h.granted AND h.pid=$1
               WHERE w.locktype='transactionid' AND NOT w.granted`,
              [revokePid],
            )
          ).rowCount === 1;
        const until = Date.now() + 5_000;
        while (!settled && !(await signerWaits()) && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
        expect(settled).toBe(false);
        await pending.query('COMMIT');
        expect(await blocked).toBe('refused');
      } finally {
        await pending.query('ROLLBACK').catch(() => {});
        pending.release();
      }
    });
  });
});
