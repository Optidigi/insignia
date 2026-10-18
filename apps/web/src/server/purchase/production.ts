import { createDurableCore } from '@insignia/database';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { adminServices } from '../admin/runtime.ts';
import { createFrozenPreviewReader } from '../merchant-preview/read.ts';
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
  const core = createDurableCore(
    new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      statement_timeout: 10000,
    }),
  );
  try {
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
      assertCurrentAccess: async (actor) => {
        const assertAccess = adminServices()?.assertPurchaseAccess;
        if (!assertAccess) throw new Error('Current merchant authority unavailable');
        await assertAccess(actor);
      },
      orderNames: async (actor, orderIds) => (await adminServices()?.orderNames?.(actor, orderIds)) ?? {},
      orderPresentation: async (actor, target) => (await adminServices()?.orderPresentation?.(actor, target)) ?? null,
      storage,
      previewImages:
        env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED === '1' && storage
          ? createFrozenPreviewReader({ store: core.merchantPreviews, storage })
          : undefined,
    });
  } catch (error) {
    await core.close();
    throw error;
  }
}
