import { expect, it } from 'vitest';
import { createCatalogReader, createCatalogTransport } from '../src/catalog.js';

const id = 'gid://shopify/Product/42';
const variant = 'gid://shopify/ProductVariant/77';
it('reads complete bounded identities without presentation fields', async () => {
  let query = '';
  const reader = createCatalogReader(
    createCatalogTransport({
      shop: 'test.myshopify.com',
      accessToken: 'test',
      fetchImpl: async (_url, options) => {
        query = JSON.parse(String(options?.body)).query;
        return Response.json({
          data: {
            product: { id, status: 'ACTIVE', variants: { nodes: [{ id: variant }], pageInfo: { hasNextPage: false } } },
          },
        });
      },
    }),
  );
  expect(await reader.availabilityProduct(id)).toEqual({ id, status: 'ACTIVE', variantIds: [variant] });
  expect(query).toContain('variants(first: 250)');
  expect(query).not.toMatch(/title|media|options|collections|variantsCount/);
});

it('supports 250 identities but rejects incomplete, duplicate, malformed or foreign responses', async () => {
  const nodes = Array.from({ length: 250 }, (_, i) => ({ id: `gid://shopify/ProductVariant/${i + 1}` }));
  const valid = { id, status: 'ACTIVE', variants: { nodes, pageInfo: { hasNextPage: false } } };
  const reader = (product: unknown) => createCatalogReader({ read: async <T>() => ({ product }) as T });
  expect((await reader(valid).availabilityProduct(id))?.variantIds).toHaveLength(250);
  expect(await reader(null).availabilityProduct(id)).toBeNull();
  for (const product of [
    undefined,
    {},
    { ...valid, id: 'gid://shopify/Product/43' },
    { ...valid, status: 'unknown' },
    { ...valid, variants: { nodes, pageInfo: { hasNextPage: true } } },
    { ...valid, variants: { nodes, pageInfo: { hasNextPage: 'false' } } },
    { ...valid, variants: { nodes: [...nodes, { id: variant }], pageInfo: { hasNextPage: false } } },
    { ...valid, variants: { nodes: [nodes[0], nodes[0]], pageInfo: { hasNextPage: false } } },
    { ...valid, variants: { nodes: [null], pageInfo: { hasNextPage: false } } },
    { ...valid, variants: { nodes: [{ id: '77' }], pageInfo: { hasNextPage: false } } },
  ])
    await expect(reader(product).availabilityProduct(id)).rejects.toThrow();
});
it('closes GraphQL errors and oversized responses at the existing bounded transport', async () => {
  for (const payload of [
    { errors: [{ message: 'denied' }], data: {} },
    { data: {}, padding: 'x'.repeat(1_000_001) },
  ]) {
    const reader = createCatalogReader(
      createCatalogTransport({
        shop: 'test.myshopify.com',
        accessToken: 'test',
        fetchImpl: async () => Response.json(payload),
      }),
    );
    await expect(reader.availabilityProduct(id)).rejects.toThrow();
  }
});

it('compares matched 250-variant control and candidate dispatch/payload budgets', async () => {
  async function run(narrow: boolean) {
    const requests: { query: string; variables: Record<string, unknown> }[] = [];
    let responseBytes = 0;
    const transport = createCatalogTransport({
      shop: 'test.myshopify.com',
      accessToken: 'test',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        requests.push(body);
        const offset = body.variables.after ? Number(body.variables.after) : 0;
        const count = narrow ? 250 : Math.min(100, 250 - offset);
        const nodes = Array.from({ length: count }, (_, i) => ({
          id: `gid://shopify/ProductVariant/${offset + i + 1}`,
          ...(narrow ? {} : { title: 'Blue M', image: null, selectedOptions: [] }),
        }));
        const data = {
          product: {
            id,
            status: 'ACTIVE',
            ...(narrow ? {} : { title: 'Product', featuredMedia: null }),
            variants: { nodes, pageInfo: { hasNextPage: offset + count < 250, endCursor: String(offset + count) } },
          },
        };
        responseBytes += JSON.stringify({ data }).length;
        return Response.json({ data });
      },
    });
    const reader = createCatalogReader(transport);
    if (narrow) expect((await reader.availabilityProduct(id))?.variantIds).toHaveLength(250);
    else expect((await reader.get(id))?.variants).toHaveLength(250);
    return { requests, responseBytes };
  }
  const control = await run(false),
    candidate = await run(true);
  expect(control.requests).toHaveLength(3);
  expect(candidate.requests).toHaveLength(1);
  expect(candidate.responseBytes).toBeLessThan(control.responseBytes);
  // Synthetic dispatch/payload comparison only; this measures no native latency.
  console.info(
    JSON.stringify({
      scenario: 'synthetic 250-variant catalog responses; excludes stock/credentials and native timing',
      control: { dispatches: control.requests.length, responseBytes: control.responseBytes },
      candidate: { dispatches: candidate.requests.length, responseBytes: candidate.responseBytes },
    }),
  );
});
