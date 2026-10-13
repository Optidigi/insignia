import { createM3AdminReadCredentialSource } from '@insignia/application';
import { currencyExponent } from '@insignia/cart-authorization';
import { createDurableCore } from '@insignia/database';
import { createShopifyOfflineRefreshTransport, readShopifyOrder } from '@insignia/shopify';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { loadCredentialKeys } from '../../../../worker/src/config.ts';
import { credentialLifecycle } from '../../../../worker/src/handlers.ts';
import { adminServices } from '../admin/runtime.ts';
import { createPurchaseServices, type PurchaseServices } from './service.ts';
/** An integrated source is not an activation grant. Missing native context remains an explicit binding exception. */
export async function createProductionPurchaseServices(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PurchaseServices | undefined> {
  if (env.INSIGNIA_M8_PURCHASE_ENABLED !== '1') return undefined;
  const required = (key: string) => {
    const value = env[key];
    if (!value || /[\r\n\0]/.test(value)) throw new Error('Purchase configuration unavailable');
    return value;
  };
  const appOrigin = required('APP_URL');
  const url = new URL(appOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Purchase origin unavailable');
  const connectionString = required('DATABASE_URL');
  const clientId = required('SHOPIFY_CLIENT_ID'),
    clientSecret = required('SHOPIFY_CLIENT_SECRET');
  const keys = loadCredentialKeys(env);
  const core = createDurableCore(
    new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      statement_timeout: 10000,
    }),
    { credentialKeys: keys },
  );
  try {
    const credentials = createM3AdminReadCredentialSource({
      tenants: core.tenants,
      credentials: credentialLifecycle(core),
      refresh: createShopifyOfflineRefreshTransport({ clientId, clientSecret }),
    });
    const storage = env.ARTWORK_STORAGE_PROFILE
      ? await loadArtworkStorageProfile(env.ARTWORK_STORAGE_PROFILE, {
          endpoint: required('ARTWORK_R2_ENDPOINT'),
          bucket: required('ARTWORK_R2_BUCKET'),
          prefix: required('ARTWORK_R2_PREFIX'),
        })
      : undefined;
    return createPurchaseServices({
      core,
      appOrigin,
      authenticate: async (request) => (await adminServices()?.authenticate(request)) ?? null,
      orders: {
        read: (target) =>
          readShopifyOrder(target, { credentials, currency: { exponent: (code) => currencyExponent(code) ?? null } }),
      },
      storage,
    });
  } catch (error) {
    await core.close();
    for (const key of Object.values(keys.keys)) key.fill(0);
    throw error;
  }
}
