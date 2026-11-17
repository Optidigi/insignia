import { createDurableCore } from '@insignia/database';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { Pool } from 'pg';
import { adminServices } from '../admin/runtime.ts';
import { createFrozenPreviewReader } from '../merchant-preview/read.ts';
import type { PurchaseHttpServices } from './http.ts';
import { createPurchaseServices } from './service.ts';
/** An integrated source is not an activation grant. Missing native context remains an explicit binding exception. */
export async function createProductionPurchaseServices(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PurchaseHttpServices | undefined> {
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
    const services = createPurchaseServices({
      core,
      appOrigin,
      authenticate: async (request, options) => (await adminServices()?.authenticate(request, options)) ?? null,
      assertCurrentAccess: async (actor) => {
        const assertAccess = adminServices()?.assertPurchaseAccess;
        if (!assertAccess) throw new Error('Current merchant authority unavailable');
        await assertAccess(actor);
      },
      timeZone: async (actor) => {
        const read = adminServices()?.shopTimeZone;
        if (!read) throw new Error('Store calendar unavailable');
        return read(actor);
      },
      orderNames: async (actor, orderIds) => (await adminServices()?.orderNames?.(actor, orderIds)) ?? {},
      orderPresentation: async (actor, target) => (await adminServices()?.orderPresentation?.(actor, target)) ?? null,
      storage,
      previewImages:
        env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED === '1' && storage
          ? createFrozenPreviewReader({ store: core.merchantPreviews, storage })
          : undefined,
    });
    // Unexpected failures share the admin logger (admin_request_failed), as the other staff routes do.
    return { ...services, recordAdminFailure: (failure) => adminServices()?.recordAdminFailure?.(failure) };
  } catch (error) {
    await core.close();
    throw error;
  }
}
