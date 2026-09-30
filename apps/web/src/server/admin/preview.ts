/** M5-002 explicit development diagnostic composition. Never a publication or production authority. */
import { randomUUID } from 'node:crypto';
import { createDurableCore } from '@insignia/database';
import {
  createAdminOnlineIdentity,
  createCatalogReader,
  createFunctionOwnershipReconciler,
  createPublicationAdminHttpTransport,
  createCatalogTransport,
  type OnlineStaffGrant,
  type CatalogProduct as ProviderProduct,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../merchant-config.js';
import { createAdminAuthenticator } from './auth.js';
import type { AdminActor, AdminServices, CatalogProduct } from './contracts.js';
import { createPreviewGrantCache } from './preview-grant.js';

function project(value: ProviderProduct): CatalogProduct {
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    imageUrl: value.image?.url ?? null,
    variants: value.variants.map((item) => ({
      id: item.id,
      title: item.title,
      imageUrl: item.image?.url ?? null,
      selectedOptions: item.selectedOptions,
    })),
    variantsTruncated: value.variantsTruncated,
  };
}
export function createDiagnosticPreviewServices(env: NodeJS.ProcessEnv): AdminServices & { close(): Promise<void> } {
  const client = env.SHOPIFY_CLIENT_ID ?? '';
  const shop = env.INSIGNIA_M5_002_SHOP ?? '';
  const shopId = env.INSIGNIA_M5_002_SHOP_ID ?? '';
  const retained = env.INSIGNIA_M5_002_PRODUCT_ID ?? '';
  if (
    env.INSIGNIA_M5_002_DIAGNOSTIC !== '1' ||
    !globalThis.__insigniaM5002Reserve ||
    !globalThis.__insigniaM5002Observe ||
    !/^([0-9a-f]{32})$/.test(client) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shopId) ||
    !/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(retained) ||
    !env.SHOPIFY_CLIENT_SECRET ||
    !env.DATABASE_URL ||
    !env.APP_URL ||
    new URL(env.APP_URL).protocol !== 'https:'
  )
    throw new Error('Diagnostic preview configuration unavailable');
  const core = createDurableCore(new Pool({ connectionString: env.DATABASE_URL }));
  const sdk = createAdminOnlineIdentity({
    apiKey: client,
    apiSecret: env.SHOPIFY_CLIENT_SECRET,
    hostName: new URL(env.APP_URL).host,
  });
  const cache = createPreviewGrantCache(async (token, identity) => {
    return sdk.exchangeOnline(token, identity);
  });
  const grants = new WeakMap<AdminActor, OnlineStaffGrant>();
  const products = new WeakMap<AdminActor, Map<string, Promise<CatalogProduct | null>>>();
  const currencies = new WeakMap<AdminActor, Promise<string>>();
  async function active(actor: AdminActor) {
    const current = await core.tenants.getCurrentAdminInstallation(actor.tenantShopId);
    if (
      !current?.active ||
      current.generation !== actor.installationGeneration ||
      current.externalInstallationId !== actor.installationId ||
      actor.shop !== shop ||
      actor.shopId !== shopId
    ) {
      cache.clear();
      throw new Error('Diagnostic installation changed');
    }
  }
  function reader(actor: AdminActor) {
    const grant = grants.get(actor);
    if (!grant || grant.expiresAtMs <= Date.now() + 30_000) throw new Error('Diagnostic grant missing');
    return createCatalogReader(createCatalogTransport({ shop, accessToken: grant.accessToken }));
  }
  const catalog = {
    async list(actor: AdminActor, input: { query: string; cursor: string | null; limit: number }) {
      await active(actor);
      const result = await reader(actor).list({
        search: input.query,
        after: input.cursor ?? undefined,
        first: input.limit,
      });
      await active(actor);
      return { products: result.products.map(project), nextCursor: result.nextCursor };
    },
    async get(actor: AdminActor, id: string) {
      await active(actor);
      if (id !== retained) return null;
      let map = products.get(actor);
      if (!map) {
        map = new Map();
        products.set(actor, map);
      }
      if (!map.has(id))
        map.set(
          id,
          reader(actor)
            .get(id)
            .then((found) => (found ? project(found) : null)),
        );
      const result = await map.get(id)!;
      await active(actor);
      return result;
    },
    async shopCurrency(actor: AdminActor) {
      await active(actor);
      if (!currencies.has(actor)) currencies.set(actor, reader(actor).shopCurrency());
      const result = await currencies.get(actor)!;
      await active(actor);
      return result;
    },
  };
  const service = createMerchantConfigService({
    core,
    catalog,
    eligibility: async () => ({ allowed: false, reason: 'Diagnostic preview: publication is disabled' }),
    publication() {
      throw new Error('Diagnostic preview forbids remote publication');
    },
  });
  let bootstrap: Promise<void> | undefined;
  let observation: Promise<void> | undefined;
  return {
    close: () => core.close(),
    appOrigin: env.APP_URL,
    async authenticate(request) {
      let online: OnlineStaffGrant | undefined;
      const authenticate = createAdminAuthenticator({
        verifySessionToken: sdk.verify,
        async exchangeOnlineGrant(token, identity) {
          if (identity.shop !== shop) throw new Error('Diagnostic target mismatch');
          online = await cache.acquire(token, identity);
          return online;
        },
        async readInstallation() {
          if (!online) throw new Error('Diagnostic grant missing');
          let provider: Awaited<ReturnType<typeof sdk.readInstallation>>;
          try {
            provider = await sdk.readInstallation(online);
          } catch (error) {
            cache.clear();
            throw error;
          }
          if (provider.shop !== shop || provider.shopId !== shopId) {
            cache.clear();
            throw new Error('Diagnostic provider identity mismatch');
          }
          bootstrap ??= (async () => {
            const existing = await core.tenants.getShopByDomain(shop);
            if (!existing)
              await core.transactions.run((tx) =>
                core.tenants.createShop(tx, {
                  shopId: randomUUID(),
                  shopDomain: shop,
                  shopifyShopId: shopId.split('/').at(-1)!,
                  externalInstallationId: provider.installationId,
                }),
              );
          })();
          await bootstrap;
          const tenant = await core.tenants.getShopByDomain(shop);
          if (!tenant || tenant.shopifyShopId !== shopId.split('/').at(-1))
            throw new Error('Diagnostic tenant identity mismatch');
          const current = await core.tenants.getCurrentAdminInstallation(tenant.shopId);
          if (!current?.active || current.externalInstallationId !== provider.installationId) {
            cache.clear();
            throw new Error('Diagnostic generation changed');
          }
          return {
            ...provider,
            trustedInstallationId: current.externalInstallationId,
            tenantShopId: tenant.shopId,
            installationGeneration: current.generation,
            active: current.active,
          };
        },
      });
      const actor = await authenticate(request);
      if (actor && online) {
        grants.set(actor, online);
        if (
          actor.canRead &&
          env.INSIGNIA_M5_002_APP_RESOURCE &&
          env.INSIGNIA_M5_002_TRANSFORM_QUERY_HASH &&
          env.INSIGNIA_M5_002_VALIDATION_QUERY_HASH
        ) {
          const bound = actor,
            grant = online;
          observation ??= (async () => {
            try {
              const functions = await createFunctionOwnershipReconciler({
                transport: createPublicationAdminHttpTransport({
                  credentials: {
                    async acquire(scope) {
                      await active(bound);
                      if (
                        scope.shopId !== bound.tenantShopId ||
                        scope.installationGeneration !== bound.installationGeneration
                      )
                        return { kind: 'inactive' as const };
                      return {
                        kind: 'usable' as const,
                        shopDomain: shop,
                        accessToken: grant.accessToken,
                        accessExpiresAt: new Date(grant.expiresAtMs),
                      };
                    },
                  },
                }),
              }).read(
                {
                  shopId: bound.tenantShopId,
                  installationGeneration: bound.installationGeneration,
                  shopifyShopId: shopId,
                  appId: env.INSIGNIA_M5_002_APP_RESOURCE!,
                },
                {
                  appKey: client,
                  transformInputQuerySha256: env.INSIGNIA_M5_002_TRANSFORM_QUERY_HASH!,
                  validationInputQuerySha256: env.INSIGNIA_M5_002_VALIDATION_QUERY_HASH!,
                },
              );
              await active(bound);
              globalThis.__insigniaM5002Observe?.({ kind: 'function_objects', functions });
            } catch {
              globalThis.__insigniaM5002Observe?.({ kind: 'function_objects_unavailable' });
            }
          })();
          await observation;
        }
      }
      globalThis.__insigniaM5002Observe?.({
        kind: 'authentication',
        path: new URL(request.url).pathname,
        authorized: !!actor,
        canRead: actor?.canRead ?? false,
        canEdit: actor?.canEdit ?? false,
      });
      return actor;
    },
    catalog,
    configs: {
      ...service,
      async save(actor, id, input) {
        const result = await service.save(actor, id, input);
        globalThis.__insigniaM5002Observe?.({
          kind: 'local_save',
          result: result.kind,
          draftVersion: result.kind === 'saved' ? result.draftVersion : null,
        });
        return result;
      },
      async copy() {
        return { kind: 'forbidden', message: 'Diagnostic preview is limited to the retained product' };
      },
      async publish() {
        return { kind: 'forbidden', message: 'Diagnostic preview cannot publish or activate' };
      },
    },
  };
}

declare global {
  var __insigniaM5002Reserve: undefined | ((kind: 'adminAuth') => void);
  var __insigniaM5002Observe: undefined | ((event: Record<string, unknown>) => void);
}
