import assert from 'node:assert/strict';
import test from 'node:test';
import type { DurableCore } from '@insignia/database';
import { createPurchaseReleasePreparation } from '../dist/purchase-release.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';

type Input = Parameters<typeof createPurchaseReleasePreparation>[0];
type Evidence = NonNullable<Awaited<ReturnType<DurableCore['trustedReleaseRecords']['read']>>>;
function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}
function prepare(input: Input) {
  return required(createPurchaseReleasePreparation(input));
}
const start = Date.parse('2026-10-14T01:00:00Z');
const target = { shopId: 'tenant', installationGeneration: '1', orderId: 'order' };
function fixture() {
  const f: {
    time: number;
    evidence: Evidence | null;
    collected: Parameters<Input['collector']['collect']>[0][];
    reads: Parameters<DurableCore['trustedReleaseRecords']['read']>[0][];
    auth: string;
    expires: number;
    installation: string;
    epoch: number;
  } = {
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
  const identity = {
    schemaVersion: 1 as const,
    shopId: 'tenant',
    installationGeneration: '1',
    appClientId: 'synthetic-client',
    appVersionRef: qualified.activeVersionRef,
    devPreviewRef: null,
    sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
    transform: {
      functionId: 'transform',
      handle: 'transform',
      apiType: 'cart_transform' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'a'.repeat(64),
      wasmSha256: 'b'.repeat(64),
    },
    validation: {
      functionId: 'validation',
      handle: 'validation',
      apiType: 'cart_checkout_validation' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'c'.repeat(64),
      wasmSha256: 'd'.repeat(64),
    },
  };
  const row: Evidence = {
    expectedBuild: identity,
    record: {
      version: 'm5-trusted-release-v1',
      recordId: '22222222-2222-4222-8222-222222222222',
      activeAppVersionRef: qualified.activeVersionRef,
      attestation: {
        ...identity,
        evidenceKind: 'RELEASE_BOUND',
        observedAt: new Date(start).toISOString(),
        expiresAt: new Date(start + 60000).toISOString(),
      },
    },
    activeVersionEvidenceSha256: 'e'.repeat(64),
    evidenceDigest: 'f'.repeat(64),
  };
  const input: Omit<Input, 'qualification' | 'core'> & {
    qualification: typeof qualified;
    core: { -readonly [K in keyof Input['core']]: Input['core'][K] };
  } = {
    qualification: qualified,
    releaseProfile: 'm8-app-proxy-3d2a02e',
    clock: () => new Date(f.time),
    core: durableCoreFixture({
      credentials: {
        metadata: async () => ({
          shop_id: target.shopId,
          installation_generation: '1',
          schema_version: 1,
          credential_version: '1',
          refresh_expires_at: new Date(f.expires + 60000),
          scopes: null,
          wrapping_key_id: 'synthetic',
          refresh_claim_until: null,
          state: 'active',
          access_expires_at: new Date(f.expires),
        }),
      },
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
          shopDomain: 'synthetic.myshopify.com',
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
    }),
    collector: {
      collect: async (q) => {
        f.collected.push(q);
        f.evidence = row;
        return { requestId: q.requestId, recordId: row.record.recordId, state: 'COMPLETE' };
      },
    },
  };
  return Object.assign(f, { row, input });
}
test('expired release evidence demands correlated collection then independently rereads with a claim-safe deadline', async () => {
  const f = fixture();
  await prepare(f.input)(target);
  assert.equal(f.collected.length, 1);
  assert.equal(f.reads.length, 2);
  const q = required(f.collected[0]);
  assert.equal(q.deadlineMs, start + 15000);
  assert.equal(q.expectedActiveAppVersionRef, '1166090010625');
  assert.ok(!('orderId' in q.binding) && !('accessToken' in q));
  assert.equal(required(f.reads[1]).expectedActiveAppVersionRef, q.expectedActiveAppVersionRef);
  await prepare(f.input)(target);
  assert.equal(f.collected.length, 1);
});
test('unqualified admission touches no credentials, tenant or collector capability', () => {
  const fail = new Proxy(
    {
      ...durableCoreFixture({}),
      async collect() {
        throw Error('capability touched');
      },
    },
    {
      get() {
        throw Error('capability touched');
      },
    },
  );
  assert.equal(createPurchaseReleasePreparation({ core: fail, collector: fail, qualification: null }), undefined);
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
    await assert.rejects(prepare(f.input)(target), /PURCHASE_RELEASE_UNAVAILABLE/);
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
    await assert.rejects(prepare(f.input)(target), /PURCHASE_RELEASE_UNAVAILABLE/);
  }
});
test('concurrent preparation for the same bound installation shares one collection', async () => {
  const f = fixture();
  let finish: (() => void) | undefined;
  f.input.collector.collect = (q) => {
    f.collected.push(q);
    return new Promise((resolve) => {
      finish = () => {
        f.evidence = f.row;
        resolve({ requestId: q.requestId, recordId: f.row.record.recordId, state: 'COMPLETE' });
      };
    });
  };
  const preparation = prepare(f.input);
  const a = preparation(target),
    b = preparation(target);
  for (let n = 0; n < 10 && !finish; n++) await new Promise((r) => setImmediate(r));
  assert.equal(f.collected.length, 1);
  required(finish)();
  await Promise.all([a, b]);
});

test('stalled preparation reads and collection fail within budget without starting later effects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const held of ['identity', 'metadata', 'evidence', 'collector', 'short_expiry']) {
    const f = fixture();
    let finish: (() => void) | undefined;
    const wait = <T,>(value: T) =>
      new Promise<T>((resolve) => {
        finish = () => resolve(value);
      });
    if (held === 'identity') f.input.core.tenants.getActiveAuthorizationScope = () => wait(null);
    else if (held === 'metadata') f.input.core.credentials.metadata = () => wait(undefined);
    else if (held === 'collector')
      f.input.collector.collect = (q) => wait({ requestId: q.requestId, recordId: null, state: 'STOPPED' });
    else f.input.core.trustedReleaseRecords = { read: () => wait(null) };
    if (held === 'short_expiry') f.expires = start + 35000;
    let settled: boolean | 'accepted' | 'rejected' = false;
    const outcome = prepare(f.input)(target).then(
      () => {
        settled = 'accepted';
      },
      () => {
        settled = 'rejected';
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(held === 'short_expiry' ? 5001 : 15001);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, 'rejected', held);
    required(finish)();
    await outcome;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.collected.length, 0, held);
  }
});
