import assert from 'node:assert/strict';
import test from 'node:test';
import { createPurchaseReleasePreparation } from '../dist/purchase-release.js';

const start = Date.parse('2026-10-14T01:00:00Z');
const target = { shopId: 'tenant', installationGeneration: '1', orderId: 'order' };
function fixture() {
  const f = {
    time: start,
    evidence: null,
    collected: [],
    reads: [],
    auth: '11111111-1111-4111-8111-111111111111',
    expires: start + 60000,
    installation: 'gid://shopify/AppInstallation/321',
    epoch: 0,
  };
  const qualified = {
    appId: '123',
    appClientId: 'synthetic-client',
    activeVersionRef: '1166090010625',
    origin: {
      shopId: 'tenant',
      installationGeneration: '1',
      creatorAppId: 'gid://shopify/App/77',
      supportedFrom: new Date(start - 60000).toISOString(),
    },
  };
  f.row = {
    expectedBuild: {
      appVersionRef: qualified.activeVersionRef,
      sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
    },
    record: { recordId: '22222222-2222-4222-8222-222222222222' },
  };
  f.input = {
    qualification: qualified,
    releaseProfile: 'm8-app-proxy-3d2a02e',
    clock: () => new Date(f.time),
    core: {
      tenants: {
        getActiveAuthorizationScope: async () => ({
          ...target,
          authorizationGeneration: f.auth,
          authorizationEpoch: f.epoch,
          shopDomain: 'synthetic.myshopify.com',
          shopifyShopId: '123',
        }),
        getManagedInstallationState: async () => ({
          shopId: 'tenant',
          currentGeneration: '1',
          active: true,
          shopifyShopId: '123',
          externalInstallationId: f.installation,
        }),
      },
      trustedReleaseRecords: {
        read: async (q) => {
          f.reads.push(q);
          return f.evidence;
        },
      },
    },
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'synthetic.myshopify.com',
        accessToken: 'SYNTHETIC_NOT_TRANSMITTED',
        accessExpiresAt: new Date(f.expires),
      }),
    },
    collector: {
      collect: async (q) => {
        f.collected.push(q);
        f.evidence = f.row;
        return { requestId: q.requestId, recordId: f.row.record.recordId, state: 'COMPLETE' };
      },
    },
  };
  return f;
}
test('expired release evidence demands correlated collection then independently rereads with a claim-safe deadline', async () => {
  const f = fixture();
  await createPurchaseReleasePreparation(f.input)(target);
  assert.equal(f.collected.length, 1);
  assert.equal(f.reads.length, 2);
  const q = f.collected[0];
  assert.equal(q.deadlineMs, start + 15000);
  assert.equal(q.expectedActiveAppVersionRef, '1166090010625');
  assert.ok(!('orderId' in q.binding) && !('accessToken' in q));
  assert.equal(f.reads[1].expectedActiveAppVersionRef, q.expectedActiveAppVersionRef);
  await createPurchaseReleasePreparation(f.input)(target);
  assert.equal(f.collected.length, 1);
});
test('unqualified admission touches no credentials, tenant or collector capability', () => {
  const fail = new Proxy(
    {},
    {
      get() {
        throw Error('capability touched');
      },
    },
  );
  assert.equal(
    createPurchaseReleasePreparation({ core: fail, credentials: fail, collector: fail, qualification: null }),
    undefined,
  );
});
test('credential expiry, foreign origin and changed authorization reject without allowing an order read', async () => {
  for (const state of ['expired', 'foreign', 'changed', 'installation', 'epoch', 'late']) {
    const f = fixture();
    if (state === 'expired') f.expires = start + 30000;
    if (state === 'foreign') f.input.qualification.origin.shopId = 'foreign';
    if (['changed', 'installation', 'epoch', 'late'].includes(state))
      f.input.collector.collect = async (q) => {
        f.collected.push(q);
        f.evidence = f.row;
        if (state === 'changed') f.auth = '33333333-3333-4333-8333-333333333333';
        else if (state === 'installation') f.installation = 'gid://shopify/AppInstallation/999';
        else if (state === 'epoch') f.epoch++;
        else f.time += 15001;
        return { requestId: q.requestId, recordId: f.row.record.recordId, state: 'COMPLETE' };
      };
    await assert.rejects(createPurchaseReleasePreparation(f.input)(target), /PURCHASE_RELEASE_UNAVAILABLE/);
    if (state === 'expired' || state === 'foreign') assert.equal(f.collected.length, 0);
  }
});
test('completion without matching durable evidence and foreign correlation never qualify preparation', async () => {
  for (const state of ['wrong_request', 'wrong_record', 'stopped']) {
    const f = fixture();
    f.input.collector.collect = async (q) => {
      f.evidence = f.row;
      return {
        requestId: state === 'wrong_request' ? 'foreign' : q.requestId,
        recordId: state === 'wrong_record' ? 'foreign' : f.row.record.recordId,
        state: state === 'stopped' ? 'STOPPED' : 'COMPLETE',
      };
    };
    await assert.rejects(createPurchaseReleasePreparation(f.input)(target), /PURCHASE_RELEASE_UNAVAILABLE/);
  }
});
test('concurrent preparation for the same bound installation shares one collection', async () => {
  const f = fixture();
  let finish;
  f.input.collector.collect = (q) => {
    f.collected.push(q);
    return new Promise((resolve) => {
      finish = () => {
        f.evidence = f.row;
        resolve({ requestId: q.requestId, recordId: f.row.record.recordId, state: 'COMPLETE' });
      };
    });
  };
  const prepare = createPurchaseReleasePreparation(f.input);
  const a = prepare(target),
    b = prepare(target);
  for (let n = 0; n < 10 && !finish; n++) await new Promise((r) => setImmediate(r));
  assert.equal(f.collected.length, 1);
  finish();
  await Promise.all([a, b]);
});
