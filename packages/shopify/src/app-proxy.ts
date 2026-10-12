import '@shopify/shopify-api/adapters/node';
import { ApiVersion, shopifyApi } from '@shopify/shopify-api';

/** Only Shopify's authenticated query identity crosses this adapter boundary. */
export function createAppProxyVerifier(input: {
  apiKey: string;
  apiSecret: string;
  hostName: string;
  pathPrefix: string;
}) {
  if (!/^\/apps\/[a-z0-9-]{1,64}$/.test(input.pathPrefix)) throw new Error('Invalid App Proxy configuration');
  const api = shopifyApi({
    apiKey: input.apiKey,
    apiSecretKey: input.apiSecret,
    hostName: input.hostName,
    scopes: [],
    apiVersion: ApiVersion.July26,
    isEmbeddedApp: true,
    logger: { log: () => {} },
  });
  return async (url: URL): Promise<{ shop: string } | null> => {
    if (url.search.length > 8192) return null;
    const params = url.searchParams;
    if (
      params.getAll('shop').length !== 1 ||
      params.getAll('path_prefix').length !== 1 ||
      params.get('path_prefix') !== input.pathPrefix ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(params.get('shop') ?? '')
    )
      return null;
    try {
      if (!(await api.utils.validateHmac(params, { signator: 'appProxy' }))) return null;
      return { shop: params.get('shop') as string };
    } catch {
      return null;
    }
  };
}
