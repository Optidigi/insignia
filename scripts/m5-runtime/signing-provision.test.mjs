import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { provisionSigningKey, reserveSigningProvisionRun } from '../../apps/web/src/server/admin/signing-provision.ts';
import { fixture } from '../../apps/web/test/admin/support/signing-owner-fixture.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { PublicationAdminError } = await import(pathToFileURL(require.resolve('@insignia/shopify')));
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
    assert.equal(
      JSON.parse(await readFile(join(directory, 'run', '001-CREATE_PENDING.json'))).operation,
      'CREATE_PENDING',
    );
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
const failures = {
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
    f.identity.readInstallation = async () => ({
      ...(await read()),
      installationId: 'gid://shopify/AppInstallation/999',
    });
  },
  'staff cannot edit': (f) => {
    const exchange = f.identity.exchangeOnline;
    f.identity.exchangeOnline = async () => ({ ...(await exchange()), userScopes: [] });
  },
  'unknown trusted release': (f) => {
    f.ports.core.trustedReleaseRecords.read = async () => null;
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
    assert.equal(f.rows[0].state, 'pending');
  } finally {
    await f.close();
  }
});
test('unknown pending-key commit never causes a new seed or publication attempt', async () => {
  const f = await fixture();
  const create = f.ports.core.signingKeys.createPending;
  try {
    f.ports.core.signingKeys.createPending = async (input) => {
      await create(input);
      throw Error('SYNTHETIC_PRIVATE_DB_ERROR');
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
    assert.equal(f.rows[0].state, 'active');
    assert.equal(result.retryAuthorized, false);
  } finally {
    await f.close();
  }
});
test('executable rejects unknown secret-bearing fields with safe output before loading runtime', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./signing-provision.mjs', import.meta.url))], {
    input: JSON.stringify({ token: 'SYNTHETIC_PRIVATE_INPUT' }),
    env: {},
    timeout: 5000,
    maxBuffer: 4096,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stderr.toString(), '');
  const result = JSON.parse(child.stdout.toString());
  assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
  assert.equal(result.retryAuthorized, false);
  assert.equal(child.stdout.toString().includes('SYNTHETIC_PRIVATE_INPUT'), false);
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
    assert.equal(f.rows[0].state, 'pending');
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
    assert.equal(f.rows[0].state, 'pending');
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
    f.identity.readInstallation = async () => {
      reads++;
      if (reads === 2) f.setPublicValue('{"drift":true}');
      return read();
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAcknowledged, true);
    assert.equal(result.activationAttempted, false);
    assert.equal(f.rows[0].state, 'pending');
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
    assert.equal(f.rows[0].state, 'pending');
  } finally {
    await f.close();
  }
});
test('failed durable publication reservation admits no provider write', async () => {
  const f = await fixture();
  const reserve = f.ports.journal.reserve;
  try {
    f.ports.journal.reserve = async (name) => (name === 'PUBLISH_CONFIG' ? { durable: false } : reserve(name));
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.publicConfigWriteAttempted, false);
    assert.equal(f.rows[0].state, 'pending');
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
    assert.equal(f.rows[0].state, 'active');
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
    const create = f.ports.core.signingKeys.createPending;
    f.ports.core.signingKeys.createPending = async (x) => {
      await create(x);
      f.clock(clockStart + 6000);
    };
    const result = await provisionSigningKey(f.plan, 'SYNTHETIC_ID_TOKEN', f.ports);
    assert.equal(result.classification, 'SIGNING_KEY_CONFIG_STOPPED');
    assert.equal(result.pendingCreateAcknowledged, true);
    assert.equal(result.publicConfigWriteAttempted, false);
    assert.equal(f.rows[0].state, 'pending');
  } finally {
    await f.close();
  }
});
