import { describe, expect, test, vi } from 'vitest';
import {
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  PublicationAdminError,
  type PublicationAdminRequest,
} from '../src/publication-admin.js';

const tenant = {
  shopId: 'shop-internal-1',
  installationGeneration: '7',
  shopifyShopId: 'gid://shopify/Shop/101',
  appId: '12345',
};
const productId = 'gid://shopify/Product/202';
const value = '11111111111111111111111111111111:1:pending';
const metafield = (key: string, current = value, digest = 'a'.repeat(64)) => ({
  owner: { id: productId },
  namespace: 'app--12345',
  key,
  type: 'single_line_text_field',
  value: current,
  compareDigest: digest,
});
const productRead = (field: unknown) => ({
  status: 200,
  body: { data: { node: { __typename: 'Product', id: productId, field } } },
});

describe('2026-07 app-owned publication Admin adapter', () => {
  test('reads a fixed product anchor and binds owner, namespace, type and digest', async () => {
    const execute = vi.fn(async (_request: PublicationAdminRequest) =>
      productRead(metafield('insignia_registration_v2')),
    );
    const adapter = createPublicationAdminAdapter({ transport: { execute } });
    const found = await adapter.read({ ...tenant, field: 'registration', productId });
    expect(found).toMatchObject({
      ownerId: productId,
      namespace: 'app--12345',
      key: 'insignia_registration_v2',
      type: 'single_line_text_field',
      value,
      compareDigest: 'a'.repeat(64),
    });
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ tenant, variables: { productId } });
    expect(execute.mock.calls[0]?.[0]?.query).toContain(
      'metafield(namespace: "$app", key: "insignia_registration_v2")',
    );
    await expect(
      adapter.read({ ...tenant, field: 'registration', productId: 'gid://shopify/Product/203' }),
    ).rejects.toMatchObject({ kind: 'owner_mismatch' });
  });

  test('writes with compareDigest and requires exact readback after acknowledgement', async () => {
    const execute = vi.fn(async (request: PublicationAdminRequest) =>
      request.operation === 'set'
        ? {
            status: 200,
            body: {
              data: {
                metafieldsSet: {
                  metafields: [metafield('insignia_registration_v2', value, 'b'.repeat(64))],
                  userErrors: [],
                },
              },
            },
          }
        : productRead(metafield('insignia_registration_v2', value, 'b'.repeat(64))),
    );
    const adapter = createPublicationAdminAdapter({ transport: { execute } });
    const result = await adapter.set({
      ...tenant,
      field: 'registration',
      productId,
      value,
      compareDigest: 'a'.repeat(64),
    });
    expect(result).toMatchObject({ kind: 'applied', observed: { value, compareDigest: 'b'.repeat(64) } });
    const write = execute.mock.calls[0]?.[0];
    expect(write?.variables).toEqual({
      metafields: [
        {
          ownerId: productId,
          namespace: '$app',
          key: 'insignia_registration_v2',
          type: 'single_line_text_field',
          value,
          compareDigest: 'a'.repeat(64),
        },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('create sends explicit null compareDigest and stale CAS is a conflict', async () => {
    const execute = vi.fn(async (_request: PublicationAdminRequest) => ({
      status: 200,
      body: {
        data: {
          metafieldsSet: {
            metafields: [],
            userErrors: [{ code: 'STALE_OBJECT', message: 'provider details are private' }],
          },
        },
      },
    }));
    const adapter = createPublicationAdminAdapter({ transport: { execute } });
    await expect(
      adapter.set({ ...tenant, field: 'registration', productId, value, compareDigest: null }),
    ).rejects.toMatchObject({ kind: 'cas_conflict' });
    expect(execute.mock.calls[0]?.[0]?.variables).toMatchObject({ metafields: [{ compareDigest: null }] });
  });

  test('ambiguous timeout reads back first and never blindly retries', async () => {
    const execute = vi.fn(async (request: PublicationAdminRequest) => {
      if (request.operation === 'set') throw new PublicationAdminError('network_or_timeout');
      return productRead(metafield('insignia_registration_v2', value, 'b'.repeat(64)));
    });
    const adapter = createPublicationAdminAdapter({ transport: { execute } });
    await expect(
      adapter.set({ ...tenant, field: 'registration', productId, value, compareDigest: null }),
    ).resolves.toMatchObject({ kind: 'applied_after_ambiguous_response' });
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockImplementationOnce(async () => {
      throw new PublicationAdminError('network_or_timeout');
    });
    execute.mockImplementationOnce(async () => productRead(null));
    await expect(
      adapter.set({ ...tenant, field: 'registration', productId, value, compareDigest: null }),
    ).rejects.toMatchObject({ kind: 'ambiguous_write' });
  });

  test('wrong readback value, namespace or digest cannot be acknowledged', async () => {
    for (const wrong of [
      { ...metafield('insignia_registration_v2'), value: 'different' },
      { ...metafield('insignia_registration_v2'), namespace: 'custom' },
    ]) {
      const execute = vi.fn(async (request: PublicationAdminRequest) =>
        request.operation === 'set'
          ? {
              status: 200,
              body: {
                data: { metafieldsSet: { metafields: [metafield('insignia_registration_v2')], userErrors: [] } },
              },
            }
          : productRead(wrong),
      );
      await expect(
        createPublicationAdminAdapter({ transport: { execute } }).set({
          ...tenant,
          field: 'registration',
          productId,
          value,
          compareDigest: null,
        }),
      ).rejects.toMatchObject({ kind: wrong.namespace === 'custom' ? 'provider_shape' : 'readback_mismatch' });
    }
  });

  test('a mutation acknowledgement with a different value is held before readback', async () => {
    const execute = vi.fn(async () => ({
      status: 200,
      body: {
        data: {
          metafieldsSet: {
            metafields: [metafield('insignia_registration_v2', '11111111111111111111111111111111:1:ready')],
            userErrors: [],
          },
        },
      },
    }));
    await expect(
      createPublicationAdminAdapter({ transport: { execute } }).set({
        ...tenant,
        field: 'registration',
        productId,
        value,
        compareDigest: null,
      }),
    ).rejects.toMatchObject({ kind: 'readback_mismatch' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('HTTP transport fences stale credentials and never sends arbitrary query', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('should not call');
    });
    const transport = createPublicationAdminHttpTransport({
      credentials: {
        acquire: async () => ({ kind: 'inactive' as const }),
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      transport.execute({
        operation: 'read_product',
        tenant,
        query: 'query { shop { name } }',
        variables: { productId },
      }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('HTTP transport uses the fenced installation token, exact version and bounded response', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(productRead(metafield('insignia_registration_v2')).body), { status: 200 }),
    );
    const acquire = vi.fn(async () => ({
      kind: 'usable' as const,
      shopDomain: 'test-store.myshopify.com',
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    }));
    const transport = createPublicationAdminHttpTransport({
      credentials: { acquire },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await createPublicationAdminAdapter({ transport }).read({ ...tenant, field: 'registration', productId });
    expect(acquire).toHaveBeenCalledWith({
      shopId: tenant.shopId,
      installationGeneration: tenant.installationGeneration,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://test-store.myshopify.com/admin/api/2026-07/graphql.json');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({ 'x-shopify-access-token': 'synthetic-token' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ variables: { productId } });
    const tooLarge = createPublicationAdminHttpTransport({
      credentials: { acquire },
      fetchImpl: vi.fn(
        async () => new Response('x'.repeat(128 * 1024 + 1), { status: 200 }),
      ) as unknown as typeof fetch,
    });
    await expect(
      createPublicationAdminAdapter({ transport: tooLarge }).read({ ...tenant, field: 'registration', productId }),
    ).rejects.toMatchObject({ kind: 'provider_shape' });
  });

  test('HTTP transport rejects altered mutation keys before acquiring credentials', async () => {
    let captured: PublicationAdminRequest | undefined;
    const adapter = createPublicationAdminAdapter({
      transport: {
        execute: async (request) => {
          captured = request;
          return {
            status: 200,
            body: { data: { metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } } },
          };
        },
      },
    });
    await expect(
      adapter.set({ ...tenant, field: 'registration', productId, value, compareDigest: null }),
    ).rejects.toMatchObject({ kind: 'cas_conflict' });
    if (!captured) throw new Error('fixture did not capture mutation');
    const acquire = vi.fn(async () => ({ kind: 'inactive' as const }));
    const transport = createPublicationAdminHttpTransport({ credentials: { acquire } });
    const original = captured.variables.metafields as Record<string, unknown>[];
    await expect(
      transport.execute({
        ...captured,
        variables: {
          metafields: [{ ...original[0], key: 'merchant_writable' }],
        },
      }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(acquire).not.toHaveBeenCalled();
  });

  test('actual HTTP lost response reads exact CAS result without a second mutation', async () => {
    let mutations = 0;
    let reads = 0;
    const transport = createPublicationAdminHttpTransport({
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'test-store.myshopify.com',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
        }),
      },
      fetchImpl: (async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        expect(Object.keys(request).sort()).toEqual(['query', 'variables']);
        if (request.query.startsWith('mutation')) {
          mutations++;
          expect(request.variables.metafields[0].compareDigest).toBe(null);
          throw new Error('Synthetic committed response loss');
        }
        reads++;
        return Response.json(productRead(metafield('insignia_registration_v2', value, 'b'.repeat(64))).body);
      }) as typeof fetch,
    });
    await expect(
      createPublicationAdminAdapter({ transport }).set(
        { ...tenant, field: 'registration', productId, value, compareDigest: null },
        () => true,
      ),
    ).resolves.toMatchObject({ kind: 'applied_after_ambiguous_response' });
    expect(mutations).toBe(1);
    expect(reads).toBe(1);
  });

  test('actual HTTP pre-send refusal is not ambiguity and never enters provider JSON', async () => {
    const fetchImpl = vi.fn();
    const transport = createPublicationAdminHttpTransport({
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'test-store.myshopify.com',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
        }),
      },
      fetchImpl,
    });
    const adapter = createPublicationAdminAdapter({ transport });
    for (const guard of [
      () => false,
      () => {
        throw new Error('Synthetic refusal');
      },
    ])
      await expect(
        adapter.set({ ...tenant, field: 'registration', productId, value, compareDigest: null }, guard),
      ).rejects.toMatchObject({ kind: 'not_dispatched' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('hard deadline bounds a stalled response body even if abort is ignored', async () => {
    const credentials = {
      acquire: async () => ({
        kind: 'usable' as const,
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'synthetic-token',
        accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
      }),
    };
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
    const transport = createPublicationAdminHttpTransport({
      credentials,
      timeoutMs: 100,
      fetchImpl: (async () => new Response(stalled, { status: 200 })) as typeof fetch,
    });
    await expect(
      createPublicationAdminAdapter({ transport }).read({ ...tenant, field: 'registration', productId }),
    ).rejects.toMatchObject({ kind: 'network_or_timeout' });
  });
});
