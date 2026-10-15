import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerUsageReconciliation } from '../dist/usage-reconciliation.js';

const scope = { shopId: 'tenant', installationGeneration: '1' };
const id = '00000000-0000-4000-8000-000000000001';
const binding = {
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/2',
  meterHandle: 'meter',
  policy: { id: 'approved', version: '1' },
};
function fixture() {
  const f = {
    pages: [],
    sources: 0,
    prepares: [],
    bindings: 0,
    decision: { kind: 'ELIGIBLE', units: 1 },
    fail: false,
    binding,
    wrongScope: false,
  };
  f.options = {
    scope,
    pageSize: 1,
    core: {
      usageLedger: {
        selectPending: async (s, page) => {
          f.pages.push({ ...page });
          assert.deepEqual(s, scope);
          return {
            purchases: [{ ...scope, shopId: f.wrongScope ? 'another' : scope.shopId, purchaseId: id }],
            nextCursor: id,
            exhausted: true,
          };
        },
        record: async (s, input) => ({ ...s, purchaseId: input.purchaseId, decision: f.decision }),
      },
      usageDeliveryIntents: {
        prepare: async (s, input) => {
          f.prepares.push(input);
          if (f.fail) throw Error('PRIVATE_PROVIDER_DETAIL');
          return { kind: 'STAGED', intent: { ...s, purchaseId: input.purchaseId } };
        },
      },
    },
    loadCurrentCycleInput: async () => {
      f.sources++;
      throw Error('not needed for durable terminal');
    },
    resolveBinding: async () => {
      f.bindings++;
      return f.binding;
    },
  };
  return f;
}
test('recovers eligible durable facts after restart with stable scope and no provider reload', async () => {
  const f = fixture();
  const runner = createWorkerUsageReconciliation(f.options);
  assert.deepEqual(await runner.runOnce(), { processed: 1, staged: 1, held: 0, failed: 0 });
  await runner.runOnce();
  await createWorkerUsageReconciliation(f.options).runOnce();
  assert.equal(f.sources, 0);
  assert.equal(f.prepares.length, 3);
  assert.ok(f.pages.every((page) => page.afterPurchaseId === null));
});
test('advances past held/failing facts, wraps exhausted scan and holds missing binding', async () => {
  const f = fixture();
  let page = 0;
  f.options.core.usageLedger.selectPending = async (_scope, cursor) => {
    f.pages.push(cursor);
    return { purchases: [{ ...scope, purchaseId: id }], nextCursor: id, exhausted: ++page > 1 };
  };
  f.binding = null;
  const runner = createWorkerUsageReconciliation(f.options);
  assert.deepEqual(await runner.runOnce(), { processed: 1, staged: 0, held: 1, failed: 0 });
  f.binding = binding;
  f.fail = true;
  assert.deepEqual(await runner.runOnce(), { processed: 1, staged: 0, held: 0, failed: 1 });
  f.fail = false;
  assert.equal((await runner.runOnce()).staged, 1);
  assert.deepEqual(
    f.pages.map((p) => p.afterPurchaseId),
    [null, id, null],
  );
});
test('test and unpaid preflight skip source/binding, and wrong-scope page is rejected', async () => {
  const f = fixture(),
    runner = createWorkerUsageReconciliation(f.options);
  for (const decision of [
    { kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 },
    { kind: 'PENDING_PAYMENT', units: 0 },
  ]) {
    f.decision = decision;
    assert.equal((await runner.runOnce()).held, 1);
  }
  assert.equal(f.sources, 0);
  assert.equal(f.bindings, 0);
  assert.equal(f.prepares.length, 0);
  f.wrongScope = true;
  assert.equal((await runner.runOnce()).failed, 1);
});
test('singleflight and stop await active work and prevent later stage or runs', async () => {
  const f = fixture();
  let release, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  f.options.resolveBinding = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return binding;
  };
  const runner = createWorkerUsageReconciliation(f.options);
  const first = runner.runOnce();
  assert.equal(runner.runOnce(), first);
  await ready;
  let stopped = false;
  const stopping = runner.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal((await first).held, 1);
  assert.equal(f.prepares.length, 0);
  assert.deepEqual(await runner.runOnce(), { processed: 0, staged: 0, held: 0, failed: 0 });
});
