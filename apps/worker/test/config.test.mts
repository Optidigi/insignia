import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCredentialKeys, resolveWorkerHealthHost } from '../dist/config.js';

test('current and previous synthetic wrapping keys remain available by ID', () => {
  const prior = Buffer.alloc(32, 1).toString('base64');
  const current = Buffer.alloc(32, 2).toString('base64');
  const ring = loadCredentialKeys({
    INSIGNIA_CREDENTIAL_KEY_ID: 'current',
    INSIGNIA_CREDENTIAL_KEY_BASE64: current,
    INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON: JSON.stringify({ prior }),
  });
  assert(ring.keys.prior && ring.keys.current);
  assert.equal(ring.currentKeyId, 'current');
  assert.deepEqual(Buffer.from(ring.keys.prior), Buffer.alloc(32, 1));
  assert.deepEqual(Buffer.from(ring.keys.current), Buffer.alloc(32, 2));
  assert.throws(
    () =>
      loadCredentialKeys({
        INSIGNIA_CREDENTIAL_KEY_ID: 'current',
        INSIGNIA_CREDENTIAL_KEY_BASE64: current,
        INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON: JSON.stringify({ prior: 'not-a-key' }),
      }),
    /invalid/,
  );
});

test('the health listener stays on loopback unless the deployment opts into all interfaces', () => {
  assert.equal(resolveWorkerHealthHost({}), '127.0.0.1');
  assert.equal(resolveWorkerHealthHost({ INSIGNIA_WORKER_HEALTH_HOST: '' }), '127.0.0.1');
  assert.equal(resolveWorkerHealthHost({ INSIGNIA_WORKER_HEALTH_HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(resolveWorkerHealthHost({ INSIGNIA_WORKER_HEALTH_HOST: '0.0.0.0' }), '0.0.0.0');
  for (const value of ['localhost', '::', '10.0.7.3', ' 0.0.0.0', '0.0.0.0:4301'])
    assert.throws(() => resolveWorkerHealthHost({ INSIGNIA_WORKER_HEALTH_HOST: value }), /Invalid worker health host/);
});
