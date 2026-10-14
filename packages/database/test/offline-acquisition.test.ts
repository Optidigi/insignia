import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createDurableCore, MissingCredentialKeyError } from '../src/index.js';
import { openTestDatabase } from './support/postgres.js';

const keys = { currentKeyId: 'acquisition-test', keys: { 'acquisition-test': Buffer.alloc(32, 51) } };
const connectionString = process.env.DATABASE_URL;
function core() {
  return createDurableCore(new Pool({ connectionString }), { credentialKeys: keys });
}
async function fixture(c: ReturnType<typeof core>) {
  const shopId = randomUUID();
  const externalInstallationId = `gid://shopify/AppInstallation/${Date.now()}`;
  await c.transactions.run((tx) =>
    c.tenants.createShop(tx, {
      shopId,
      shopifyShopId: `${Date.now()}${Math.floor(Math.random() * 100000)}`,
      shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
      externalInstallationId,
    }),
  );
  const scope = await c.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
  if (!scope) throw new Error('Missing fixture authority');
  return {
    shopId,
    installationGeneration: '1',
    authorizationGeneration: scope.authorizationGeneration,
    authorizationEpoch: scope.authorizationEpoch,
    externalInstallationId,
    claimLeaseMs: 10_000,
  };
}

describe('durable offline credential acquisition', () => {
  it('allows only one process to reserve a missing credential and preserves dispatched uncertainty across restart', async () => {
    const first = core(),
      peer = core();
    let restarted: ReturnType<typeof core> | undefined;
    let firstClosed = false;
    try {
      const input = await fixture(first);
      const results = await Promise.all([
        first.credentials.reserveAcquisition(input),
        peer.credentials.reserveAcquisition(input),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(['busy', 'reserved']);
      const winner = results.find((r) => r.kind === 'reserved');
      if (winner?.kind !== 'reserved') throw new Error('No winner');
      const attempt = { ...input, attemptId: winner.attemptId };
      expect(await first.credentials.dispatchAcquisition(attempt)).toBe(true);
      await first.close();
      firstClosed = true;
      restarted = core();
      expect(await restarted.credentials.reserveAcquisition(input)).toEqual({ kind: 'unresolved' });
      expect(await peer.credentials.dispatchAcquisition(attempt)).toBe(false);
    } finally {
      await Promise.all([firstClosed ? undefined : first.close(), peer.close(), restarted?.close()]);
    }
  });
  it('installs both encrypted values atomically and excludes direct install and refresh while dispatched', async () => {
    const c = core(),
      db = await openTestDatabase();
    try {
      const input = await fixture(c);
      const reservation = await c.credentials.reserveAcquisition(input);
      if (reservation.kind !== 'reserved') throw new Error('No reservation');
      const attempt = { ...input, attemptId: reservation.attemptId };
      expect(await c.credentials.dispatchAcquisition(attempt)).toBe(true);
      const pair = {
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        accessExpiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        scopes: 'read_products',
      };
      await expect(c.credentials.install({ ...input, pair })).rejects.toThrow('acquisition pending');
      expect(await c.credentials.acquire({ ...input, minimumRemainingMs: 0 })).toMatchObject({ kind: 'busy' });
      await expect(
        c.credentials.completeAcquisition({ ...attempt, pair: { ...pair, refreshToken: '' } }),
      ).rejects.toThrow('Invalid expiring');
      expect(await c.credentials.metadata(input)).toBeUndefined();
      expect(await c.credentials.completeAcquisition({ ...attempt, pair })).toBe('installed');
      expect(await c.credentials.completeAcquisition({ ...attempt, pair })).toBe('stale');
      expect(await c.credentials.acquire({ ...input, minimumRemainingMs: 0 })).toMatchObject({
        kind: 'usable',
        accessToken: 'synthetic-access',
      });
      const stored = await db
        .selectFrom('shop_credentials')
        .selectAll()
        .where('shop_id', '=', input.shopId)
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(stored)).not.toContain('synthetic-access');
      expect(JSON.stringify(stored)).not.toContain('synthetic-refresh');
      expect(await c.credentials.reserveAcquisition(input)).toEqual({ kind: 'existing' });
      await expect(c.credentials.install({ ...input, pair })).rejects.toThrow('already active');
    } finally {
      await Promise.all([c.close(), db.destroy()]);
    }
  });
  it('only reclaims an expired undispatched reservation; a dispatched attempt is not expired into retry', async () => {
    const c = core(),
      db = await openTestDatabase();
    try {
      const input = await fixture(c);
      const first = await c.credentials.reserveAcquisition(input);
      if (first.kind !== 'reserved') throw new Error('No reservation');
      await db
        .updateTable('shop_credential_acquisitions')
        .set({ reserved_until: new Date(0) })
        .where('attempt_id', '=', first.attemptId)
        .execute();
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: first.attemptId })).toBe(false);
      const second = await c.credentials.reserveAcquisition(input);
      if (second.kind !== 'reserved') throw new Error('No second reservation');
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: second.attemptId })).toBe(true);
      await db
        .updateTable('shop_credential_acquisitions')
        .set({ reserved_until: new Date(0) })
        .where('attempt_id', '=', second.attemptId)
        .execute();
      expect(await c.credentials.reserveAcquisition(input)).toEqual({ kind: 'unresolved' });
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: second.attemptId })).toBe(false);
      expect(await c.credentials.rejectAcquisition({ ...input, attemptId: second.attemptId })).toBe(true);
      expect(await c.credentials.reserveAcquisition(input)).toMatchObject({ kind: 'reserved' });
    } finally {
      await Promise.all([c.close(), db.destroy()]);
    }
  });
  it('blocks stale authorization dispatch, completion and rejection without exposing tokens', async () => {
    const c = core(),
      db = await openTestDatabase();
    try {
      const input = await fixture(c);
      expect(await c.credentials.reserveAcquisition({ ...input, authorizationEpoch: 1 })).toEqual({ kind: 'inactive' });
      const reserved = await c.credentials.reserveAcquisition(input);
      if (reserved.kind !== 'reserved') throw new Error('No reservation');
      const attempt = { ...input, attemptId: reserved.attemptId };
      expect(await c.credentials.dispatchAcquisition(attempt)).toBe(true);
      await db
        .updateTable('installation_generations')
        .set({ authorization_epoch: '1' })
        .where('shop_id', '=', input.shopId)
        .execute();
      const pair = {
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        accessExpiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        scopes: null,
      };
      expect(await c.credentials.completeAcquisition({ ...attempt, pair })).toBe('stale');
      expect(await c.credentials.rejectAcquisition(attempt)).toBe(false);
      expect(await c.credentials.metadata(input)).toBeUndefined();
      expect(await c.credentials.reserveAcquisition({ ...input, authorizationEpoch: 1 })).toEqual({
        kind: 'unresolved',
      });
      await c.transactions.run((tx) =>
        c.tenants.startInstallation(tx, input.shopId, 'gid://shopify/AppInstallation/999'),
      );
      expect(await c.credentials.completeAcquisition({ ...attempt, pair })).toBe('inactive');
    } finally {
      await Promise.all([c.close(), db.destroy()]);
    }
  });

  it('does not acquire a new pair while a refresh is in progress and only bootstraps terminal reauthorization', async () => {
    const c = core(),
      peer = core();
    try {
      const input = await fixture(c);
      const pair = {
        accessToken: 'refresh-access',
        refreshToken: 'refresh-token',
        accessExpiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        scopes: null,
      };
      await c.credentials.install({ ...input, pair });
      const refresh = await c.credentials.acquire({ ...input, minimumRemainingMs: 300_000 });
      if (refresh.kind !== 'claimed') throw new Error('No refresh claim');
      expect(await peer.credentials.reserveAcquisition(input)).toEqual({ kind: 'existing' });
      await expect(peer.credentials.install({ ...input, pair })).rejects.toThrow('already active');
      expect(
        await c.credentials.markReauthRequired({
          ...input,
          claimId: refresh.claimId,
          credentialVersion: refresh.credentialVersion,
        }),
      ).toBe(true);
      const reserve = await peer.credentials.reserveAcquisition(input);
      if (reserve.kind !== 'reserved') throw new Error('No reauthorization reservation');
      const attempt = { ...input, attemptId: reserve.attemptId };
      expect(await peer.credentials.dispatchAcquisition(attempt)).toBe(true);
      expect(
        await c.credentials.replaceClaim({
          ...input,
          claimId: refresh.claimId,
          credentialVersion: refresh.credentialVersion,
          pair,
        }),
      ).toBe('stale');
      expect(await peer.credentials.completeAcquisition({ ...attempt, pair })).toBe('installed');
      expect(await peer.credentials.metadata(input)).toMatchObject({ credential_version: '2', state: 'active' });
    } finally {
      await Promise.all([c.close(), peer.close()]);
    }
  });
  it('rejects missing wrapping keys before a reservation or dispatch can reach the provider', async () => {
    const c = core(),
      missing = createDurableCore(new Pool({ connectionString }));
    try {
      const input = await fixture(c);
      await expect(missing.credentials.reserveAcquisition(input)).rejects.toBeInstanceOf(MissingCredentialKeyError);
      const reserved = await c.credentials.reserveAcquisition(input);
      if (reserved.kind !== 'reserved') throw new Error('No reservation');
      await expect(
        missing.credentials.dispatchAcquisition({ ...input, attemptId: reserved.attemptId }),
      ).rejects.toBeInstanceOf(MissingCredentialKeyError);
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: reserved.attemptId })).toBe(true);
    } finally {
      await Promise.all([c.close(), missing.close()]);
    }
  });
  it('rechecks the captured external installation and authorization epoch before dispatch', async () => {
    const c = core(),
      db = await openTestDatabase();
    try {
      const input = await fixture(c);
      expect(
        await c.credentials.reserveAcquisition({
          ...input,
          externalInstallationId: 'gid://shopify/AppInstallation/wrong',
        }),
      ).toEqual({ kind: 'inactive' });
      const reserved = await c.credentials.reserveAcquisition(input);
      if (reserved.kind !== 'reserved') throw new Error('No reservation');
      await db
        .updateTable('installation_generations')
        .set({ authorization_epoch: '1' })
        .where('shop_id', '=', input.shopId)
        .execute();
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: reserved.attemptId })).toBe(false);
      const row = await db
        .selectFrom('shop_credential_acquisitions')
        .select(['state', 'dispatched_at'])
        .where('attempt_id', '=', reserved.attemptId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ state: 'reserved', dispatched_at: null });
    } finally {
      await Promise.all([c.close(), db.destroy()]);
    }
  });
  it('keeps expired active pairs on the refresh lane and refuses revoked pairs', async () => {
    const c = core(),
      db = await openTestDatabase();
    try {
      const input = await fixture(c);
      const pair = {
        accessToken: 'expired-test-access',
        refreshToken: 'expired-test-refresh',
        accessExpiresAt: new Date(Date.now() + 60_000),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        scopes: null,
      };
      await c.credentials.install({ ...input, pair });
      await db
        .updateTable('shop_credentials')
        .set({ access_expires_at: new Date(0) })
        .where('shop_id', '=', input.shopId)
        .execute();
      expect(await c.credentials.reserveAcquisition(input)).toEqual({ kind: 'existing' });
      const refresh = await c.credentials.acquire({ ...input, minimumRemainingMs: 0 });
      if (refresh.kind !== 'claimed') throw new Error('No refresh claim');
      expect(
        await c.credentials.releaseClaim({
          ...input,
          claimId: refresh.claimId,
          credentialVersion: refresh.credentialVersion,
        }),
      ).toBe(true);
      await db
        .updateTable('shop_credentials')
        .set({ refresh_expires_at: new Date(0) })
        .where('shop_id', '=', input.shopId)
        .execute();
      expect(await c.credentials.reserveAcquisition(input)).toEqual({ kind: 'existing' });
      expect(await c.credentials.acquire({ ...input, minimumRemainingMs: 0 })).toEqual({ kind: 'reauth_required' });
      await db
        .updateTable('shop_credentials')
        .set({ state: 'revoked', access_envelope: null, refresh_envelope: null })
        .where('shop_id', '=', input.shopId)
        .execute();
      expect(await c.credentials.reserveAcquisition(input)).toEqual({ kind: 'existing' });
    } finally {
      await Promise.all([c.close(), db.destroy()]);
    }
  });
  it('lets the existing worker refresh path inspect a pending issuance with SELECT-only acquisition access', async () => {
    const c = core(),
      owner = new Pool({ connectionString });
    const suffix = randomUUID().replaceAll('-', '');
    const runtime = `acq_web_${suffix}`,
      worker = `acq_worker_${suffix}`;
    let workerCore: ReturnType<typeof core> | undefined;
    let created = false;
    try {
      const input = await fixture(c);
      await owner.query(`CREATE ROLE ${runtime} NOLOGIN; CREATE ROLE ${worker} NOLOGIN`);
      created = true;
      const migration = await readFile(
        new URL('../migrations/20261014000100_offline_credential_acquisition.sql', import.meta.url),
        'utf8',
      );
      const grants = migration.split('-- Existing scoped roles only:')[1]?.split('-- migrate:down')[0];
      if (!grants) throw new Error('Missing scoped grant block');
      await owner.query(
        grants
          .slice(grants.indexOf('REVOKE ALL'))
          .replaceAll('insignia_runtime', runtime)
          .replaceAll('insignia_queue_consume', worker),
      );
      const permissions = await owner.query(
        `SELECT has_table_privilege($1,'shop_credential_acquisitions','SELECT') AS read,
        has_table_privilege($1,'shop_credential_acquisitions','UPDATE') AS update,
        has_table_privilege($1,'shop_credential_acquisitions','INSERT') AS insert`,
        [worker],
      );
      expect(permissions.rows[0]).toEqual({ read: true, update: false, insert: false });
      // Existing queue-role application grants, confined to this synthetic role/database.
      await owner.query(`GRANT USAGE ON SCHEMA public TO ${worker};
        GRANT SELECT ON shops,installation_generations,shop_credentials TO ${worker};
        GRANT UPDATE(updated_at) ON shops TO ${worker};
        GRANT UPDATE(deactivated_at) ON installation_generations TO ${worker};
        GRANT UPDATE ON shop_credentials TO ${worker}`);
      const reserved = await c.credentials.reserveAcquisition(input);
      if (reserved.kind !== 'reserved') throw new Error('No reservation');
      workerCore = createDurableCore(new Pool({ connectionString, options: `-c role=${worker}` }), {
        credentialKeys: keys,
      });
      expect(await workerCore.credentials.acquire({ ...input, minimumRemainingMs: 0 })).toMatchObject({ kind: 'busy' });
      expect(await c.credentials.dispatchAcquisition({ ...input, attemptId: reserved.attemptId })).toBe(true);
      expect(await workerCore.credentials.acquire({ ...input, minimumRemainingMs: 0 })).toMatchObject({ kind: 'busy' });
    } finally {
      await workerCore?.close();
      if (created) await owner.query(`DROP OWNED BY ${runtime},${worker}; DROP ROLE ${runtime},${worker}`);
      await Promise.all([c.close(), owner.end()]);
    }
  });
});
