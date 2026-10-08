import { randomUUID } from 'node:crypto';
import {
  type ActivationReadinessPort,
  bindProviderSubscription,
  type EntitlementPolicyConfig,
  localDay,
  projectEntitlement,
} from '@insignia/application';
import type { MerchantDraft } from '@insignia/contracts';
import { createDurableCore, ManagedInstallationError, type ManagedInstallationIdentity } from '@insignia/database';
import { type AdminAuthenticationStage, createObservability } from '@insignia/observability';
import {
  createActiveSubscriptionClient,
  createAdminOnlineIdentity,
  createCatalogReader,
  createCatalogTransport,
  createFunctionOwnershipReconciler,
  createPartnerGraphqlTransport,
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldV3Port,
  type OnlineStaffGrant,
  type CatalogProduct as ShopifyCatalogProduct,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../merchant-config.js';
import { type AdminInstallation, AdminInstallationReconciliationError, createAdminAuthenticator } from './auth.js';
import type { AdminActor, AdminServices, CatalogProduct } from './contracts.js';
import { createBoundProductionActivationReadiness } from './release-evidence.js';

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
  const merchantTimezones = new WeakMap<AdminActor, string>();
  const authenticationLogger = createObservability().logger;
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
    const transport = createPublicationAdminHttpTransport({ credentials });
    const remote = createPublicationAdminAdapter({ transport });
    const functions = createFunctionOwnershipReconciler({ transport });
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
        createBoundProductionActivationReadiness({
          scope: {
            shopId: actor.tenantShopId,
            installationGeneration: actor.installationGeneration,
            appClientId: apiKey,
          },
          ianaTimezone: merchantTimezones.get(actor) ?? null,
          records: core.trustedReleaseRecords,
          observeFunctions: async (scope, expected) => {
            await active(actor);
            const observed = await functions.read(
              { ...scope, appId, shopifyShopId: actor.shopId },
              {
                appKey: apiKey,
                transformInputQuerySha256: expected.transform.inputQuerySha256,
                validationInputQuerySha256: expected.validation.inputQuerySha256,
              },
            );
            await active(actor);
            return observed;
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
      const correlationId = randomUUID();
      const diagnostic = (authStage: AdminAuthenticationStage) =>
        authenticationLogger.info('admin_authentication', { authStage, correlationId });
      let online: OnlineStaffGrant | undefined;
      let merchantTimezone: string | undefined;
      const authenticator = createAdminAuthenticator(
        {
          verifySessionToken: shopify.verify,
          async exchangeOnlineGrant(token, identity) {
            online = await shopify.exchangeOnline(token, identity);
            return online;
          },
          async readInstallation(current): Promise<AdminInstallation> {
            if (!online || online.shop !== current.shop) throw new Error('Online grant missing');
            // Capture durable state before provider IO. A stale observation may
            // not reverse a generation committed while that IO was in flight.
            const expected = await core.tenants.getManagedInstallationState(current.shop).catch(() => {
              throw new AdminInstallationReconciliationError('TENANT_READ_FAILED');
            });
            const observationStartedAt = new Date();
            const provider = await shopify.readInstallation(online);
            diagnostic('INSTALLATION_PROVIDER_READ_SUCCEEDED');
            merchantTimezone = provider.ianaTimezone;
            const identity: ManagedInstallationIdentity = {
              shopDomain: provider.shop,
              shopifyShopId: provider.shopId.slice('gid://shopify/Shop/'.length),
              externalInstallationId: provider.installationId,
            };
            let confirmation: ManagedInstallationIdentity | undefined;
            if (expected && expected.externalInstallationId !== provider.installationId) {
              const confirmed = await shopify.readInstallation(online);
              if (
                confirmed.ianaTimezone !== provider.ianaTimezone ||
                [...confirmed.grantedScopes].sort().join(',') !== [...provider.grantedScopes].sort().join(',')
              )
                throw new AdminInstallationReconciliationError('INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED');
              confirmation = {
                shopDomain: confirmed.shop,
                shopifyShopId: confirmed.shopId.slice('gid://shopify/Shop/'.length),
                externalInstallationId: confirmed.installationId,
              };
            }
            const installed = await core.transactions
              .run((tx) =>
                core.tenants.ensureManagedInstallation(tx, {
                  ...identity,
                  expected,
                  confirmation,
                  observationStartedAt,
                }),
              )
              .catch((error: unknown) => {
                const stages = {
                  identity_mismatch: 'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH',
                  state_changed: 'INSTALLATION_BOOTSTRAP_STALE_STATE',
                  confirmation_required: 'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED',
                } as const;
                throw new AdminInstallationReconciliationError(
                  error instanceof ManagedInstallationError
                    ? stages[error.kind]
                    : 'INSTALLATION_BOOTSTRAP_WRITE_FAILED',
                );
              });
            const outcomes = {
              CREATED: 'INSTALLATION_BOOTSTRAP_CREATED_SUCCEEDED',
              REUSED: 'INSTALLATION_BOOTSTRAP_REUSED_SUCCEEDED',
              REINSTALLED: 'INSTALLATION_BOOTSTRAP_REINSTALLED_SUCCEEDED',
            } as const;
            diagnostic(outcomes[installed.outcome]);
            return {
              shop: provider.shop,
              shopId: provider.shopId,
              installationId: provider.installationId,
              trustedInstallationId: installed.state.externalInstallationId ?? '',
              tenantShopId: installed.state.shopId,
              installationGeneration: installed.state.currentGeneration,
              active: installed.state.active,
              grantedScopes: provider.grantedScopes,
            };
          },
        },
        Date.now,
        diagnostic,
      );
      const actor = await authenticator(request);
      if (actor && online) {
        grants.set(actor, online);
        if (merchantTimezone) merchantTimezones.set(actor, merchantTimezone);
      }
      return actor;
    },
    async inspectReadiness(actor) {
      await active(actor);
      const online = grant(actor);
      if (!appId || !/^[1-9][0-9]*$/.test(appId)) throw new Error('Readiness configuration unavailable');
      const scope = {
        shopId: actor.tenantShopId,
        installationGeneration: actor.installationGeneration,
        appClientId: apiKey,
      };
      const tenant = { ...scope, appId, shopifyShopId: actor.shopId };
      const transport = createPublicationAdminHttpTransport({
        credentials: {
          acquire: async (input) => {
            if (input.shopId !== scope.shopId || input.installationGeneration !== scope.installationGeneration)
              return { kind: 'inactive' as const };
            await active(actor);
            return {
              kind: 'usable' as const,
              shopDomain: actor.shop,
              accessToken: online.accessToken,
              accessExpiresAt: new Date(online.expiresAtMs),
            };
          },
        },
      });
      // Reviewed local query fingerprints only guide collection. These are not
      // an Active-version/Wasm attestation or a replacement release authority.
      const functions = await createFunctionOwnershipReconciler({ transport }).read(tenant, {
        appKey: apiKey,
        transformInputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
        validationInputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
      });
      const publicConfig = await createPublicationAdminAdapter({ transport }).read({
        ...tenant,
        field: 'public_config',
      });
      const keysScope = await core.signingKeys.getActiveScope(scope.shopId, scope.installationGeneration);
      const keys = keysScope ? await core.signingKeys.list(keysScope) : [];
      const ianaTimezone = merchantTimezones.get(actor);
      if (!ianaTimezone) throw new Error('Trusted merchant calendar unavailable');
      const now = new Date();
      const merchantDay = localDay(now, ianaTimezone).ordinal;
      const evidence = await core.trustedReleaseRecords.read({
        scope,
        expectedActiveAppVersionRef: '1158986629121',
        now,
      });
      await active(actor);
      return {
        version: 'm5-admin-technical-readiness-v1',
        observedAt: now.toISOString(),
        shop: actor.shop,
        shopId: actor.shopId,
        tenantShopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        externalInstallationId: actor.installationId,
        canRead: actor.canRead,
        canEdit: actor.canEdit,
        ianaTimezone,
        merchantDay,
        functions,
        trustedRelease: evidence
          ? {
              recordId: evidence.record.recordId,
              activeAppVersionRef: evidence.record.activeAppVersionRef,
              expectedBuild: evidence.expectedBuild,
            }
          : null,
        signingKeyPresent: keys.some(
          (key) =>
            ['pending', 'active'].includes(key.state) &&
            key.privateEnvelope !== null &&
            key.wrappingKeyId !== null &&
            key.firstDay <= merchantDay &&
            key.lastDay >= merchantDay,
        ),
        publicConfigPresent: publicConfig !== null,
        commercialConfigured: partner !== null && policy !== null && appGid !== null,
      };
    },
    catalog: { list: catalog.list, get: catalog.get },
    configs: service,
  };
}
