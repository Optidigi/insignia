import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createSigningOwnerAction } from '../../src/server/admin/signing-owner-action.ts';
import { acceptedRuntimeIdentity, fixture } from './support/signing-owner-fixture.mjs';

async function bound() {
  const f = await fixture();
  const binding = {
    shop: 'insignia-rewrite-dev.myshopify.com',
    shopId: 'gid://shopify/Shop/123',
    installationId: 'gid://shopify/AppInstallation/321',
    tenantShopId: f.scope.shopId,
    installationGeneration: '1',
    authorizationGeneration: f.scope.authorizationGeneration,
    authorizationEpoch: 0,
  };
  const actor = {
    ...binding,
    canRead: true,
    canEdit: true,
    staffId: '1',
    sessionId: 'synthetic-session',
    expiresAtMs: f.ports.now().getTime() + 60000,
  };
  const config = {
    binding,
    plan: f.plan,
    directory: join(f.directory, 'owner-attempt'),
    ring: f.ports.ring,
  };
  return { ...f, config, actor, action: createSigningOwnerAction(config, f.ports) };
}
async function settled(f) {
  for (let n = 0; n < 200; n++) {
    const status = await f.action.status(f.actor);
    if (status.state !== 'PENDING') return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Synthetic operator did not settle');
}

test('fixed owner action completes original crypto/lifecycle/readback gates exactly once', async () => {
  const f = await bound();
  try {
    assert.equal((await f.action.status(f.actor)).state, 'READY');
    assert.equal((await f.action.start(f.actor, 'synthetic-token')).state, 'PENDING');
    assert.notEqual((await f.action.start(f.actor, 'synthetic-token')).state, 'READY');
    assert.equal((await settled(f)).state, 'PROVISIONED');
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0].state, 'active');
    const priorRequests = f.requests.length;
    assert.equal((await f.action.start(f.actor, 'synthetic-token')).state, 'PROVISIONED');
    assert.equal(f.requests.length, priorRequests);
    assert.equal((await f.action.status(f.actor)).quoteIssuanceAuthorized, false);
  } finally {
    await f.close();
  }
});

test('internal publication preparation settles signing once and reuses the durable result', async () => {
  const f = await bound();
  try {
    assert.equal((await f.action.prepare(f.actor, 'synthetic-token')).state, 'PROVISIONED');
    assert.equal(f.rows.length, 1);
    const attempts = f.requests.length;
    assert.equal((await f.action.prepare(f.actor, 'different-synthetic-token')).state, 'PROVISIONED');
    assert.equal(f.requests.length, attempts);
    assert.equal((await f.action.status(f.actor)).quoteIssuanceAuthorized, false);
  } finally {
    await f.close();
  }
});

test('a foreign runtime app cannot use the private signing capability or reserve its attempt', async () => {
  const f = await bound();
  try {
    assert.throws(() =>
      createSigningOwnerAction(f.config, {
        ...f.ports,
        runtimeIdentity: {
          ...acceptedRuntimeIdentity,
          appClientId: 'foreign-client',
        },
      }),
    );
    assert.equal(f.rows.length, 0);
    await assert.rejects(readFile(join(f.config.directory, 'owner-binding.json')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('original dotted current and previous wrapping-key IDs remain usable through signing lifecycle', async () => {
  const f = await bound();
  try {
    f.config.ring = {
      currentKeyId: 'synthetic.wrap.current',
      keys: { 'synthetic.wrap.current': Buffer.alloc(32, 7), 'synthetic.wrap.previous': Buffer.alloc(32, 8) },
    };
    f.action = createSigningOwnerAction(f.config, f.ports);
    assert.equal((await f.action.start(f.actor, 'synthetic-token')).state, 'PENDING');
    assert.equal((await settled(f)).state, 'PROVISIONED');
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0].state, 'active');
    assert.deepEqual(f.config.ring.keys['synthetic.wrap.current'], Buffer.alloc(32, 7));
    assert.deepEqual(f.config.ring.keys['synthetic.wrap.previous'], Buffer.alloc(32, 8));
    for (const id of ['.invalid', 'x'.repeat(65)]) {
      assert.throws(() =>
        createSigningOwnerAction(
          { ...f.config, ring: { currentKeyId: id, keys: { [id]: Buffer.alloc(32, 1) } } },
          f.ports,
        ),
      );
    }
  } finally {
    await f.close();
  }
});

test('drifted native Function observation stays stopped and a fresh browser click cannot restart it', async () => {
  const f = await bound();
  try {
    f.observed.transform.inputQuerySha256 = 'a'.repeat(64);
    await f.action.start(f.actor, 'synthetic-token');
    assert.equal((await settled(f)).state, 'STOPPED');
    assert.equal(f.rows.length, 0);
    assert.equal((await f.action.start(f.actor, 'different-synthetic-token')).state, 'STOPPED');
  } finally {
    await f.close();
  }
});

test('a partial or hostile result cannot become a qualified owner status', async () => {
  const f = await bound();
  try {
    f.observed.transform.inputQuerySha256 = 'a'.repeat(64);
    await f.action.start(f.actor, 'synthetic-token');
    await settled(f);
    await writeFile(
      join(f.config.directory, 'result.json'),
      JSON.stringify({
        classification: 'SIGNING_KEY_CONFIG_PROVISIONED',
        keyId: 7,
        retryAuthorized: false,
        quoteIssuanceAuthorized: false,
        receiptDurable: true,
        activationAcknowledged: true,
        publicConfigWriteAcknowledged: true,
        token: 'synthetic-secret',
      }),
    );
    assert.notEqual((await f.action.status(f.actor)).state, 'PROVISIONED');
  } finally {
    await f.close();
  }
});

test('missing or expired trusted release keeps setup waiting without consuming its attempt', async () => {
  const f = await bound();
  try {
    f.record.record.attestation.expiresAt = f.ports.now().toISOString();
    assert.equal((await f.action.status(f.actor)).state, 'WAITING_FOR_VERIFICATION');
    assert.equal((await f.action.start(f.actor, 'synthetic-token')).state, 'WAITING_FOR_VERIFICATION');
    assert.equal(f.rows.length, 0);
    await assert.rejects(readFile(join(f.config.directory, '000-reservation.json')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});
test('an ambiguous public-config write remains uncertain without another mutation or activation', async () => {
  const f = await bound();
  try {
    const original = f.transport.execute;
    let writes = 0;
    f.transport.execute = async (request) => {
      if (request.operation === 'set') {
        writes++;
        throw new Error('SYNTHETIC_PROVIDER_SECRET');
      }
      return original(request);
    };
    const status = await f.action.prepare(f.actor, 'synthetic-token');
    assert.equal(status.state, 'UNCERTAIN');
    assert.equal(writes, 1);
    assert.equal(f.rows[0].state, 'pending');
    assert.equal((await f.action.prepare(f.actor, 'new-synthetic-token')).state, 'UNCERTAIN');
    assert.equal(writes, 1);
    assert.ok(!JSON.stringify(status).includes('SYNTHETIC_PROVIDER_SECRET'));
  } finally {
    await f.close();
  }
});

test('HTTP refuses foreign origin, missing authentication and browser plan inputs before reserving', async (t) => {
  const f = await bound();
  t.mock.timers.enable({ apis: ['Date'], now: f.ports.now() });
  try {
    const origin = 'https://insignia-app.optidigi.nl';
    const services = { appOrigin: origin, authenticate: async () => f.actor, signingOwner: f.action };
    const request = (body, headers = {}) =>
      new Request(`${origin}/api/admin/signing`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synthetic-token',
          Origin: origin,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    for (const [body, headers, status] of [
      [{ action: 'setup' }, { Authorization: '' }, 401],
      [{ action: 'setup' }, { Origin: 'https://foreign.example' }, 403],
      [{ action: 'setup', keyId: 9 }, {}, 422],
      [{ action: 'setup', ring: {} }, {}, 422],
      [{ action: 'setup', installationGeneration: '2' }, {}, 422],
      [{ action: 'setup', activeAppVersionRef: 'fake' }, {}, 422],
    ]) {
      assert.equal((await handleAdminRequest(request(body, headers), services, { kind: 'signing' })).status, status);
    }
    assert.equal((await f.action.status(f.actor)).state, 'READY');
    assert.equal((await handleAdminRequest(request({ action: 'setup' }), services, { kind: 'signing' })).status, 202);
    await settled(f);
  } finally {
    await f.close();
  }
});

test('current authorization generation or provider installation mismatch cannot create a key', async () => {
  const f = await bound();
  try {
    f.scope.authorizationEpoch = 1;
    await assert.rejects(f.action.start(f.actor, 'synthetic-token'));
    f.scope.authorizationEpoch = 0;
    f.identity.readInstallation = async () => ({
      shop: f.actor.shop,
      shopId: f.actor.shopId,
      installationId: 'gid://shopify/AppInstallation/999',
    });
    await f.action.start(f.actor, 'synthetic-token');
    assert.equal((await settled(f)).state, 'STOPPED');
    assert.equal(f.rows.length, 0);
  } finally {
    await f.close();
  }
});

test('restart after a reserved incomplete run is uncertain and cannot start another operator', async () => {
  const f = await bound();
  let release;
  let entered;
  const verification = new Promise((resolve) => {
    release = resolve;
  });
  const verificationEntered = new Promise((resolve) => {
    entered = resolve;
  });
  try {
    f.identity.verify = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      entered();
      return verification;
    };
    await f.action.start(f.actor, 'synthetic-token');
    await verificationEntered;
    const restarted = createSigningOwnerAction(f.config, f.ports);
    assert.equal((await restarted.status(f.actor)).state, 'UNCERTAIN');
    assert.equal((await restarted.start(f.actor, 'new-synthetic-token')).state, 'UNCERTAIN');
    assert.equal(f.rows.length, 0);
  } finally {
    release({ shop: 'wrong.myshopify.com' });
    await settled(f);
    await f.close();
  }
});

test('nonregular, wrong-mode and hostile closed status files cannot block or qualify status', async () => {
  const f = await bound();
  try {
    await f.action.start(f.actor, 'synthetic-token');
    assert.equal((await settled(f)).state, 'PROVISIONED');
    const path = join(f.config.directory, 'owner-result.json');
    await writeFile(
      path,
      '{"version":"m5-signing-owner-action-v1","state":"PROVISIONED","actionAvailable":false,"retryAuthorized":false,"quoteIssuanceAuthorized":false,"token":"synthetic"}',
    );
    assert.equal((await f.action.status(f.actor)).state, 'UNCERTAIN');
    await writeFile(path, '{}');
    await chmod(path, 0o644);
    assert.equal((await f.action.status(f.actor)).state, 'UNCERTAIN');
    await rm(path);
    assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', path]).status, 0);
    const result = await Promise.race([
      f.action.status(f.actor),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('FIFO blocked status')), 500)),
    ]);
    assert.equal(result.state, 'UNCERTAIN');
  } finally {
    await f.close();
  }
});

test('an unbound installation never reserves or invokes signing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signing-owner-'));
  try {
    const config = {
      directory: join(directory, 'attempt'),
      plan: { keyId: 7, firstDay: 20000, lastDay: 20002 },
      binding: {
        shop: 'insignia-rewrite-dev.myshopify.com',
        shopId: 'gid://shopify/Shop/123',
        installationId: 'gid://shopify/AppInstallation/321',
        tenantShopId: 'tenant',
        installationGeneration: '1',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
      },
      ring: { currentKeyId: 'test', keys: { test: Buffer.alloc(32, 1) } },
    };
    const action = createSigningOwnerAction(config, {
      runtimeIdentity: acceptedRuntimeIdentity,
    });
    const actor = {
      ...config.binding,
      installationGeneration: '2',
      canRead: true,
      canEdit: true,
      staffId: '1',
      sessionId: 'session',
      expiresAtMs: Date.now() + 60000,
    };
    await assert.rejects(action.start(actor, 'synthetic'), /unavailable/);
    await assert.rejects(action.status(actor), /unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
