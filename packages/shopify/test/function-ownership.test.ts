import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createFunctionOwnershipReconciler } from '../src/function-ownership.js';
import type { PublicationAdminRequest } from '../src/publication-admin.js';

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
    const execute = vi.fn(async (_request: PublicationAdminRequest) => ({ status: 200, body: fixture() }));
    const result = await createFunctionOwnershipReconciler({ transport: { execute } }).read(tenant, expected);
    expect(result).toMatchObject({
      transform: 'present',
      validation: 'present',
      runtimeIdentity: 'unverifiable',
      readiness: 'unknown',
    });
    expect(execute.mock.calls[0]?.[0]?.query).toContain('shopifyFunctions(first: 25)');
  });
  test('retains owned Function object identities for diagnostics before deployment activation', async () => {
    const body = fixture();
    body.data.cartTransforms.nodes = [];
    body.data.validations.nodes = [];
    const result = await createFunctionOwnershipReconciler({
      transport: { execute: async () => ({ status: 200, body }) },
      clock: () => new Date('2026-09-30T10:00:00Z'),
    }).read(tenant, expected);
    expect(result).toMatchObject({ transform: 'missing', validation: 'missing', runtimeIdentity: 'unverifiable' });
    expect(result.observation).toEqual({
      shopId: tenant.shopId,
      installationGeneration: '7',
      appClientId: 'client-12345',
      observedAt: '2026-09-30T10:00:00.000Z',
      transform: {
        functionId: 'function-transform',
        handle: 'insignia-experimental-v2-transform',
        apiType: 'cart_transform',
        apiVersion: '2026-07',
        inputQuerySha256: '61395cb64cd3ea1aa1e635cdba9b5fed6c48934b974488e74f66b70b6010db29',
      },
      validation: {
        functionId: 'function-validation',
        handle: 'insignia-experimental-v2-validation',
        apiType: 'cart_checkout_validation',
        apiVersion: '2026-07',
        inputQuerySha256: 'c60e4e89b25808b2b58f2c8c38567fe76ce0b019fa385c858d0c9059dc76a939',
      },
    });
    expect(JSON.stringify(result.observation)).not.toContain('wasm');
  });
  test('observations retain actual drifted API/query identity and exclude foreign or ambiguous objects', async () => {
    const read = (body: unknown) =>
      createFunctionOwnershipReconciler({
        transport: { execute: async () => ({ status: 200, body }) },
      }).read(tenant, expected);
    const drift = fixture();
    Object.assign(drift.data.shopifyFunctions.nodes[0], { apiVersion: '2026-04', inputQuery: 'changed' });
    expect(await read(drift)).toMatchObject({
      transform: 'unknown',
      observation: {
        transform: {
          apiVersion: '2026-04',
          inputQuerySha256: 'd67e2e944994496c8d8ec76eed0cf9f09679448d584b532bebf941852a37f5ed',
        },
      },
    });
    const foreign = fixture();
    Object.assign(foreign.data.shopifyFunctions.nodes[0], { appKey: 'other-app' });
    expect(await read(foreign)).toMatchObject({ transform: 'unknown', observation: { transform: null } });
    const duplicate = fixture();
    const first = duplicate.data.shopifyFunctions.nodes[0];
    if (!first) throw new Error('fixture missing Function');
    duplicate.data.shopifyFunctions.nodes.push({ ...first });
    expect(await read(duplicate)).toMatchObject({ transform: 'duplicate', observation: { transform: null } });
    const partial = fixture();
    partial.data.cartTransforms.pageInfo.hasNextPage = true;
    expect(await read(partial)).toMatchObject({
      transform: 'unknown',
      validation: 'unknown',
      observation: { transform: { functionId: 'function-transform' } },
    });
  });
  test('retaining objects does not relax enabled or block-on-failure deployment requirements', async () => {
    const body = fixture();
    Object.assign(body.data.cartTransforms.nodes[0], { blockOnFailure: false });
    Object.assign(body.data.validations.nodes[0], { enabled: false });
    const result = await createFunctionOwnershipReconciler({
      transport: { execute: async () => ({ status: 200, body }) },
    }).read(tenant, expected);
    expect(result).toMatchObject({
      transform: 'drift',
      validation: 'drift',
      observation: {
        transform: { functionId: 'function-transform' },
        validation: { functionId: 'function-validation' },
      },
    });
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
