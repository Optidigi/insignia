import { withAdminDeadline } from './admin-deadline.js';
/** Bounded, read-only Admin catalog projection. The caller supplies a verified online grant. */
export interface CatalogTransport {
  read<T>(operation: 'list' | 'detail' | 'currency', variables: Record<string, unknown>): Promise<T>;
}

export type CatalogProduct = {
  id: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  image: { url: string; alt: string | null } | null;
  variants: {
    id: string;
    title: string;
    selectedOptions: { name: string; value: string }[];
    image: { url: string; alt: string | null } | null;
  }[];
  variantsTruncated: boolean;
};

type RawImage = { url: string; altText: string | null } | null;
type RawProduct = {
  id: string;
  title: string;
  status: string;
  featuredMedia: { preview: { image: RawImage } | null } | null;
  variants: {
    nodes: { id: string; title: string; selectedOptions?: { name: string; value: string }[]; image: RawImage }[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

const productFields = 'id title status featuredMedia { preview { image { url altText } } }';
const listFields = `${productFields}
  variants(first: 8) { nodes { id title selectedOptions { name value } image { url altText } } pageInfo { hasNextPage } }`;
const listQuery = `query M5001Products($first: Int!, $after: String, $search: String) {
  products(first: $first, after: $after, query: $search, sortKey: TITLE) {
    nodes { ${listFields} }
    pageInfo { hasNextPage endCursor }
  }
}`;
const detailQuery = `query M5001Product($id: ID!, $after: String) { product(id: $id) {
  ${productFields}
  variants(first: 100, after: $after) { nodes { id title selectedOptions { name value } image { url altText } } pageInfo { hasNextPage endCursor } }
} }`;
const currencyQuery = 'query M5001ShopCurrency { shop { currencyCode } }';
const productGid = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]*$/;

function image(value: RawImage): { url: string; alt: string | null } | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value.url !== 'string' ||
    !/^https:\/\/(?:cdn\.shopify\.com|[a-z0-9.-]+\.shopifycdn\.net)\//.test(value.url)
  )
    throw new Error('Invalid catalog image');
  return { url: value.url, alt: value.altText === null ? null : String(value.altText) };
}

function project(value: RawProduct, maxVariants = 8): CatalogProduct {
  if (
    !value ||
    !productGid.test(value.id) ||
    typeof value.title !== 'string' ||
    !['ACTIVE', 'ARCHIVED', 'DRAFT'].includes(value.status) ||
    !value.variants ||
    !Array.isArray(value.variants.nodes) ||
    value.variants.nodes.length > maxVariants ||
    typeof value.variants.pageInfo?.hasNextPage !== 'boolean'
  )
    throw new Error('Invalid catalog product');
  if (new Set(value.variants.nodes.map((item) => item.id)).size !== value.variants.nodes.length)
    throw new Error('Duplicate catalog variant identity');
  return {
    id: value.id,
    title: value.title,
    status: value.status as CatalogProduct['status'],
    image: image(value.featuredMedia?.preview?.image ?? null),
    variants: value.variants.nodes.map((variant) => {
      if (!variantGid.test(variant.id) || typeof variant.title !== 'string') throw new Error('Invalid catalog variant');
      const selectedOptions = variant.selectedOptions ?? [];
      if (
        !Array.isArray(selectedOptions) ||
        selectedOptions.length > 10 ||
        selectedOptions.some(
          (item) =>
            !item ||
            typeof item.name !== 'string' ||
            typeof item.value !== 'string' ||
            item.name.length > 200 ||
            item.value.length > 200,
        )
      )
        throw new Error('Invalid catalog variant options');
      return { id: variant.id, title: variant.title, selectedOptions, image: image(variant.image) };
    }),
    variantsTruncated: value.variants.pageInfo.hasNextPage,
  };
}

export function createCatalogReader(transport: CatalogTransport) {
  return {
    async shopCurrency(): Promise<string> {
      const response = await transport.read<{ shop: { currencyCode: string } }>('currency', {});
      if (!/^[A-Z]{3}$/.test(response?.shop?.currencyCode ?? '')) throw new Error('Invalid shop currency');
      return response.shop.currencyCode;
    },
    async list(input: { after?: string; search?: string; first?: number } = {}) {
      const first = input.first ?? 20;
      if (
        !Number.isSafeInteger(first) ||
        first < 1 ||
        first > 20 ||
        (input.after !== undefined && input.after.length > 512) ||
        (input.search !== undefined && input.search.length > 128)
      )
        throw new Error('Invalid catalog pagination');
      const response = await transport.read<{
        products: { nodes: RawProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      }>('list', { first, after: input.after ?? null, search: input.search ?? null });
      if (
        !response?.products ||
        !Array.isArray(response.products.nodes) ||
        response.products.nodes.length > first ||
        typeof response.products.pageInfo?.hasNextPage !== 'boolean' ||
        (response.products.pageInfo.hasNextPage &&
          (typeof response.products.pageInfo.endCursor !== 'string' ||
            response.products.pageInfo.endCursor.length === 0 ||
            response.products.pageInfo.endCursor.length > 512))
      )
        throw new Error('Invalid catalog response');
      const products = response.products.nodes.map((item) => project(item));
      if (new Set(products.map((item) => item.id)).size !== products.length)
        throw new Error('Duplicate catalog product identity');
      return {
        products,
        nextCursor: response.products.pageInfo.hasNextPage ? response.products.pageInfo.endCursor : null,
      };
    },
    async get(productId: string): Promise<CatalogProduct | null> {
      if (!productGid.test(productId)) throw new Error('Invalid product ID');
      let after: string | null = null;
      let product: CatalogProduct | null = null;
      const seenVariants = new Set<string>();
      const seenCursors = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const response: { product: RawProduct | null } = await transport.read<{ product: RawProduct | null }>(
          'detail',
          { id: productId, after },
        );
        if (!response || !Object.hasOwn(response, 'product')) throw new Error('Invalid catalog response');
        if (!response.product) {
          if (page > 0) throw new Error('Catalog product disappeared during pagination');
          return null;
        }
        const slice = project(response.product, 100);
        if (slice.id !== productId || (product && (slice.title !== product.title || slice.status !== product.status)))
          throw new Error('Catalog product identity mismatch');
        if (!product) product = { ...slice, variants: [] };
        for (const variant of slice.variants) {
          if (seenVariants.has(variant.id)) throw new Error('Duplicate catalog variant identity');
          seenVariants.add(variant.id);
          product.variants.push(variant);
        }
        if (!slice.variantsTruncated) {
          product.variantsTruncated = false;
          return product;
        }
        const cursor: string | null | undefined = response.product.variants.pageInfo.endCursor;
        if (!cursor || cursor.length > 512 || seenCursors.has(cursor)) throw new Error('Invalid variant pagination');
        seenCursors.add(cursor);
        after = cursor;
      }
      if (!product) throw new Error('Catalog product missing');
      product.variantsTruncated = true;
      return product;
    },
  };
}

/** Construct only after online staff authorization and active-installation binding. */
export function createCatalogTransport(input: {
  shop: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): CatalogTransport {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(input.shop) || !input.accessToken)
    throw new Error('Invalid catalog transport scope');
  return {
    async read<T>(operation: 'list' | 'detail' | 'currency', variables: Record<string, unknown>): Promise<T> {
      const query = operation === 'list' ? listQuery : operation === 'detail' ? detailQuery : currencyQuery;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      return withAdminDeadline(
        async (signal) => {
          const response = await (input.fetchImpl ?? fetch)(`https://${input.shop}/admin/api/2026-07/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': input.accessToken },
            body: JSON.stringify({ query, variables }),
            signal,
          });
          if (!response.ok) throw new Error('Catalog read failed');
          reader = response.body?.getReader();
          if (!reader) throw new Error('Catalog response body missing');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 1_000_000) throw new Error('Catalog response too large');
              chunks.push(part.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally {
            reader.releaseLock();
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
          } catch {
            throw new Error('Catalog JSON response invalid');
          }
          if (
            !payload ||
            typeof payload !== 'object' ||
            (payload as { errors?: unknown }).errors !== undefined ||
            (payload as { data?: unknown }).data === undefined
          )
            throw new Error('Catalog GraphQL response invalid');
          return (payload as { data: T }).data;
        },
        'Catalog read',
        () => {
          void reader?.cancel().catch(() => {});
        },
      );
    },
  };
}
