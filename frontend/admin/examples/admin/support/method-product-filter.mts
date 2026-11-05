import type { MethodProduct } from './method-configuration.mts';

export type MethodProductSearchBy = 'title' | 'id' | 'all';

export interface MethodProductFilters {
  query?: string;
  searchBy?: MethodProductSearchBy;
  collectionId?: string;
  tag?: string;
  selectedOnly?: boolean;
  selectedIds?: readonly string[];
}

export interface MethodProductFilterOptions {
  collections: { id: string; title: string }[];
  tags: string[];
}

export function filterMethodProducts(
  products: readonly MethodProduct[],
  filters: MethodProductFilters = {},
  formatLocale = 'en',
): MethodProduct[] {
  const query = filters.query?.trim().toLocaleLowerCase(formatLocale) ?? '';
  const searchBy = filters.searchBy ?? 'title';
  const selectedIds = filters.selectedOnly ? new Set(filters.selectedIds ?? []) : null;

  return products.filter((product) => {
    if (selectedIds && !selectedIds.has(product.id)) return false;
    if (filters.collectionId && !product.collections?.some(({ id }) => id === filters.collectionId)) return false;
    if (filters.tag && !product.tags.includes(filters.tag)) return false;
    if (!query) return true;

    const searchable =
      searchBy === 'title'
        ? product.title
        : searchBy === 'id'
          ? product.id
          : [product.title, product.id, ...product.tags, ...(product.collections ?? []).map(({ title }) => title)].join(
              ' ',
            );
    return searchable.toLocaleLowerCase(formatLocale).includes(query);
  });
}

export function methodProductFilterOptions(
  products: readonly MethodProduct[],
  formatLocale = 'en',
): MethodProductFilterOptions {
  const collectionsById = new Map<string, { id: string; title: string }>();
  const tags = new Set<string>();

  for (const product of products) {
    for (const collection of product.collections ?? []) {
      const existing = collectionsById.get(collection.id);
      if (!existing || collection.title.localeCompare(existing.title, formatLocale) < 0) {
        collectionsById.set(collection.id, { id: collection.id, title: collection.title });
      }
    }
    for (const tag of product.tags) tags.add(tag);
  }

  return {
    collections: [...collectionsById.values()].sort(
      (left, right) => left.title.localeCompare(right.title, formatLocale) || left.id.localeCompare(right.id, 'en'),
    ),
    tags: [...tags].sort((left, right) => left.localeCompare(right, formatLocale)),
  };
}
