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
    // Activation scrubs the outgoing private half; the public half and identity are retained.
    const publicHalf = () =>
      digest({ ...old, state: undefined, lastDay: undefined, privateEnvelope: undefined, wrappingKeyId: undefined });
    const retained = publicHalf();
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
    assert.equal(publicHalf(), retained);
    assert.equal(old.privateEnvelope, null);
    assert.equal(old.wrappingKeyId, null);
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

test('rotation proceeds when the published config still lists a destroyed key whose window closed (12 Nov 2026)', async () => {
  const f = await fixture();
  try {
    const today = f.ports.app.localDay(new Date(clockStart), 'Asia/Tokyo').ordinal;
    await f.lifecycle.createPending({ scope: f.scope, keyId: 1, firstDay: today - 40, lastDay: today - 10 });
    await f.lifecycle.activate(f.scope, 1);
    await f.lifecycle.createPending({ scope: f.scope, keyId: 2, firstDay: today - 1, lastDay: 0x7fffffff });
    await f.lifecycle.activate(f.scope, 2);
    // Published while key 1 was still retiring; the daily job destroyed it afterwards.
    f.setPublicValue((await f.lifecycle.desiredPublicConfig(f.scope)).value);
    required(f.rows.find((row) => row.id === 1)).state = 'destroyed';
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
    // The new publication drops the destroyed key.
    const published = JSON.parse(f.publicValue() ?? '{}') as { keys: { id: number }[] };
    assert.deepEqual(
      published.keys.map((key) => key.id),
      [2, 7],
    );
  } finally {
    await f.close();
  }
});

test('rotation still stops when a destroyed key with an open window is published', async () => {
  const f = await fixture();
  try {
    const today = f.ports.app.localDay(new Date(clockStart), 'Asia/Tokyo').ordinal;
    await f.lifecycle.createPending({ scope: f.scope, keyId: 1, firstDay: today - 40, lastDay: today + 5 });
    await f.lifecycle.activate(f.scope, 1);
    await f.lifecycle.createPending({ scope: f.scope, keyId: 2, firstDay: today - 1, lastDay: 0x7fffffff });
    await f.lifecycle.activate(f.scope, 2);
    f.setPublicValue((await f.lifecycle.desiredPublicConfig(f.scope)).value);
    required(f.rows.find((row) => row.id === 1)).state = 'destroyed';
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
    assert.equal(result.pendingCreateAttempted, false);
  } finally {
    await f.close();
  }
});

// #334: an owner rotation that stopped part-way, or an emergency epoch bump or revocation, leaves the
// stored config ahead of the published one. Quote readiness stops (exact comparison) until the
// owner rotation publishes it; these cover that the rotation can.
type Fixture = Awaited<ReturnType<typeof fixture>>;
const NON_EXPIRING = 0x7fffffff;
async function publishedActiveKey1(f: Fixture) {
  await f.lifecycle.createPending({ scope: f.scope, keyId: 1, firstDay: f.plan.firstDay - 1, lastDay: NON_EXPIRING });
  await f.lifecycle.activate(f.scope, 1);
  f.setPublicValue((await f.lifecycle.desiredPublicConfig(f.scope)).value);
}
async function issuanceReady(f: Fixture, keyId: number, at = new Date(clockStart)) {
  const desired = await f.lifecycle.desiredPublicConfig(f.scope, at);
  if (!f.ports.app.publishedConfigMatches(desired, f.publicValue())) return false;
  const acceptedDay = f.ports.app.localDay(at, 'Asia/Tokyo').ordinal;
  f.ports.app.requireIssuanceReady({ config: desired, keyId, acceptedDay });
  return true;
}
const interruptions: Record<string, (f: Fixture) => void> = {
  'the pending-key acknowledgement was lost': (f) => {
    const provision = f.ports.signer.provision;
    f.ports.signer.provision = async (input) => {
      await provision(input);
      throw Error('SYNTHETIC_SIGNER_TRANSPORT_ERROR');
    };
  },
  'it stopped before publishing': (f) => {
    const reserve = f.ports.journal.reserve;
    f.ports.journal.reserve = async (name) =>
      name === 'PUBLISH_CONFIG' ? { durable: false, operation: name } : reserve(name);
  },
  'the publication was not dispatched': (f) => {
    const execute = f.transport.execute;
    f.transport.execute = async (x) => {
      if (x.operation === 'set') throw new PublicationAdminError('network_or_timeout');
      return execute(x);
    };
  },
  'it stopped after publishing, before activation': (f) => {
    const reserve = f.ports.journal.reserve;
    f.ports.journal.reserve = async (name) =>
      name === 'ACTIVATE_KEY' ? { durable: false, operation: name } : reserve(name);
  },
};
for (const [name, interrupt] of Object.entries(interruptions))
  test(`an interrupted rotation resumes with the same plan when ${name}, without a second key`, async () => {
    const f = await fixture();
    try {
      await publishedActiveKey1(f);
      assert.equal(await issuanceReady(f, 1), true);
      const original = { journal: f.ports.journal, signer: f.ports.signer, execute: f.transport.execute };
      interrupt(f);
      const stopped = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(stopped.classification, 'SIGNING_KEY_CONFIG_STOPPED');
      assert.equal(required(f.rows.find((row) => row.id === 7)).state, 'pending');
      f.ports.signer = original.signer;
      f.transport.execute = original.execute;
      f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'resume-run'), f.plan);
      const resumed = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(resumed.classification, 'SIGNING_KEY_CONFIG_PROVISIONED');
      assert.equal(resumed.pendingCreateAttempted, false);
      assert.equal(f.provisioned.length, 1);
      assert.deepEqual(
        f.rows.map(({ id, state }) => ({ id, state })),
        [
          { id: 1, state: 'retiring' },
          { id: 7, state: 'active' },
        ],
      );
      assert.equal(await issuanceReady(f, 7), true);
    } finally {
      await f.close();
    }
  });

test('a rotation stopped after shortening the outgoing key blocks issuance until it is resumed', async () => {
  const f = await fixture();
  try {
    await publishedActiveKey1(f);
    f.plan.lastDay = NON_EXPIRING;
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'non-expiring-run'), f.plan);
    interruptions['it stopped before publishing']?.(f);
    await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    // The stored config now has the pending key and the shortened window; the published one has neither.
    assert.equal(await issuanceReady(f, 1), false);
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'resume-run'), f.plan);
    assert.equal(
      (await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports)).classification,
      'SIGNING_KEY_CONFIG_PROVISIONED',
    );
    assert.equal(await issuanceReady(f, 7), true);
    assert.equal(required(f.rows.find((row) => row.id === 7)).lastDay, NON_EXPIRING);
    // The tolerated differences and the replaced published value are journaled.
    const tolerance = JSON.parse(
      await readFile(join(f.directory, 'resume-run', 'published-config-tolerance.json'), 'utf8'),
    );
    assert.match(tolerance.publishedSha256, /^[0-9a-f]{64}$/);
    assert.equal(tolerance.compareDigest, 'a'.repeat(64));
    assert.deepEqual(tolerance.differences, [
      'pending key 7 not published',
      `key 1 published through day ${NON_EXPIRING}`,
    ]);
  } finally {
    await f.close();
  }
});

test('an exact published config journals no tolerance', async () => {
  const f = await fixture();
  try {
    await publishedActiveKey1(f);
    assert.equal(
      (await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports)).classification,
      'SIGNING_KEY_CONFIG_PROVISIONED',
    );
    await assert.rejects(readFile(join(f.directory, 'run', 'published-config-tolerance.json')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('a suspected leak after a stopped rotation: revoke both keys, bump the epoch, rotate to a third key', async () => {
  for (const bump of [true, false]) {
    const f = await fixture();
    try {
      await publishedActiveKey1(f);
      f.plan.keyId = 2;
      f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'stopped-run'), f.plan);
      interruptions['it stopped before publishing']?.(f);
      await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(required(f.rows.find((row) => row.id === 2)).state, 'pending');
      // The abandoned pending key can only be revoked; it was never published.
      await f.lifecycle.revoke(f.scope, 2, 'incident-2', 'abandoned pending key');
      if (bump) {
        await f.lifecycle.revoke(f.scope, 1, 'incident-1', 'suspected leak');
        await f.lifecycle.incrementEpoch({ scope: f.scope, commandKey: 'incident', requestDigest: 'e'.repeat(64) });
      }
      f.plan.keyId = 3;
      f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'incident-run'), f.plan);
      const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED', `bump ${bump}`);
      const published = JSON.parse(f.publicValue() ?? '{}');
      assert.equal(published.epoch, f.scope.authorizationEpoch);
      assert.deepEqual(
        published.keys.map(({ id, revoked }: { id: number; revoked: boolean }) => ({ id, revoked })),
        [
          { id: 1, revoked: bump },
          { id: 2, revoked: true },
          { id: 3, revoked: false },
        ],
      );
      assert.equal(await issuanceReady(f, 3), true);
      assert.equal(f.provisioned.length, 2);
    } finally {
      await f.close();
    }
  }
});

test('a key with the plan id that is not a pending key holding its envelope is never resumed', async () => {
  for (const state of ['revoked with envelope', 'pending without envelope'] as const) {
    const f = await fixture();
    try {
      await publishedActiveKey1(f);
      interruptions['it stopped before publishing']?.(f);
      await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      const row = required(f.rows.find((candidate) => candidate.id === 7));
      if (state === 'revoked with envelope') row.state = 'revoked';
      else row.wrappingKeyId = null;
      f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'resume-run'), f.plan);
      const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED', state);
      assert.equal(result.pendingCreateAcknowledged, false, state);
      assert.equal(result.publicConfigWriteAttempted, false, state);
      assert.equal(f.requests.includes('set'), false, state);
    } finally {
      await f.close();
    }
  }
});

test('resuming refuses a pending key with another window and unexplained published drift', async () => {
  for (const change of ['plan window', 'published drift'] as const) {
    const f = await fixture();
    try {
      await publishedActiveKey1(f);
      interruptions['it stopped before publishing']?.(f);
      await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      if (change === 'plan window') f.plan.lastDay += 1;
      else f.setPublicValue(f.publicValue()?.replace('"maxBuckets":32', '"maxBuckets":31') ?? null);
      f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'resume-run'), f.plan);
      const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED', change);
      assert.equal(result.publicConfigWriteAttempted, false, change);
      assert.equal(f.provisioned.length, 1, change);
    } finally {
      await f.close();
    }
  }
});

test('an active key cannot be resumed as a pending one', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports)).classification,
      'SIGNING_KEY_CONFIG_PROVISIONED',
    );
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'again-run'), f.plan);
    const again = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(again.classification, 'SIGNING_KEY_CONFIG_STOPPED');
    assert.equal(again.publicConfigWriteAttempted, false);
  } finally {
    await f.close();
  }
});

test('an emergency epoch bump or revocation stops issuance; the following rotation publishes it and issuance is ready again', async () => {
  for (const emergency of ['epoch bump', 'revocation', 'both'] as const) {
    const f = await fixture();
    try {
      await publishedActiveKey1(f);
      // Runbook order: revoke the leaked key and bump the epoch, then rotate.
      if (emergency !== 'epoch bump') await f.lifecycle.revoke(f.scope, 1, 'incident-1', 'suspected leak');
      if (emergency !== 'revocation')
        await f.lifecycle.incrementEpoch({ scope: f.scope, commandKey: 'incident-1', requestDigest: 'e'.repeat(64) });
      assert.equal(await issuanceReady(f, 1).catch(() => false), false, emergency);
      const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
      assert.equal(result.classification, 'SIGNING_KEY_CONFIG_PROVISIONED', emergency);
      const published = JSON.parse(f.publicValue() ?? '{}');
      assert.equal(published.epoch, f.scope.authorizationEpoch, emergency);
      assert.equal(published.keys[0].revoked, emergency !== 'epoch bump', emergency);
      assert.equal(await issuanceReady(f, 7), true, emergency);
    } finally {
      await f.close();
    }
  }
});

test('rotate, then the daily job destroys the outgoing key: issuance stays ready', async () => {
  const f = await fixture();
  try {
    await publishedActiveKey1(f);
    f.plan.lastDay = NON_EXPIRING;
    f.ports.journal = await reserveSigningProvisionRun(join(f.directory, 'rotation-run'), f.plan);
    assert.equal(
      (await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports)).classification,
      'SIGNING_KEY_CONFIG_PROVISIONED',
    );
    const outgoing = required(f.rows.find((row) => row.id === 1));
    // Window closed (last day before UTC day − 1); the worker destroys it and nothing republishes.
    const later = new Date((outgoing.lastDay + 2) * 86_400_000 + 3_600_000);
    outgoing.state = 'destroyed';
    assert.equal(await issuanceReady(f, 7, later), true);
  } finally {
    await f.close();
  }
});
