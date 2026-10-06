import { identity, requireValue } from '../m5-015r/operator.mjs';
import { CREATED_AT, FIXTURE, MARKER, PUBLICATION } from './documents.mjs';

export { identity };

const pick = (v, names) => v && Object.fromEntries(names.map((k) => [k, v[k]]));
const date = (v) =>
  typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
export const gid = (kind, v) => typeof v === 'string' && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]{0,30}$`).test(v);
const connection = (c, select, cursor = false) =>
  c && {
    nodes: Array.isArray(c.nodes) ? c.nodes.map(select) : c.nodes,
    pageInfo: pick(c.pageInfo, ['hasNextPage', 'hasPreviousPage', ...(cursor ? ['endCursor'] : [])]),
  };
const catalog = (c) => (c === null ? null : pick(c, ['__typename', 'id', 'status']));
const publication = (p) =>
  p && { ...pick(p, ['id', 'autoPublish', 'supportsFuturePublishing']), catalog: catalog(p.catalog) };
export const selectProduct = (p, visibility = true) =>
  p && {
    ...pick(p, ['__typename', 'id', 'handle', 'title', 'tags', 'createdAt', 'status', 'updatedAt']),
    ...(visibility
      ? {
          ...pick(p, ['publishedAt', 'onlineStoreUrl', 'publishedOnPublication']),
          resourcePublications: connection(
            p.resourcePublications,
            (n) => n && { ...pick(n, ['isPublished', 'publishDate']), publication: pick(n.publication, ['id']) },
          ),
          unpublishedPublications: connection(p.unpublishedPublications, (n) => pick(n, ['id'])),
        }
      : {}),
  };
export const selectedIdentity = (data) => ({
  shop: data.shop && {
    ...pick(data.shop, ['id', 'myshopifyDomain']),
    plan: pick(data.shop.plan, ['partnerDevelopment']),
  },
  currentAppInstallation: data.currentAppInstallation && {
    ...pick(data.currentAppInstallation, ['id']),
    app: pick(data.currentAppInstallation.app, ['id', 'apiKey']),
    accessScopes: Array.isArray(data.currentAppInstallation.accessScopes)
      ? data.currentAppInstallation.accessScopes.map((n) => pick(n, ['handle']))
      : data.currentAppInstallation.accessScopes,
  },
});
export function selected(data, operation) {
  if (operation === 'archive')
    return {
      productUpdate: data.productUpdate && {
        product: selectProduct(data.productUpdate.product, false),
        userErrors: Array.isArray(data.productUpdate.userErrors)
          ? data.productUpdate.userErrors.map(() => ({ message: '<provider user error>' }))
          : data.productUpdate.userErrors,
      },
    };
  const i = selectedIdentity(data);
  if (operation === 'prestate' || operation === 'final') return { ...i, product: selectProduct(data.product) };
  if (operation === 'direct')
    return {
      ...i,
      publication:
        data.publication === null
          ? null
          : {
              ...publication(data.publication),
              includedProducts: connection(data.publication?.includedProducts, (n) => pick(n, ['id'])),
              channels: data.publication?.channels && {
                nodes: data.publication.channels.nodes?.map((n) => n && { id: n.id, app: pick(n.app, ['id']) }),
              },
            },
    };
  if (operation === 'publications') return { ...i, publications: connection(data.publications, publication, true) };
  return {
    ...i,
    catalogs: connection(
      data.catalogs,
      (n) => n && { ...catalog(n), publication: n.publication === null ? null : pick(n.publication, ['id']) },
      true,
    ),
  };
}
export function owned(p) {
  requireValue(
    p?.__typename === 'Product' &&
      p.id === FIXTURE &&
      p.handle === MARKER &&
      p.title === MARKER &&
      JSON.stringify(p.tags) === JSON.stringify([MARKER]) &&
      p.createdAt === CREATED_AT &&
      date(p.updatedAt) &&
      ['ACTIVE', 'ARCHIVED'].includes(p.status),
    'ownership',
  );
  return p;
}
export function complete(c, maximum = 250) {
  requireValue(
    Array.isArray(c?.nodes) &&
      c.nodes.length <= maximum &&
      c.pageInfo?.hasNextPage === false &&
      c.pageInfo.hasPreviousPage === false,
    'incomplete_connection',
  );
  return c.nodes;
}
export function visible(p, prestate) {
  owned(p);
  const nodes = complete(p.resourcePublications);
  requireValue(
    nodes.every(
      (n) => gid('Publication', n?.publication?.id) && typeof n.isPublished === 'boolean' && date(n.publishDate),
    ) && new Set(nodes.map((n) => n.publication.id)).size === nodes.length,
    'publication_shape',
  );
  const unpublished = complete(p.unpublishedPublications);
  requireValue(
    unpublished.every((n) => gid('Publication', n?.id)) &&
      new Set(unpublished.map((n) => n.id)).size === unpublished.length,
    'publication_shape',
  );
  requireValue(
    (p.publishedAt === null || date(p.publishedAt)) &&
      (p.onlineStoreUrl === null ||
        (typeof p.onlineStoreUrl === 'string' &&
          /^https:\/\//.test(p.onlineStoreUrl) &&
          p.onlineStoreUrl.length <= 2048)),
    'visibility_shape',
  );
  requireValue(
    prestate
      ? p.status === 'ACTIVE' &&
          p.publishedOnPublication === true &&
          nodes.some((n) => n.isPublished && n.publication.id === PUBLICATION)
      : p.status === 'ARCHIVED' &&
          p.publishedOnPublication === false &&
          !nodes.some((n) => n.isPublished) &&
          p.onlineStoreUrl === null,
    prestate ? 'prestate_drift' : 'final_state',
  );
  return p;
}
export function validateCatalog(c, app = false) {
  requireValue(
    c === null ||
      (['AppCatalog', 'MarketCatalog', 'CompanyLocationCatalog'].includes(c?.__typename) &&
        (!app || c.__typename === 'AppCatalog') &&
        gid(c.__typename, c.id) &&
        ['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(c.status)),
    'catalog_shape',
  );
}
export function validatePublication(p) {
  requireValue(
    gid('Publication', p?.id) && typeof p.autoPublish === 'boolean' && typeof p.supportsFuturePublishing === 'boolean',
    'publication_shape',
  );
  validateCatalog(p.catalog, true);
}
export function directIncluded(p) {
  requireValue(
    p?.id === PUBLICATION && typeof p.autoPublish === 'boolean' && typeof p.supportsFuturePublishing === 'boolean',
    'direct_publication',
  );
  validateCatalog(p.catalog);
  const nodes = complete(p.includedProducts, 2);
  requireValue(nodes.length <= 1 && nodes.every((n) => n.id === FIXTURE), 'direct_inclusion');
  requireValue(
    Array.isArray(p.channels?.nodes) &&
      p.channels.nodes.length <= 2 &&
      p.channels.nodes.every((n) => gid('Channel', n?.id) && gid('App', n.app?.id)),
    'channels_shape',
  );
  return nodes.length === 1;
}
