import { describe, expect, it, vi } from 'vitest';
import { readVariantAvailability } from '../src/storefront/variant-availability.js';
import { graphqlRequest, required } from './fixture-assertions.js';

const now = new Date('2026-10-12T12:00:00.000Z');
const target = {
  shopId: 'tenant',
  installationGeneration: '1',
  productId: 'gid://shopify/Product/111',
  variantIds: ['gid://shopify/ProductVariant/222', 'gid://shopify/ProductVariant/333'] as const,
};
const node = (id: string, available: boolean) => ({
  id,
  availableForSale: available,
  product: { id: target.productId, status: 'ACTIVE' },
});
function fixture() {
  const credentials = {
    acquire: vi.fn(async () => ({
      kind: 'usable' as const,
      shopDomain: 'owned.myshopify.com',
      accessToken: 'synthetic-private-token',
      accessExpiresAt: new Date(+now + 60000),
    })),
  };
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: { nodes: [node(target.variantIds[1], false), node(target.variantIds[0], true)] } }),
      ),
  );
  return { credentials, fetchImpl, clock: () => now };
}
describe('owned Admin variant availability', () => {
  it('reads actual provider booleans in requested order with pinned scope and a thirty-second snapshot', async () => {
    const dependencies = fixture();
    const result = await readVariantAvailability(target, dependencies);
    expect(result).toEqual({
      shopId: target.shopId,
      installationGeneration: target.installationGeneration,
      productId: target.productId,
      observedAt: now.toISOString(),
      freshUntil: '2026-10-12T12:00:30.000Z',
      variants: [
        { id: target.variantIds[0], available: true },
        { id: target.variantIds[1], available: false },
      ],
    });
    expect(dependencies.credentials.acquire).toHaveBeenCalledWith({
      shopId: target.shopId,
      installationGeneration: '1',
    });
    const [url, rawInit] = required(dependencies.fetchImpl.mock.calls[0]);
    const options = required(rawInit);
    expect(url).toBe('https://owned.myshopify.com/admin/api/2026-07/graphql.json');
    expect(options.redirect).toBe('error');
    expect(graphqlRequest(String(options.body)).variables).toEqual({ ids: target.variantIds });
  });
  it('rejects invalid and incomplete identities, duplicate/missing nodes and untrusted availability values', async () => {
    const dependencies = fixture();
    for (const nodes of [
      [],
      [null, node(target.variantIds[1], false)],
      [node(target.variantIds[0], true), node(target.variantIds[0], false)],
      [
        node(target.variantIds[0], true),
        { ...node(target.variantIds[1], false), product: { id: 'gid://shopify/Product/999', status: 'ACTIVE' } },
      ],
      [node(target.variantIds[0], true), { ...node(target.variantIds[1], false), availableForSale: 'false' }],
      [
        node(target.variantIds[0], true),
        { ...node(target.variantIds[1], false), product: { id: target.productId, status: 'DRAFT' } },
      ],
    ]) {
      dependencies.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { nodes } })));
      await expect(readVariantAvailability(target, dependencies)).rejects.toThrow(/availability unavailable/);
    }
    dependencies.credentials.acquire.mockClear();
    await expect(
      readVariantAvailability({ ...target, variantIds: Array(251).fill(target.variantIds[0]) }, dependencies),
    ).rejects.toThrow('invalid_request');
    expect(dependencies.credentials.acquire).not.toHaveBeenCalled();
  });
});

it('bounds provider bytes and credentials, sanitizes failures and has a hard deadline even for an ignored signal', async () => {
  const dependencies = fixture();
  dependencies.credentials.acquire.mockImplementation(async () => ({
    kind: 'usable',
    shopDomain: 'owned.myshopify.com',
    accessToken: 'synthetic-private-token',
    accessExpiresAt: new Date(+now + 20000),
  }));
  await expect(readVariantAvailability(target, dependencies)).rejects.toThrow('credential_unavailable');
  expect(dependencies.fetchImpl).not.toHaveBeenCalled();
  dependencies.credentials.acquire.mockImplementation(async () => ({
    kind: 'usable',
    shopDomain: 'owned.myshopify.com',
    accessToken: 'synthetic-private-token',
    accessExpiresAt: new Date(+now + 60000),
  }));
  dependencies.fetchImpl.mockImplementation(async () => new Response('x'.repeat(128 * 1024 + 1)));
  await expect(readVariantAvailability(target, dependencies)).rejects.toThrow('invalid_provider_shape');
  dependencies.fetchImpl.mockImplementation(async () => {
    throw new Error('synthetic-private-token');
  });
  await expect(readVariantAvailability(target, dependencies)).rejects.toThrow('provider_unavailable');
  try {
    await readVariantAvailability(target, dependencies);
  } catch (error) {
    expect(String(error)).not.toContain('synthetic-private-token');
  }
  vi.useFakeTimers();
  try {
    dependencies.fetchImpl.mockImplementation(() => new Promise<Response>(() => {}));
    const pending = readVariantAvailability(target, dependencies);
    const assertion = expect(pending).rejects.toThrow('provider_unavailable');
    await vi.advanceTimersByTimeAsync(10001);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});
