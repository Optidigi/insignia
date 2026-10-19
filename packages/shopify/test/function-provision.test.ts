import { expect, test, vi } from 'vitest';
import { createFunctionProvisioningPort } from '../src/function-provision.js';
import { createPublicationAdminHttpTransport, FUNCTION_TRANSFORM_CREATE } from '../src/publication-admin.js';
import { graphqlRequest } from './fixture-assertions.js';

const tenant = {
  shopId: 'synthetic-shop',
  installationGeneration: '3',
  shopifyShopId: 'gid://shopify/Shop/101',
  appId: '12345',
};
const credentials = {
  acquire: async () => ({
    kind: 'usable' as const,
    shopDomain: 'synthetic-dev.myshopify.com',
    accessToken: 'SYNTHETIC_TOKEN',
    accessExpiresAt: new Date(Date.now() + 120_000),
  }),
};
const payload = {
  transform: {
    cartTransformCreate: {
      cartTransform: { id: 'gid://shopify/CartTransform/101', functionId: 'owned-transform', blockOnFailure: true },
      userErrors: [],
    },
  },
  validation: {
    validationCreate: {
      validation: {
        id: 'gid://shopify/Validation/102',
        enabled: true,
        blockOnFailure: true,
        shopifyFunction: {
          id: 'owned-validation',
          handle: 'insignia-experimental-v2-validation',
          appKey: 'synthetic-client',
        },
      },
      userErrors: [],
    },
  },
};
const port = (fetchImpl: typeof fetch) =>
  createFunctionProvisioningPort({
    transport: createPublicationAdminHttpTransport({ credentials, fetchImpl }),
    appKey: 'synthetic-client',
    functionIds: { transform: 'owned-transform', validation: 'owned-validation' },
  });

test.each(['transform', 'validation'] as const)(
  'internal %s setup requires final admission and an exact owned acknowledgement, without retry',
  async (kind) => {
    const outbound = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: payload[kind] }), { headers: { 'content-type': 'application/json' } }),
    );
    const setup = port(outbound);
    await expect(setup.create(kind, tenant, () => false)).rejects.toMatchObject({ kind: 'not_dispatched' });
    expect(outbound).not.toHaveBeenCalled();
    await expect(setup.create(kind, tenant, () => true)).resolves.toEqual({
      id: kind === 'transform' ? 'gid://shopify/CartTransform/101' : 'gid://shopify/Validation/102',
    });
    expect(outbound).toHaveBeenCalledTimes(1);
    const body = graphqlRequest(String(outbound.mock.calls[0]?.[1]?.body));
    expect(body.query).toContain('blockOnFailure: true');
    expect(body.query).toContain('functionHandle: "insignia-experimental-v2-');
    expect(body.variables).toEqual({});
    expect(body).not.toHaveProperty('metafields');
  },
);

test('creation rejection needs an explicit absent instance; incomplete responses remain ambiguous and cannot retry', async () => {
  for (const rejected of [null, undefined, []]) {
    const outbound = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              cartTransformCreate: { cartTransform: rejected, userErrors: [{ code: 'FUNCTION_NOT_FOUND' }] },
            },
          }),
        ),
    );
    const setup = port(outbound);
    await expect(setup.create('transform', tenant, () => true)).rejects.toMatchObject({
      kind: rejected === null ? 'user_error' : 'ambiguous_write',
    });
    await expect(setup.create('transform', tenant, () => true)).rejects.toMatchObject({ kind: 'not_dispatched' });
    expect(outbound).toHaveBeenCalledTimes(1);
  }
});

test('the fixed transport rejects Function creation without a final admission callback before credentials or HTTP', async () => {
  const acquire = vi.fn(credentials.acquire);
  const outbound = vi.fn(async () => new Response('{}'));
  const transport = createPublicationAdminHttpTransport({ credentials: { acquire }, fetchImpl: outbound });
  await expect(
    transport.execute({
      operation: 'function_transform_create',
      tenant,
      query: FUNCTION_TRANSFORM_CREATE,
      variables: {},
    }),
  ).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(acquire).not.toHaveBeenCalled();
  expect(outbound).not.toHaveBeenCalled();
});

test.each(['transform', 'validation'] as const)(
  'an uncertain %s write or contradictory acknowledgement consumes its one attempt',
  async (kind) => {
    for (const result of ['network', 'http', 'identity', 'flag'] as const) {
      const body = structuredClone(payload[kind]);
      const item =
        kind === 'transform'
          ? 'cartTransformCreate' in body
            ? body.cartTransformCreate.cartTransform
            : null
          : 'validationCreate' in body
            ? body.validationCreate.validation
            : null;
      if (!item) throw new Error('invalid synthetic fixture');
      if (result === 'identity') item.id = 'gid://shopify/CartTransform/0';
      if (result === 'flag') item.blockOnFailure = false;
      const outbound = vi.fn(async () => {
        if (result === 'network') throw new Error('SYNTHETIC_PRIVATE_RESPONSE');
        return new Response(JSON.stringify({ data: body }), { status: result === 'http' ? 503 : 200 });
      });
      const setup = port(outbound);
      await expect(setup.create(kind, tenant, () => true)).rejects.toMatchObject({ kind: 'ambiguous_write' });
      await expect(setup.create(kind, tenant, () => true)).rejects.toMatchObject({ kind: 'not_dispatched' });
      expect(outbound).toHaveBeenCalledTimes(1);
    }
  },
);

test('concurrent admission cannot create two instances of the same Function', async () => {
  const outbound = vi.fn(async () => new Response(JSON.stringify({ data: payload.transform })));
  const setup = port(outbound);
  const outcomes = await Promise.allSettled([
    setup.create('transform', tenant, () => true),
    setup.create('transform', tenant, () => true),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  expect(outbound).toHaveBeenCalledTimes(1);
});
