import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { provisionSigningKey, reserveSigningProvisionRun } from '../../apps/web/src/server/admin/signing-provision.ts';
import { required } from '../../apps/web/test/admin/support/fixtures.mts';
import { fixture } from '../../apps/web/test/admin/support/signing-owner-fixture.mts';

import { PublicationAdminError } from '../../packages/shopify/dist/index.js';

const clockStart = Date.parse('2026-10-11T12:00:00.000Z');
test('private reservation is durable and exclusive; repeating the run cannot authorize another attempt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-signing-control-'));
  try {
    const journal = await reserveSigningProvisionRun(join(directory, 'run'), {
      keyId: 7,
      firstDay: 20000,
      lastDay: 20002,
    });
    await journal.reserve('CREATE_PENDING');
    const reservation: unknown = JSON.parse(await readFile(join(directory, 'run', '001-CREATE_PENDING.json'), 'utf8'));
    assert(reservation && typeof reservation === 'object' && 'operation' in reservation);
    assert.equal(reservation.operation, 'CREATE_PENDING');
    await assert.rejects(
      reserveSigningProvisionRun(join(directory, 'run'), { keyId: 7, firstDay: 20000, lastDay: 20002 }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a private reservation cannot authorize a different key plan', async () => {
  const f = await fixture();
  try {
    f.plan.keyId = 8;
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
    assert.equal(result.pendingCreateAttempted, false);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});
const failures: Record<string, (f: Awaited<ReturnType<typeof fixture>>) => void> = {
  'wrong current generation': (f) => {
    f.scope.installationGeneration = '2';
  },
  'expired identity': (f) => {
    f.identity.verify = async () => ({
      shop: 'insignia-rewrite-dev.myshopify.com',
      staffId: '1',
      sessionId: 'x',
      expiresAtMs: clockStart,
    });
  },
  'wrong provider installation': (f) => {
    const read = f.identity.readInstallation;
    f.identity.readInstallation = async (...args) => ({
      ...(await read(...args)),
      installationId: 'gid://shopify/AppInstallation/999',
    });
  },
  'staff cannot edit': (f) => {
    const exchange = f.identity.exchangeOnline;
    f.identity.exchangeOnline = async (...args) => ({ ...(await exchange(...args)), userScopes: [] });
  },
  'unknown trusted release': (f) => {
    f.ports.core = {
      ...f.ports.core,
      trustedReleaseRecords: { ...f.ports.core.trustedReleaseRecords, read: async () => null },
    };
  },
  'wrong trusted version': (f) => {
    f.record.expectedBuild.appVersionRef = '1158986629121';
  },
  'stale Function observation': (f) => {
    f.observed.observedAt = new Date(clockStart - 30001).toISOString();
  },
  'first day is future': (f) => {
    f.plan.firstDay += 1;
  },
  'missing third calendar day': (f) => {
    f.plan.lastDay -= 1;
  },
  'unknown prior public config': (f) => {
    f.setPublicValue('{"unknown":true}');
  },
};
for (const [name, change] of Object.entries(failures))
  test(`no key creation or publication for ${name}`, async () => {
    const f = await fixture();
    try {
      change(f);
      if (name === 'first day is future' || name === 'missing third calendar day')
        f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'window-run'), f.plan);
      const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
      assert.equal(result.pendingCreateAttempted, false);
      assert.equal(result.publicConfigWriteAttempted, false);
      assert.equal(result.retryAuthorized, false);
    } finally {
      await f.close();
    }
  });
test('generation drift after publication cannot activate the pending key', async () => {
  const f = await fixture();
  const execute = f.transport.execute;
  try {
    f.transport.execute = async (x) => {
      const value = await execute(x);
      if (x.operation === 'set') f.scope.installationGeneration = '2';
      return value;
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAcknowledged, true);
    assert.equal(result.activationAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
  } finally {
    await f.close();
  }
});
test('unknown pending-key commit never causes a new seed or publication attempt', async () => {
  const f = await fixture();
  const provision = f.ports.signer.provision;
  try {
    // The signer committed the pending key but its acknowledgement was lost.
    f.ports.signer.provision = async (input) => {
      await provision(input);
      throw Error('SYNTHETIC_SIGNER_TRANSPORT_ERROR');
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.ambiguousOperation, 'CREATE_PENDING');
    assert.equal(result.pendingCreateAcknowledged, false);
    assert.equal(result.publicConfigWriteAttempted, false);
    assert.equal(f.rows.length, 1);
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('unknown activation commit preserves uncertainty and forbids retry', async () => {
  const f = await fixture();
  const activate = f.ports.core.signingKeys.activate;
  try {
    f.ports.core.signingKeys.activate = async (...args) => {
      await activate(...args);
      throw Error('SYNTHETIC_PRIVATE_DB_ERROR');
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.ambiguousOperation, 'ACTIVATE_KEY');
    assert.equal(result.activationAcknowledged, false);
    assert.equal(required(f.rows[0]).state, 'active');
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('CAS conflict keeps generated key pending and never repeats provider mutation', async () => {
  const f = await fixture();
  const execute = f.transport.execute;
  try {
    f.transport.execute = async (x) =>
      x.operation === 'set'
        ? {
            status: 200,
            body: { data: { metafieldsSet: { userErrors: [{ code: 'INVALID_COMPARE_DIGEST' }], metafields: [] } } },
          }
        : execute(x);
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAcknowledged, false);
    assert.equal(result.activationAttempted, false);
    assert.equal(result.ambiguousOperation, null);
    assert.equal(required(f.rows[0]).state, 'pending');
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('lost publication acknowledgement may settle through exact read only, with no second mutation', async () => {
  const f = await fixture();
  const execute = f.transport.execute;
  try {
    f.transport.execute = async (x) => {
      const value = await execute(x);
      if (x.operation === 'set') throw new PublicationAdminError('network_or_timeout');
      return value;
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
    assert.equal(result.ambiguousPublicationSettledByRead, true);
    assert.equal(f.requests.filter((x) => x === 'set').length, 1);
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('unsettled publication cannot activate or retry its pending key', async () => {
  const f = await fixture();
  const execute = f.transport.execute;
  let sets = 0;
  try {
    f.transport.execute = async (x) => {
      if (x.operation === 'set') {
        sets++;
        throw new PublicationAdminError('network_or_timeout');
      }
      return execute(x);
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.ambiguousOperation, 'PUBLISH_CONFIG');
    assert.equal(result.activationAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
    assert.equal(sets, 1);
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('final provider drift prevents activation after acknowledged publication', async () => {
  const f = await fixture();
  const read = f.identity.readInstallation;
  let reads = 0;
  try {
    f.identity.readInstallation = async (...args) => {
      reads++;
      if (reads === 2) f.setPublicValue('{"drift":true}');
      return read(...args);
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAcknowledged, true);
    assert.equal(result.activationAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
  } finally {
    await f.close();
  }
});
test('trusted local midnight cannot broaden the reserved validity window', async () => {
  const initial = Date.parse('2026-10-11T14:59:59.000Z');
  const f = await fixture({ initial });
  const execute = f.transport.execute;
  try {
    f.transport.execute = async (x) => {
      const result = await execute(x);
      if (x.operation === 'set') f.clock(initial + 2000);
      return result;
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAcknowledged, true);
    assert.equal(result.activationAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
  } finally {
    await f.close();
  }
});
test('failed durable publication reservation admits no provider write', async () => {
  const f = await fixture();
  const reserve = f.ports.journal.reserve;
  try {
    f.ports.journal.reserve = async (name) =>
      name === 'PUBLISH_CONFIG' ? { durable: false, operation: name } : reserve(name);
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
    assert.equal(f.requests.includes('set'), false);
  } finally {
    await f.close();
  }
});
test('existing lifecycle publishes exact config and activates only after qualified readback; grants remain private', async () => {
  const f = await fixture();
  try {
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
    assert.equal(required(f.rows[0]).state, 'active');
    assert.equal(result.quoteIssuanceAuthorized, false);
    assert.equal(f.publicValue(), (await f.lifecycle.desiredPublicConfig(f.scope)).value);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_ONLINE_SECRET'), false);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_ID_TOKEN'), false);
    assert.equal(JSON.stringify(result).includes('privateEnvelope'), false);
  } finally {
    await f.close();
  }
});
test('a pending-key wait cannot carry expired release authority into provider publication', async () => {
  const f = await fixture();
  try {
    f.record.record.attestation.expiresAt = new Date(clockStart + 5000).toISOString();
    const provision = f.ports.signer.provision;
    f.ports.signer.provision = async (x) => {
      const created = await provision(x);
      f.clock(clockStart + 6000);
      return created;
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
    assert.equal(result.pendingCreateAcknowledged, true);
    assert.equal(result.publicConfigWriteAttempted, false);
    assert.equal(required(f.rows[0]).state, 'pending');
  } finally {
    await f.close();
  }
});

test('retained key rotation publishes both keys by CAS before activating fresh key 2', async () => {
  const f = await fixture();
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    await f.lifecycle.createPending({
      scope: f.scope,
      keyId: 1,
      firstDay: f.plan.firstDay - 1,
      lastDay: f.plan.lastDay - 1,
    });
    await f.lifecycle.activate(f.scope, 1);
    const old = required(f.rows.find((row) => row.id === 1));
    const retained = digest({ ...old, state: undefined, lastDay: undefined });
    // The fixture shop is in Asia/Tokyo; the retiring key's window ends 3 shop days after rotation.
    const retireThrough = f.ports.app.localDay(new Date(clockStart), 'Asia/Tokyo').ordinal + 3;
    const originalScope = { ...f.scope };
    const prior = await f.lifecycle.desiredPublicConfig(f.scope);
    assert.throws(
      () => f.ports.app.requireIssuanceReady({ config: prior, keyId: 1, acceptedDay: f.plan.firstDay }),
      /not issuance ready/,
    );
    assert.doesNotThrow(() =>
      f.ports.app.requireIssuanceReady({ config: prior, keyId: 1, acceptedDay: f.plan.firstDay - 1 }),
    );
    f.setPublicValue(prior.value);
    f.plan.keyId = 2;
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'rotation-run'), f.plan);
    const execute = f.transport.execute;
    let published = false,
      readBack = false;
    f.transport.execute = async (request) => {
      if (request.operation === 'set') {
        assert.equal(old.state, 'active');
        const pending = required(f.rows.find((row) => row.id === 2));
        assert.equal(pending.state, 'pending');
        assert.notEqual(pending.publicKeyFingerprint, old.publicKeyFingerprint);
        const fields = request.variables.metafields as { value: string; compareDigest: string }[];
        const field = required(fields[0]);
        assert.equal(field.compareDigest, 'a'.repeat(64));
        const config = JSON.parse(field.value);
        assert.equal(config.epoch, originalScope.authorizationEpoch);
        assert.equal(config.generationHex, originalScope.authorizationGeneration.replaceAll('-', ''));
        assert.deepEqual(config.keys, [
          ...JSON.parse(prior.value).keys.map((key: { id: number; lastDay: number }) =>
            key.id === 1 ? { ...key, lastDay: Math.min(key.lastDay, retireThrough) } : key,
          ),
          {
            id: 2,
            publicHex: Buffer.from(pending.publicKey).toString('hex'),
            revoked: false,
            firstDay: f.plan.firstDay,
            lastDay: f.plan.lastDay,
          },
        ]);
        published = true;
      } else if (published) readBack = true;
      return execute(request);
    };
    const activate = f.ports.core.signingKeys.activate;
    f.ports.core.signingKeys.activate = async (...args) => {
      assert.equal(published && readBack, true);
      assert.equal(old.state, 'active');
      return activate(...args);
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
    assert.equal(result.pendingCreateAcknowledged, true);
    assert.equal(result.publicConfigWriteAcknowledged, true);
    assert.equal(result.activationAcknowledged, true);
    assert.equal(result.retryAuthorized, false);
    assert.equal(result.quoteIssuanceAuthorized, false);
    assert.equal(f.requests.filter((operation) => operation === 'set').length, 1);
    assert.equal(old.state, 'retiring');
    assert.equal(digest({ ...old, state: undefined, lastDay: undefined }), retained);
    assert.equal(old.lastDay, Math.min(f.plan.lastDay - 1, retireThrough));
    assert.deepEqual(f.scope, originalScope);
    assert.deepEqual(
      f.rows.filter((row) => row.state === 'active').map((row) => row.id),
      [2],
    );
    const current = await f.lifecycle.desiredPublicConfig(f.scope);
    assert.equal(f.publicValue(), current.value);
    assert.doesNotThrow(() =>
      f.ports.app.requireIssuanceReady({ config: current, keyId: 2, acceptedDay: f.plan.firstDay }),
    );
  } finally {
    await f.close();
  }
});

test('non-expiring rotation shortens the retiring key before publication and keeps the new key open-ended', async () => {
  const f = await fixture();
  const NON_EXPIRING = f.ports.app.NON_EXPIRING_LAST_DAY;
  try {
    await f.lifecycle.createPending({ scope: f.scope, keyId: 1, firstDay: f.plan.firstDay - 1, lastDay: NON_EXPIRING });
    await f.lifecycle.activate(f.scope, 1);
    f.setPublicValue((await f.lifecycle.desiredPublicConfig(f.scope)).value);
    f.plan.keyId = 2;
    f.plan.lastDay = NON_EXPIRING;
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'non-expiring-run'), f.plan);
    const today = f.ports.app.localDay(new Date(clockStart), 'Asia/Tokyo').ordinal;
    const execute = f.transport.execute;
    let publishedKeys: { id: number; lastDay: number }[] = [];
    f.transport.execute = async (request) => {
      if (request.operation === 'set') {
        const old = required(f.rows.find((row) => row.id === 1));
        // The retirement window is stored before publication, while key 1 still signs.
        assert.equal(old.state, 'active');
        assert.equal(old.lastDay, today + 3);
        const fields = request.variables.metafields as { value: string }[];
        publishedKeys = JSON.parse(required(fields[0]).value).keys;
      }
      return execute(request);
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
    assert.deepEqual(
      publishedKeys.map(({ id, lastDay }) => ({ id, lastDay })),
      [
        { id: 1, lastDay: today + 3 },
        { id: 2, lastDay: NON_EXPIRING },
      ],
    );
    assert.deepEqual(
      f.rows.map(({ id, state, lastDay }) => ({ id, state, lastDay })),
      [
        { id: 1, state: 'retiring', lastDay: today + 3 },
        { id: 2, state: 'active', lastDay: NON_EXPIRING },
      ],
    );
    assert.equal(f.publicValue(), (await f.lifecycle.desiredPublicConfig(f.scope)).value);
    // A sentinel key is issuance ready on any later day; the retired key is not.
    const current = await f.lifecycle.desiredPublicConfig(f.scope);
    assert.doesNotThrow(() =>
      f.ports.app.requireIssuanceReady({ config: current, keyId: 2, acceptedDay: today + 10_000 }),
    );
  } finally {
    await f.close();
  }
});
