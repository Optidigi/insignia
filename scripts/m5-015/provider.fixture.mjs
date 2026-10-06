const target = {
  app: 'gid://shopify/App/429028933633',
  client: '1443cf6d03d39edae7c101a943c5c684',
  shop: 'gid://shopify/Shop/105501393179',
  domain: 'insignia-rewrite-dev.myshopify.com',
  installation: 'gid://shopify/AppInstallation/1054356963611',
};
export function provider(options = {}) {
  let product;
  const calls = [];
  const identity = () => ({
    shop: { id: target.shop, myshopifyDomain: target.domain, plan: { partnerDevelopment: true } },
    currentAppInstallation: {
      id: target.installation,
      app: { id: target.app, apiKey: target.client },
      accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings'].map((handle) => ({
        handle,
      })),
    },
  });
  const projection = () => ({
    __typename: 'Product',
    id: product.id,
    status: product.status,
    updatedAt: product.updatedAt,
    publishedAt: null,
    onlineStoreUrl: null,
    resourcePublications: {
      nodes:
        product.status === 'ACTIVE' && options.effective !== false
          ? [
              {
                publication: { id: 'gid://shopify/Publication/303' },
                isPublished: true,
                publishDate: product.createdAt,
              },
            ]
          : [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    },
  });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith('/admin/oauth/access_token'))
      return Response.json({ access_token: 'synthetic-token', expires_in: 7200 });
    const id = identity();
    options.identity?.(id);
    if (body.query.startsWith('query M5015Identity')) return Response.json({ data: id });
    if (body.query.startsWith('mutation M5015Create')) {
      product = {
        __typename: 'Product',
        id: 'gid://shopify/Product/202',
        ...body.variables.product,
        createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
        updatedAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
      };
      options.created?.(product);
      return Response.json({ data: { productCreate: { product, userErrors: [] } } });
    }
    if (body.query.startsWith('query M5015Find'))
      return Response.json({
        data: {
          ...id,
          products: { nodes: product ? [product] : [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
        },
      });
    if (body.query.startsWith('query M5015Owned')) {
      options.owned?.(product);
      return Response.json({ data: { ...id, product } });
    }
    if (
      body.query.startsWith('mutation M5015Status') ||
      body.query.startsWith('mutation InsigniaAvailabilityV2Status')
    ) {
      product.status = body.variables.product.status;
      options.status?.(product, body);
      return Response.json({
        data: {
          productUpdate: {
            product: body.query.startsWith('mutation M5015Status') ? product : projection(),
            userErrors: [],
          },
        },
      });
    }
    if (body.query.startsWith('query InsigniaAvailabilityV2')) {
      const data = {
        shop: { id: target.shop },
        currentAppInstallation: {
          app: { apiKey: target.client },
          accessScopes: id.currentAppInstallation.accessScopes,
        },
        node: projection(),
        publications: {
          nodes: [
            {
              id: 'gid://shopify/Publication/303',
              autoPublish: true,
              supportsFuturePublishing: true,
              includedProducts: {
                nodes: [{ id: product.id }],
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
              },
            },
          ],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null },
        },
      };
      options.snapshot?.(data, product);
      return Response.json({ data });
    }
    throw new Error('Unexpected synthetic request');
  };
  return { fetchImpl, calls, product: () => product };
}
