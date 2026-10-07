import {
  type ActivationReadinessPort,
  bindProviderSubscription,
  type EntitlementPolicyConfig,
  projectEntitlement,
} from '@insignia/application';
import type { MerchantDraft } from '@insignia/contracts';
import { createDurableCore } from '@insignia/database';
import {
  createActiveSubscriptionClient,
  createAdminOnlineIdentity,
  createCatalogReader,
  createCatalogTransport,
  createPartnerGraphqlTransport,
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldV3Port,
  type OnlineStaffGrant,
  type CatalogProduct as ShopifyCatalogProduct,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../merchant-config.js';
import { type AdminInstallation, createAdminAuthenticator } from './auth.js';
import type { AdminActor, AdminServices, CatalogProduct } from './contracts.js';
import { createServerActivationReadiness } from './release-evidence.js';

function project(value: ShopifyCatalogProduct): CatalogProduct {
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
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error('Admin configuration incomplete');
  return value;
}
type FeatureRules = { base: string; required: string; logoLater: string; options: string; pricing: string };
function featurePolicy(env: NodeJS.ProcessEnv): { catalog: EntitlementPolicyConfig; features: FeatureRules } | null {
  if (!env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON || !env.INSIGNIA_M5_FEATURES_JSON) return null;
  const catalog = JSON.parse(env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON) as EntitlementPolicyConfig;
  const features = JSON.parse(env.INSIGNIA_M5_FEATURES_JSON) as FeatureRules;
  if (
    !catalog ||
    !Array.isArray(catalog.plans) ||
    !features ||
    ['base', 'required', 'logoLater', 'options', 'pricing'].some(
      (key) => typeof features[key as keyof FeatureRules] !== 'string' || !features[key as keyof FeatureRules],
    )
  )
    throw new Error('Admin entitlement policy invalid');
  return { catalog, features };
}

/** Production composition binds every request to an online staff grant and current M3 installation. */
export function createProductionAdminServices(
  env: NodeJS.ProcessEnv = process.env,
  databasePool?: Pool,
  // Inject only provider/entitlement time; identity and online grants keep real time.
  entitlementClock: () => Date = () => new Date(),
  // Server-owned capability only; never constructed from HTTP or environment JSON.
  activationReadiness?: Omit<ActivationReadinessPort, 'observeProjection'>,
): AdminServices {
  const databaseUrl = required(env, 'DATABASE_URL');
  const apiKey = required(env, 'SHOPIFY_CLIENT_ID');
  const apiSecret = required(env, 'SHOPIFY_CLIENT_SECRET');
  const appOrigin = required(env, 'APP_URL');
  const appId = env.INSIGNIA_SHOPIFY_APP_ID;
  const appGid = appId && /^[1-9][0-9]*$/.test(appId) ? 'gid://shopify/App/' + appId : null;
  const shopify = createAdminOnlineIdentity({ apiKey, apiSecret, hostName: new URL(appOrigin).host });
  const core = createDurableCore(databasePool ?? new Pool({ connectionString: databaseUrl }));
  const grants = new WeakMap<AdminActor, OnlineStaffGrant>();
  const activations = new WeakMap<AdminActor, ReturnType<typeof core.productionActivations.create>>();
  const policy = featurePolicy(env);
  const partner =
    policy && appGid && env.INSIGNIA_PARTNER_ORGANIZATION_ID && env.INSIGNIA_PARTNER_ACCESS_TOKEN
      ? createActiveSubscriptionClient({
          now: entitlementClock,
          transport: createPartnerGraphqlTransport({
            organizationId: env.INSIGNIA_PARTNER_ORGANIZATION_ID,
            accessToken: env.INSIGNIA_PARTNER_ACCESS_TOKEN,
          }),
        })
      : null;
  async function active(actor: AdminActor): Promise<void> {
    const scope = await core.tenants.getActiveAuthorizationScope({
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || 'gid://shopify/Shop/' + scope.shopifyShopId !== actor.shopId)
      throw new Error('Admin installation changed');
  }
  function grant(actor: AdminActor): OnlineStaffGrant {
    const online = grants.get(actor);
    if (!online || online.expiresAtMs <= Date.now() + 30_000 || online.shop !== actor.shop || !actor.canRead)
      throw new Error('Online staff grant unavailable');
    return online;
  }
  const catalog = {
    async list(actor: AdminActor, input: { query: string; cursor: string | null; limit: number }) {
      await active(actor);
      const result = await createCatalogReader(
        createCatalogTransport({
          shop: actor.shop,
          accessToken: grant(actor).accessToken,
        }),
      ).list({
        search: input.query,
        after: input.cursor ?? undefined,
        first: input.limit,
      });
      await active(actor);
      return { products: result.products.map(project), nextCursor: result.nextCursor };
    },
    async get(actor: AdminActor, productId: string) {
      await active(actor);
      const found = await createCatalogReader(
        createCatalogTransport({
          shop: actor.shop,
          accessToken: grant(actor).accessToken,
        }),
      ).get(productId);
      await active(actor);
      return found ? project(found) : null;
    },
    async shopCurrency(actor: AdminActor) {
      await active(actor);
      const currency = await createCatalogReader(
        createCatalogTransport({
          shop: actor.shop,
          accessToken: grant(actor).accessToken,
        }),
      ).shopCurrency();
      await active(actor);
      return currency;
    },
  };
  function activation(actor: AdminActor) {
    const cached = activations.get(actor);
    if (cached) return cached;
    if (!appId || !/^[1-9][0-9]*$/.test(appId) || !actor.canEdit)
      throw new Error('Publication configuration unavailable');
    const credentials = {
      async acquire(input: { shopId: string; installationGeneration: string }) {
        if (input.shopId !== actor.tenantShopId || input.installationGeneration !== actor.installationGeneration)
          return { kind: 'inactive' as const };
        try {
          await active(actor);
        } catch {
          return { kind: 'inactive' as const };
        }
        const online = grant(actor);
        return {
          kind: 'usable' as const,
          shopDomain: actor.shop,
          accessToken: online.accessToken,
          accessExpiresAt: new Date(online.expiresAtMs),
        };
      },
    };
    const remote = createPublicationAdminAdapter({
      transport: createPublicationAdminHttpTransport({ credentials }),
    });
    const coordinator = core.productionActivations.create({
      appId,
      appClientId: apiKey,
      remote,
      availability: createShopifyAvailabilityHoldV3Port({
        credentials,
        isCurrent: async (scope) => {
          if (
            scope.shopId !== actor.tenantShopId ||
            scope.installationGeneration !== actor.installationGeneration ||
            scope.appClientId !== apiKey ||
            scope.shopifyShopId !== actor.shopId
          )
            return false;
          try {
            await active(actor);
            return true;
          } catch {
            return false;
          }
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
      }),
      readiness:
        activationReadiness ??
        createServerActivationReadiness({
          expectedBuild: { read: async () => null },
          observeFunctions: async () => ({ transform: 'unknown', validation: 'unknown', observation: null }),
          currentDay: () => {
            throw new Error('Trusted merchant calendar unavailable');
          },
        }),
      maxObservationAgeMs: 30_000,
    });
    activations.set(actor, coordinator);
    return coordinator;
  }
  const service = createMerchantConfigService({
    core,
    catalog,
    async eligibility(actor, draft: MerchantDraft) {
      if (!partner || !policy || !appGid) return { allowed: false, reason: 'Publication policy is not configured' };
      await active(actor);
      const raw = await partner.read({ appId: appGid, shopId: actor.shopId });
      const bound = await bindProviderSubscription(
        raw,
        {
          appId: appGid,
          shopId: actor.shopId,
          tenantShopId: actor.tenantShopId,
          installationGeneration: actor.installationGeneration,
        },
        core.tenants,
      );
      const entitlement = projectEntitlement(bound, policy.catalog, {
        appId: appGid,
        shopId: actor.shopId,
        tenantShopId: actor.tenantShopId,
        installationGeneration: actor.installationGeneration,
        now: entitlementClock(),
      });
      const needed = [policy.features.base];
      if (draft.mode === 'required') needed.push(policy.features.required);
      if (draft.placements.some((item) => item.logoLaterAllowed)) needed.push(policy.features.logoLater);
      if (draft.productionOptions.length) needed.push(policy.features.options);
      if (draft.pricingRules.length) needed.push(policy.features.pricing);
      const allowed =
        entitlement.freshness === 'fresh' &&
        entitlement.active &&
        entitlement.recognizedPolicyId !== null &&
        needed.every((feature) => entitlement.features.includes(feature));
      return { allowed, reason: allowed ? null : 'Current subscription does not grant every configured feature' };
    },
    publication: (actor) => activation(actor).publications,
    activation,
  });
  return {
    appOrigin,
    async authenticate(request) {
      let online: OnlineStaffGrant | undefined;
      const authenticator = createAdminAuthenticator({
        verifySessionToken: shopify.verify,
        async exchangeOnlineGrant(token, identity) {
          online = await shopify.exchangeOnline(token, identity);
          return online;
        },
        async readInstallation(current): Promise<AdminInstallation> {
          if (!online || online.shop !== current.shop) throw new Error('Online grant missing');
          const provider = await shopify.readInstallation(online);
          const tenant = await core.tenants.getShopByDomain(provider.shop);
          if (!tenant || !tenant.shopifyShopId || 'gid://shopify/Shop/' + tenant.shopifyShopId !== provider.shopId)
            throw new Error('Tenant installation mismatch');
          const installed = await core.tenants.getCurrentAdminInstallation(tenant.shopId);
          return {
            shop: provider.shop,
            shopId: provider.shopId,
            installationId: provider.installationId,
            trustedInstallationId: installed?.externalInstallationId ?? '',
            tenantShopId: tenant.shopId,
            installationGeneration: installed?.generation ?? '',
            active: installed?.active === true,
            grantedScopes: provider.grantedScopes,
          };
        },
      });
      const actor = await authenticator(request);
      if (actor && online) grants.set(actor, online);
      return actor;
    },
    catalog: { list: catalog.list, get: catalog.get },
    configs: service,
  };
}
