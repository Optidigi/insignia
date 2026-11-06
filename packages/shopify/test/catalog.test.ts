import { describe, expect, it } from 'vitest';
import { createCatalogReader } from '../src/catalog.js';

const id = 'gid://shopify/Product/42';
const product = {
  id,
  title: 'Synthetic shirt',
  status: 'DRAFT',
  featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/synthetic.png', altText: null } } },
  variants: {
    nodes: [{ id: 'gid://shopify/ProductVariant/77', title: 'Blue / L', image: null }],
    pageInfo: { hasNextPage: true },
  },
};

it('retains Shopify ImageSource identities for featured, variant and product media images without substituting MediaImage file ids', async () => {
  const photo = {
    id: 'gid://shopify/ImageSource/12',
    url: 'https://cdn.shopify.com/source.png',
    altText: null,
    width: 800,
    height: 900,
  };
  const raw = {
    ...product,
    featuredMedia: { preview: { image: photo } },
    variants: { nodes: [{ ...product.variants.nodes[0], image: photo }], pageInfo: { hasNextPage: false } },
    media: {
      nodes: [{ __typename: 'MediaImage', id: 'gid://shopify/MediaImage/99', image: photo }],
      pageInfo: { hasNextPage: false },
    },
  };
  const reader = createCatalogReader({
    async read<T>(): Promise<T> {
      return { products: { nodes: [raw], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  });
  const result = (await reader.list({ first: 1 })).products[0];
  expect(result?.image?.id).toBe(photo.id);
  expect(result?.variants[0]?.image?.id).toBe(photo.id);
  expect(result?.images?.[0]).toMatchObject({ revisionId: 'image_12', image: { id: photo.id } });
  raw.media.nodes[0]!.image = { ...photo, id: 'gid://shopify/MediaImage/99' };
  await expect(reader.list({ first: 1 })).rejects.toThrow('image identity');
});

describe('bounded Admin catalog reader', () => {
  it('paginates products and exposes the limited variant vector without mutations', async () => {
    const calls: { operation: string; variables: Record<string, unknown> }[] = [];
    const reader = createCatalogReader({
      async read<T>(operation: 'list' | 'detail' | 'currency', variables: Record<string, unknown>): Promise<T> {
        calls.push({ operation, variables });
        return { products: { nodes: [product], pageInfo: { hasNextPage: true, endCursor: 'next' } } } as T;
      },
    });
    const page = await reader.list({ first: 1, search: 'shirt', after: 'previous' });
    expect(page.nextCursor).toBe('next');
    expect(page.products[0]).toMatchObject({ id, title: 'Synthetic shirt', variantsTruncated: true });
    expect(page.products[0]?.variants[0]).toMatchObject({ title: 'Blue / L' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.operation).toBe('list');
    expect(calls[0]?.variables).toEqual({ first: 1, after: 'previous', search: 'shirt' });
  });

  it('rejects response identity drift and unbounded pagination', async () => {
    const reader = createCatalogReader({
      async read<T>(): Promise<T> {
        return { product } as T;
      },
    });
    await expect(reader.get('gid://shopify/Product/43')).rejects.toThrow('identity mismatch');
    await expect(reader.list({ first: 21 })).rejects.toThrow('pagination');
    await expect(reader.get('https://example.test')).rejects.toThrow('Invalid product ID');
  });

  it('loads a ninth variant through bounded detail pagination and rejects repeated cursors', async () => {
    const first = Array.from({ length: 8 }, (_, index) => ({
      id: `gid://shopify/ProductVariant/${index + 1}`,
      title: `Synthetic ${index + 1}`,
      image: null,
    }));
    const calls: unknown[] = [];
    const reader = createCatalogReader({
      async read<T>(_operation: 'list' | 'detail' | 'currency', variables: Record<string, unknown>): Promise<T> {
        calls.push(variables.after);
        return {
          product: {
            ...product,
            variants: variables.after
              ? {
                  nodes: [{ id: 'gid://shopify/ProductVariant/9', title: 'Ninth', image: null }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                }
              : { nodes: first, pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } },
          },
        } as T;
      },
    });
    const detail = await reader.get(id);
    expect(detail?.variants).toHaveLength(9);
    expect(detail?.variantsTruncated).toBe(false);
    expect(calls).toEqual([null, 'cursor-1']);
    const repeated = createCatalogReader({
      async read<T>(): Promise<T> {
        return {
          product: { ...product, variants: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'repeat' } } },
        } as T;
      },
    });
    await expect(repeated.get(id)).rejects.toThrow('pagination');
  });
});

it('R2 mixed ACTIVE/UNLISTED catalog pages and detail retain legal status and bounded pagination', async () => {
  const calls: unknown[] = [];
  const unlisted = {
    ...product,
    status: 'UNLISTED',
    variants: { ...product.variants, pageInfo: { hasNextPage: false } },
  };
  const reader = createCatalogReader({
    async read<T>(operation: 'list' | 'detail' | 'currency', variables: Record<string, unknown>): Promise<T> {
      calls.push({ operation, variables });
      return (
        operation === 'list'
          ? {
              products: {
                nodes: [{ ...unlisted, id: 'gid://shopify/Product/43', status: 'ACTIVE' }, unlisted],
                pageInfo: { hasNextPage: true, endCursor: 'bounded-next' },
              },
            }
          : { product: unlisted }
      ) as T;
    },
  });
  const page = await reader.list({ first: 2 });
  expect(page.products.map((p) => p.status)).toEqual(['ACTIVE', 'UNLISTED']);
  expect(page.nextCursor).toBe('bounded-next');
  expect(await reader.get(id)).toMatchObject({ status: 'UNLISTED', variantsTruncated: false });
  expect(calls).toHaveLength(2);
  await expect(reader.list({ first: 21 })).rejects.toThrow('pagination');
});

it('R2 genuinely unknown catalog status remains a whole-response error', async () => {
  const bad = { ...product, status: 'UNSUPPORTED_SYNTHETIC_STATUS' };
  const reader = createCatalogReader({
    async read<T>(): Promise<T> {
      return { product: bad, products: { nodes: [bad], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  });
  await expect(reader.list()).rejects.toThrow('Invalid catalog product');
  await expect(reader.get(id)).rejects.toThrow('Invalid catalog product');
});

it('projects real tags and collections, distinguishes unavailable metadata, and exposes collection truncation', async () => {
  const raw = {
    ...product,
    tags: ['shirts'],
    collections: { nodes: [{ id: 'gid://shopify/Collection/123', title: 'Shirts' }], pageInfo: { hasNextPage: true } },
  };
  const reader = (value: unknown) =>
    createCatalogReader({
      async read<T>(): Promise<T> {
        return { products: { nodes: [value], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
      },
    });
  const result = (await reader(raw).list({ first: 1 })).products[0];
  expect(result).toMatchObject({
    tags: ['shirts'],
    collections: [{ id: 'gid://shopify/Collection/123', title: 'Shirts' }],
    collectionsTruncated: true,
  });
  const missing = (await reader(product).list({ first: 1 })).products[0];
  expect(missing?.tags).toBeUndefined();
  expect(missing?.collections).toBeUndefined();
  await expect(reader({ ...raw, tags: ['shirts', 'shirts'] }).list({ first: 1 })).rejects.toThrow('assignment');
  await expect(
    reader({ ...raw, collections: { ...raw.collections, pageInfo: {} } }).list({ first: 1 }),
  ).rejects.toThrow('assignment');
});

it('keeps image dimensions and option axes from the provider without inventing missing metadata', async () => {
  const raw = {
    ...product,
    featuredMedia: {
      preview: { image: { url: 'https://cdn.shopify.com/photo.png', altText: 'Front', width: 1200, height: 1600 } },
    },
    options: [
      {
        id: 'gid://shopify/ProductOption/8',
        name: 'Size',
        optionValues: [{ id: 'gid://shopify/ProductOptionValue/9', name: 'M' }],
      },
    ],
    media: {
      nodes: [
        {
          __typename: 'MediaImage',
          id: 'gid://shopify/MediaImage/10',
          image: {
            id: 'gid://shopify/ProductImage/12',
            url: 'https://cdn.shopify.com/back.png',
            altText: 'Back',
            width: 1200,
            height: 1600,
          },
        },
        { __typename: 'Video' },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
  const reader = createCatalogReader({
    async read<T>(): Promise<T> {
      return { products: { nodes: [raw], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  });
  const value = (await reader.list({ first: 1 })).products[0];
  expect(value?.image).toMatchObject({ width: 1200, height: 1600, alt: 'Front' });
  expect(value?.options).toEqual([{ id: 'gid://shopify/ProductOption/8', name: 'Size', values: ['M'] }]);
  expect(value?.images).toEqual([
    {
      revisionId: 'image_12',
      image: {
        id: 'gid://shopify/ProductImage/12',
        url: 'https://cdn.shopify.com/back.png',
        width: 1200,
        height: 1600,
        alt: 'Back',
      },
    },
  ]);
  expect(value?.imagesTruncated).toBe(false);
});

it('reads tag assignments in exact bounded identity batches and refuses missing provider nodes', async () => {
  const reader = createCatalogReader({
    async read<T>(operation: string, variables: Record<string, unknown>): Promise<T> {
      expect(operation).toBe('tags');
      expect(variables).toEqual({ ids: [id] });
      return { nodes: [{ id, tags: ['shirts'] }] } as T;
    },
  });
  expect(await reader.productTags([id])).toEqual({ [id]: ['shirts'] });
  const unavailable = createCatalogReader({
    async read<T>(): Promise<T> {
      return { nodes: [null] } as T;
    },
  });
  await expect(unavailable.productTags([id])).rejects.toThrow('identity');
  await expect(unavailable.productTags([id, id])).rejects.toThrow('batch');
});
