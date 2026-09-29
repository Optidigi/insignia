import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { refreshExpiringOfflineCredentials } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { credentialLifecycle } from '../dist/handlers.js';

test('PostgreSQL claim retries the old refresh token after a lost response and fences stale replacement', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 30_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the credential workflow test');
  const shopId = randomUUID();
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const keys = { currentKeyId: 'synthetic-key', keys: { 'synthetic-key': Buffer.alloc(32, 27) } };
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }), { credentialKeys: keys });
  const second = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }), { credentialKeys: keys });
  const input = { shopId, installationGeneration: '1', minimumRemainingMs: 60_000, claimLeaseMs: 30_000 };
  const initial = {
    schemaVersion: 'm3-offline-credential-v1',
    accessToken: 'synthetic-access-old',
    refreshToken: 'synthetic-refresh-old',
    accessExpiresAt: new Date(Date.now() + 20_000),
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
    scopes: 'read_products',
  };
  let calls = 0;
  const seen = [];
  const transport = {
    async refresh({ shopDomain, refreshToken }) {
      assert.equal(shopDomain, domain);
      seen.push(refreshToken);
      calls++;
      if (calls === 1) throw { kind: 'network_or_timeout' };
      return {
        ...initial,
        accessToken: 'synthetic-access-new',
        refreshToken: 'synthetic-refresh-new',
        accessExpiresAt: new Date(Date.now() + 86_400_000),
      };
    },
  };
  try {
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain }));
    await credentialLifecycle(core).install({ shopId, installationGeneration: '1', pair: initial });
    const first = await refreshExpiringOfflineCredentials(credentialLifecycle(core), transport, input);
    assert.deepEqual(first, { kind: 'retryable', failure: 'network_or_timeout' });
    const concurrent = await Promise.all([
      refreshExpiringOfflineCredentials(credentialLifecycle(core), transport, input),
      refreshExpiringOfflineCredentials(credentialLifecycle(second), transport, input),
    ]);
    assert.deepEqual(seen, ['synthetic-refresh-old', 'synthetic-refresh-old']);
    assert.ok(concurrent.some((outcome) => outcome.kind === 'refreshed'));
    assert.ok(concurrent.some((outcome) => outcome.kind === 'busy' || outcome.kind === 'usable'));
    assert.equal((await core.credentials.acquire({ ...input, minimumRemainingMs: 0 })).kind, 'usable');
    await credentialLifecycle(core).install({ shopId, installationGeneration: '1', pair: initial });
    const claimed = await core.credentials.acquire({ ...input, minimumRemainingMs: 100_000 });
    assert.equal(claimed.kind, 'claimed');
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, shopId, '1'));
    assert.equal(
      await core.credentials.replaceClaim({
        shopId,
        installationGeneration: '1',
        claimId: claimed.claimId,
        credentialVersion: claimed.credentialVersion,
        pair: initial,
      }),
      'inactive',
    );
    assert.equal((await core.credentials.acquire(input)).kind, 'inactive');
  } finally {
    await Promise.all([core.close(), second.close()]);
  }
});
