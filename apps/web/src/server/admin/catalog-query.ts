import { createHash } from 'node:crypto';
import type { CatalogProduct } from './contracts.js';

export type ProductConfigurationFilter = 'all' | 'not_configured' | 'draft' | 'published' | 'unavailable';
export type CatalogListInput = {
  query: string;
  cursor: string | null;
  limit: number;
  configuration?: ProductConfigurationFilter;
};
export class CatalogQueryError extends Error {
  readonly status: 422 | 503;
  constructor(status: 422 | 503, message: string) {
    super(message);
    this.status = status;
  }
}
const prefix = 'selected-catalog-v1:';
const configState = (product: CatalogProduct) => product.configurationSummary?.state ?? 'unavailable';

/** Filter before pagination. Cursor content only resumes reads; it never selects tenant authority. */
export async function filteredCatalogPage(
  scope: string,
  input: CatalogListInput,
  read: (cursor: string | null, limit: number) => Promise<{ products: CatalogProduct[]; nextCursor: string | null }>,
): Promise<{ products: CatalogProduct[]; nextCursor: string | null }> {
  if (!input.configuration || input.configuration === 'all') return read(input.cursor, input.limit);
  const binding = createHash('sha256')
    .update(JSON.stringify([scope, input.query, input.configuration, input.limit]))
    .digest('hex');
  const token = (after: string | null, offset: number) =>
    prefix + Buffer.from(JSON.stringify({ v: 1, binding, after, offset })).toString('base64url');
  let after: string | null = null,
    offset = 0;
  if (input.cursor) {
    try {
      if (!input.cursor.startsWith(prefix) || input.cursor.length > 1024) throw new Error();
      const value: unknown = JSON.parse(Buffer.from(input.cursor.slice(prefix.length), 'base64url').toString('utf8'));
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'after,binding,offset,v'
      )
        throw new Error();
      const cursor = value as Record<string, unknown>;
      if (
        cursor.v !== 1 ||
        cursor.binding !== binding ||
        !(cursor.after === null || (typeof cursor.after === 'string' && cursor.after.length <= 512)) ||
        !Number.isInteger(cursor.offset) ||
        typeof cursor.offset !== 'number' ||
        cursor.offset < 0 ||
        cursor.offset > 20
      )
        throw new Error();
      after = cursor.after;
      offset = cursor.offset;
    } catch {
      throw new CatalogQueryError(422, 'Invalid product filter cursor');
    }
  }
  const products: CatalogProduct[] = [],
    seenPages = new Set<string | null>(),
    seenProducts = new Set<string>();
  let continuation: string | null = null;
  for (let scan = 0; scan < 25; scan++) {
    if (seenPages.has(after)) throw new CatalogQueryError(503, 'Product catalog pagination did not advance');
    seenPages.add(after);
    const page = await read(after, 20);
    if (page.products.length > 20 || offset > page.products.length)
      throw new CatalogQueryError(503, 'Product catalog changed; reload the list');
    for (let index = offset; index < page.products.length; index++) {
      const product = page.products[index];
      if (!product || seenProducts.has(product.id))
        throw new CatalogQueryError(503, 'Duplicate product catalog identity');
      seenProducts.add(product.id);
      if (configState(product) !== input.configuration) continue;
      if (products.length === input.limit) return { products, nextCursor: continuation };
      products.push(product);
      if (products.length === input.limit) continuation = token(after, index + 1);
    }
    if (!page.nextCursor) return { products, nextCursor: null };
    if (page.nextCursor.length > 512) throw new CatalogQueryError(503, 'Invalid provider product cursor');
    after = page.nextCursor;
    offset = 0;
  }
  throw new CatalogQueryError(503, 'Narrow the product search before applying this configuration filter');
}
