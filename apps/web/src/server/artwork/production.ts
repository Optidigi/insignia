import { createArtworkService } from '@insignia/application';
import { createAppProxyVerifier } from '@insignia/shopify';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { adminServices } from '../admin/runtime.js';
import { buyerServices } from '../buyer/runtime.ts';
import { webRuntime } from '../runtime.js';
import { createArtworkGuestAuthority } from './guest.js';
import type { ArtworkHttpServices } from './http.js';
import { ensureArtworkInspectionReady } from './readiness.ts';

/** Existing adapters and current authentication remain the production authorities. */
export async function createProductionArtworkServices(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ArtworkHttpServices> {
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new Error('Artwork configuration missing');
    return value;
  };
  const appOrigin = required('APP_URL');
  const storage = await loadArtworkStorageProfile(required('ARTWORK_STORAGE_PROFILE'), {
    endpoint: required('ARTWORK_R2_ENDPOINT'),
    bucket: required('ARTWORK_R2_BUCKET'),
    prefix: required('ARTWORK_R2_PREFIX'),
  });
  const { core } = await webRuntime();
  const artwork = createArtworkService({
    store: core.artwork,
    storage,
    inspect: async () => {
      throw new Error('Inspection belongs to the isolated worker');
    },
  });
  const proxyPrefix = env.ARTWORK_PROXY_PATH_PREFIX;
  const guest =
    (await buyerServices())?.guest ??
    (proxyPrefix
      ? createArtworkGuestAuthority({
          core,
          secret: required('SHOPIFY_CLIENT_SECRET'),
          verifyProxy: createAppProxyVerifier({
            apiKey: required('SHOPIFY_CLIENT_ID'),
            apiSecret: required('SHOPIFY_CLIENT_SECRET'),
            hostName: new URL(appOrigin).host,
            pathPrefix: proxyPrefix,
          }),
        })
      : undefined);
  return {
    appOrigin,
    artwork,
    authenticate: async (request) => (await adminServices()?.authenticate(request)) ?? null,
    verifyGuest: guest?.verify,
    issueGuest: guest?.issue,
    async ensureInspectionReady() {
      await ensureArtworkInspectionReady({
        socketPath: env.ARTWORK_WORKER_READY_SOCKET,
        url: env.ARTWORK_WORKER_READY_URL,
      });
    },
  };
}
