import {
  ARCHIVE,
  CATALOG,
  CATALOGS,
  CREATED_AT,
  DIRECT,
  FINAL,
  FIXTURE,
  MARKER,
  PRESTATE,
  PUBLICATION,
  PUBLICATIONS,
  TARGET,
} from './documents.mjs';
export function provider(options = {}) {
  const calls = [];
  let status = 'ACTIVE';
  const identity = () => ({
    shop: { id: TARGET.shop, myshopifyDomain: TARGET.domain, plan: { partnerDevelopment: true } },
    currentAppInstallation: {
      id: TARGET.installation,
      app: { id: TARGET.app, apiKey: TARGET.client },
      accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings'].map((handle) => ({
        handle,
      })),
    },
  });
  const complete = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null } });
  const product = () => ({
    __typename: 'Product',
    id: FIXTURE,
    handle: MARKER,
    title: MARKER,
    tags: [MARKER],
    createdAt: CREATED_AT,
    status,
    updatedAt: '2026-10-06T21:27:59Z',
    publishedAt: null,
    onlineStoreUrl: null,
    publishedOnPublication: status === 'ACTIVE',
    resourcePublications: complete(
      status === 'ACTIVE'
        ? [{ isPublished: true, publishDate: '2026-10-06T21:27:58Z', publication: { id: PUBLICATION } }]
        : [],
    ),
    unpublishedPublications: complete(status === 'ACTIVE' ? [] : [{ id: PUBLICATION }]),
  });
  const pub = () => ({
    id: PUBLICATION,
    autoPublish: true,
    supportsFuturePublishing: false,
    catalog: { __typename: 'AppCatalog', id: CATALOG, status: 'ACTIVE' },
  });
  async function fetchImpl(url, init) {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
    let data;
    if (body.query === PRESTATE || body.query === FINAL) data = { ...identity(), product: product() };
    else if (body.query === DIRECT)
      data = {
        ...identity(),
        publication: {
          ...pub(),
          includedProducts: complete([{ id: FIXTURE }]),
          channels: {
            nodes: [{ id: 'gid://shopify/Channel/339456917787', app: { id: 'gid://shopify/App/294412484609' } }],
          },
        },
      };
    else if (body.query === PUBLICATIONS) data = { ...identity(), publications: complete([pub()]) };
    else if (body.query === CATALOGS)
      data = {
        ...identity(),
        catalogs: complete([
          { __typename: 'AppCatalog', id: CATALOG, status: 'ACTIVE', publication: { id: PUBLICATION } },
        ]),
      };
    else if (body.query === ARCHIVE) {
      status = 'ARCHIVED';
      data = { productUpdate: { product: product(), userErrors: [] } };
    } else throw new Error('Unexpected synthetic request');
    const override = await options.response?.(data, body, { calls, status });
    return override ?? Response.json({ data });
  }
  return { fetchImpl, calls };
}
