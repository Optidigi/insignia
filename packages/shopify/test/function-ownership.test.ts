import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createFunctionOwnershipReconciler } from '../src/function-ownership.js';

const tenant = {
  shopId: 'shop-internal-1',
  installationGeneration: '7',
  shopifyShopId: 'gid://shopify/Shop/101',
  appId: '12345',
};
const transformQuery = 'query Transform { shop { id } }';
const validationQuery = 'query Validation { shop { id } }';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const expected = {
  appKey: 'client-12345',
  transformInputQuerySha256: digest(transformQuery),
  validationInputQuerySha256: digest(validationQuery),
};
const fixture = () => ({
  data: {
    shop: { id: tenant.shopifyShopId },
    shopifyFunctions: {
      nodes: [
        {
          id: 'function-transform',
          handle: 'insignia-experimental-v2-transform',
          appKey: expected.appKey,
          apiVersion: '2026-07',
          apiType: 'cart_transform',
          inputQuery: transformQuery,
        },
        {
          id: 'function-validation',
          handle: 'insignia-experimental-v2-validation',
          appKey: expected.appKey,
          apiVersion: '2026-07',
          apiType: 'cart_checkout_validation',
          inputQuery: validationQuery,
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    cartTransforms: {
      nodes: [{ id: 'gid://shopify/CartTransform/1', functionId: 'function-transform', blockOnFailure: true }],
      pageInfo: { hasNextPage: false },
    },
    validations: {
      nodes: [
        {
          id: 'gid://shopify/Validation/2',
          enabled: true,
          blockOnFailure: true,
          shopifyFunction: {
            id: 'function-validation',
            handle: 'insignia-experimental-v2-validation',
            appKey: expected.appKey,
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
  },
});

describe('read-only owned Function reconciliation', () => {
  test('proves both configured owned targets and observed input queries', async () => {
    const execute = vi.fn(async () => ({ status: 200, body: fixture() }));
    const result = await createFunctionOwnershipReconciler({ transport: { execute } }).read(tenant, expected);
    expect(result).toEqual({
      transform: 'present',
      validation: 'present',
      runtimeIdentity: 'unverifiable',
      readiness: 'unknown',
    });
    expect(execute.mock.calls[0]?.[0]?.query).toContain('shopifyFunctions(first: 25)');
  });
  test('separates missing, duplicated, drifted and unverifiable ownership', async () => {
    const body = fixture();
    body.data.cartTransforms.nodes = [];
    const firstValidation = body.data.validations.nodes[0];
    if (!firstValidation) throw new Error('fixture missing validation');
    body.data.validations.nodes.push({ ...firstValidation });
    const read = (snapshot: unknown) =>
      createFunctionOwnershipReconciler({
        transport: { execute: async () => ({ status: 200, body: snapshot }) },
      }).read(tenant, expected);
    expect(await read(body)).toMatchObject({ transform: 'missing', validation: 'duplicate', readiness: 'unknown' });
    const drifted = fixture();
    const firstFunction = drifted.data.shopifyFunctions.nodes[0];
    if (!firstFunction) throw new Error('fixture missing Function');
    firstFunction.inputQuery = 'changed';
    expect(await read(drifted)).toMatchObject({ transform: 'drift', validation: 'present', readiness: 'unknown' });
    const unknown = fixture();
    unknown.data.shopifyFunctions.pageInfo.hasNextPage = true;
    expect(await read(unknown)).toMatchObject({ transform: 'unknown', validation: 'unknown', readiness: 'unknown' });
  });
});
