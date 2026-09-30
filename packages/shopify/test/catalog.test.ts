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
