import assert from 'node:assert/strict';
import test from 'node:test';
import type { DurableCore, UsageDeliveryBinding, UsageLedgerRecord } from '@insignia/database';
import { createWorkerUsageReconciliation } from '../dist/usage-reconciliation.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';

const scope = { shopId: 'tenant', installationGeneration: '1' };
const id = '00000000-0000-4000-8000-000000000001';
const binding = {
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/2',
  meterHandle: 'meter',
  policy: { id: 'approved', version: '1' },
};
function fixture() {
  type Page = Parameters<DurableCore['usageLedger']['selectPending']>[1];
  type Preparation = Parameters<DurableCore['usageDeliveryIntents']['prepare']>[1];
  const f: {
    pages: Page[];
    sources: number;
    prepares: Preparation[];
    bindings: number;
    decision: UsageLedgerRecord['decision'];
    fail: boolean;
    binding: UsageDeliveryBinding | null;
    wrongScope: boolean;
  } = {
    pages: [],
    sources: 0,
    prepares: [],
    bindings: 0,
    decision: {
      kind: 'ELIGIBLE',
      units: 1,
      ...scope,
      orderId: 'order',
      occurredAt: '2026-10-15T00:00:00Z',
      policy: binding.policy,
      cycleId: 'cycle',
    },
    fail: false,
    binding,
    wrongScope: false,
  };
  const options: Parameters<typeof createWorkerUsageReconciliation>[0] = {
    scope,
    pageSize: 1,
    core: durableCoreFixture({
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
        record: async (s, input) => ({
          ...s,
          purchaseId: input.purchaseId,
          decision: f.decision,
          orderId: 'order',
          firstPaidAt: null,
          historyPolicyHash: 'synthetic',
          createdAt: '2026-10-15T00:00:00Z',
          updatedAt: '2026-10-15T00:00:00Z',
        }),
      },
      usageDeliveryIntents: {
        prepare: async (s, input) => {
          f.prepares.push(input);
          if (f.fail) throw Error('PRIVATE_PROVIDER_DETAIL');
          if (!input.binding) throw new Error('Fixture requires binding');
          return {
            kind: 'STAGED',
            intent: {
              ...s,
              ...input.binding,
              purchaseId: input.purchaseId,
              orderId: 'order',
              occurredAt: '2026-10-15T00:00:00Z',
              units: 1,
              cycleId: 'cycle',
              idempotencyKey: 'synthetic-key',
              createdAt: '2026-10-15T00:00:00Z',
            },
          };
        },
      },
    }),
    loadCurrentCycleInput: async () => {
      f.sources++;
      throw Error('not needed for durable terminal');
    },
    resolveBinding: async () => {
      f.bindings++;
      return f.binding;
    },
  };
  return Object.assign(f, { options });
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
  ] as const) {
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
  let release: () => void = () => {
    throw new Error('Fixture not started');
  };
  let entered: () => void = () => {
    throw new Error('Fixture not started');
  };
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.options.resolveBinding = async () => {
    entered();
    await new Promise<void>((resolve) => {
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
