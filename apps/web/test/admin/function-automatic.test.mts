import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { PublicationAdminTransport } from '@insignia/shopify';
import { ensureStoreFunctions } from '../../src/server/admin/function-automatic.ts';

const tenant = {
  shopId: 'live-demo-tenant',
  installationGeneration: '3',
  shopifyShopId: 'gid://shopify/Shop/101',
  appId: '429028933633',
};
const expected = {
  appKey: 'synthetic-client',
  observationVersion: 2 as const,
  transformInputQuerySha256: createHash('sha256').update('query{}').digest('hex'),
  validationInputQuerySha256: createHash('sha256').update('query{}').digest('hex'),
};
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false } });
const functionRef = { id: 'validation-id', handle: 'insignia-experimental-v2-validation', appKey: expected.appKey };

function store(initial: { transform?: boolean; validation?: boolean; foreign?: boolean } = {}) {
  let transformed = initial.transform ?? false,
    validated = initial.validation ?? false;
  const writes: string[] = [];
  const transform = { id: 'gid://shopify/CartTransform/7', functionId: 'transform-id', blockOnFailure: true };
  const validation = {
    id: 'gid://shopify/Validation/8',
    enabled: true,
    blockOnFailure: true,
    shopifyFunction: functionRef,
  };
  const transport: PublicationAdminTransport = {
    async execute(request, beforeSend) {
      if (request.operation === 'function_ownership')
        return {
          status: 200,
          body: {
            data: {
              shop: { id: tenant.shopifyShopId },
              shopifyFunctions: connection([
                {
                  id: 'transform-id',
                  handle: 'insignia-experimental-v2-transform',
                  appKey: expected.appKey,
                  apiType: 'cart_transform',
                  apiVersion: '2026-07',
                  inputQuery: null,
                },
                { ...functionRef, apiType: 'cart_checkout_validation', apiVersion: '2026-07', inputQuery: null },
              ]),
              cartTransforms: connection(
                transformed ? [{ ...transform, functionId: initial.foreign ? 'foreign-id' : 'transform-id' }] : [],
              ),
              validations: connection(validated ? [validation] : []),
            },
          },
        };
      assert.ok(beforeSend?.(), 'every write is admitted first');
      writes.push(request.operation);
      if (request.operation === 'function_transform_create') {
        transformed = true;
        return { status: 200, body: { data: { cartTransformCreate: { cartTransform: transform, userErrors: [] } } } };
      }
      validated = true;
      return { status: 200, body: { data: { validationCreate: { validation, userErrors: [] } } } };
    },
  };
  return { transport, writes };
}
const run = (transport: PublicationAdminTransport) =>
  ensureStoreFunctions({
    tenant,
    expected,
    transport,
    clock: () => new Date(),
    verifyAuthority: async () => new Date(Date.now() + 25_000),
  });

test('a new store gets its cart transform and validation on its first publish, then needs nothing', async () => {
  const s = store();
  assert.equal(await run(s.transport), 'CREATED');
  assert.deepEqual(s.writes, ['function_transform_create', 'function_validation_create']);
  assert.equal(await run(s.transport), 'PRESENT');
  assert.equal(s.writes.length, 2, 'Deployed Functions are never created again');
});

test('a partial or foreign deployment is left to the owner, with no write', async () => {
  for (const initial of [
    { transform: true },
    { validation: true },
    { transform: true, validation: true, foreign: true },
  ]) {
    const s = store(initial);
    assert.equal(await run(s.transport), 'OWNER_ACTION_REQUIRED', JSON.stringify(initial));
    assert.deepEqual(s.writes, []);
  }
});

test('expired authority stops before any write', async () => {
  const s = store();
  const state = await ensureStoreFunctions({
    tenant,
    expected,
    transport: s.transport,
    clock: () => new Date(),
    verifyAuthority: async () => new Date(Date.now() - 1),
  });
  assert.equal(state, 'STOPPED');
  assert.deepEqual(s.writes, []);
});
