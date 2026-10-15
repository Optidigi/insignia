import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerUsageRuntime } from '../dist/usage-runtime.js';

const enabled = {
  INSIGNIA_M9_QUALIFICATION_ENABLED: '1',
  INSIGNIA_M9_TENANT_SHOP_ID: 'tenant',
  INSIGNIA_M9_INSTALLATION_GENERATION: '1',
  INSIGNIA_SHOPIFY_APP_ID: 'gid://shopify/App/123',
};
function fixture(isTest = true) {
  const calls = [],
    rows = new Map();
  const scope = { shopId: 'tenant', installationGeneration: '1' };
  const core = {
    tenants: {
      async getUsageInstallationWindow() {
        throw new Error('must not read installation');
      },
    },
    usageLedger: {
      async selectPending(actual) {
        assert.deepEqual(actual, scope);
        return { purchases: [{ ...scope, purchaseId: 'purchase' }], exhausted: true, nextCursor: null };
      },
      async record(actual, input) {
        calls.push(input);
        assert.deepEqual(actual, scope);
        if (!rows.has(input.purchaseId))
          rows.set(input.purchaseId, {
            ...scope,
            purchaseId: input.purchaseId,
            orderId: 'order',
            decision: isTest
              ? { kind: 'EXCLUDED', units: 0, reason: 'TEST_ORDER' }
              : { kind: 'UNRESOLVED', units: 0, reason: 'HISTORY_UNVERIFIED' },
          });
        return rows.get(input.purchaseId);
      },
    },
    usageDeliveryIntents: {
      async prepare() {
        throw new Error('must not stage');
      },
    },
  };
  return { core, calls, rows };
}
test('usage runtime is default off and rejects invalid enabled configuration', () => {
  assert.equal(createWorkerUsageRuntime({ env: {}, core: {} }), undefined);
  for (const env of [
    { ...enabled, INSIGNIA_M9_QUALIFICATION_ENABLED: 'true' },
    { ...enabled, INSIGNIA_M9_TENANT_SHOP_ID: '' },
    { ...enabled, INSIGNIA_M9_INSTALLATION_GENERATION: '0' },
    { ...enabled, INSIGNIA_SHOPIFY_APP_ID: 'wrong' },
  ])
    assert.throws(() => createWorkerUsageRuntime({ env, core: {} }), /USAGE_RUNTIME_INVALID/);
});

test('enabled runtime excludes immutable test facts repeatedly without source or staging authority', async () => {
  const f = fixture();
  const runtime = createWorkerUsageRuntime({ env: enabled, core: f.core });
  assert.deepEqual(await runtime.runOnce(), { processed: 1, staged: 0, held: 1, failed: 0 });
  await runtime.stop();
  const reopened = createWorkerUsageRuntime({ env: enabled, core: f.core });
  await reopened.runOnce();
  assert.equal(f.rows.size, 1);
  assert.deepEqual(f.rows.get('purchase').decision, { kind: 'EXCLUDED', units: 0, reason: 'TEST_ORDER' });
  assert.equal(f.calls.length, 2);
  await reopened.stop();
});

test('paid unqualified facts stay held with no installation or provider source reads', async () => {
  const f = fixture(false);
  const runtime = createWorkerUsageRuntime({ env: enabled, core: f.core });
  assert.deepEqual(await runtime.runOnce(), { processed: 1, staged: 0, held: 1, failed: 0 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.rows.get('purchase').decision, { kind: 'UNRESOLVED', units: 0, reason: 'HISTORY_UNVERIFIED' });
  await runtime.stop();
});
