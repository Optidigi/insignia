import { randomUUID } from 'node:crypto';
import * as signingApplication from '@insignia/application';
import {
  type ActivationReadinessPort,
  bindProviderSubscription,
  bootstrapExpiringOfflineCredentials,
  type EntitlementPolicyConfig,
  localDay,
  projectEntitlement,
  validEntitlementPolicy,
} from '@insignia/application';
import type { MerchantDraft } from '@insignia/contracts';
import { createDurableCore, ManagedInstallationError, type ManagedInstallationIdentity } from '@insignia/database';
import { type AdminAuthenticationStage, createObservability } from '@insignia/observability';
import {
  canonicalAdminAccessScopes,
  createActiveSubscriptionClient,
  createAdminOnlineIdentity,
  createCatalogImageReader,
  createCatalogReader,
  createCatalogTransport,
  createFunctionOwnershipReconciler,
  createPartnerGraphqlTransport,
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldV3Port,
  type OnlineStaffGrant,
  resolveRuntimeReleaseProfile,
  type CatalogProduct as ShopifyCatalogProduct,
} from '@insignia/shopify';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { inspectArtworkPrivately } from '@insignia/worker';
import { Pool } from 'pg';
import { loadCredentialKeys } from '../../../../worker/src/config.ts';
import { createMerchantConfigService } from '../merchant-config.js';
import { type AdminInstallation, AdminInstallationReconciliationError, createAdminAuthenticator } from './auth.js';
import { createMerchantBillingReader } from './billing.js';
import type { AdminActor, AdminServices, CatalogProduct } from './contracts.js';
import { createMerchantPublicationCapture } from './merchant-previews.js';
import {
  createBoundProductionActivationReadiness,
  createDemandDrivenReleaseReader,
  type ReleaseVerificationCollector,
} from './release-evidence.js';
import { createSigningOwnerAction, type SigningOwnerConfiguration } from './signing-owner-action.js';

type DurableCoreReleaseReader = ReturnType<typeof createDemandDrivenReleaseReader>;

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
    !validEntitlementPolicy(catalog) ||
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
  signingOwnerConfiguration?: SigningOwnerConfiguration,
  releaseCollector?: ReleaseVerificationCollector,
): AdminServices {
  const releaseProfile = resolveRuntimeReleaseProfile(env.INSIGNIA_RELEASE_PROFILE);
  const databaseUrl = required(env, 'DATABASE_URL');
  const apiKey = required(env, 'SHOPIFY_CLIENT_ID');
  const apiSecret = required(env, 'SHOPIFY_CLIENT_SECRET');
  const appOrigin = required(env, 'APP_URL');
  const appId = env.INSIGNIA_SHOPIFY_APP_ID;
  const appGid = appId && /^[1-9][0-9]*$/.test(appId) ? 'gid://shopify/App/' + appId : null;
  const shopify = createAdminOnlineIdentity({ apiKey, apiSecret, hostName: new URL(appOrigin).host, fetchImpl: fetch });
  const offlineBootstrap = env.INSIGNIA_M7_BUYER_ENABLED === '1';
  const credentialKeys = offlineBootstrap ? loadCredentialKeys(env) : undefined;
  const core = createDurableCore(databasePool ?? new Pool({ connectionString: databaseUrl }), { credentialKeys });
  const grants = new WeakMap<AdminActor, OnlineStaffGrant>();
  const requestTokens = new WeakMap<AdminActor, string>();
  const merchantTimezones = new WeakMap<AdminActor, string>();
  const authenticationLogger = createObservability().logger;
  const activations = new WeakMap<AdminActor, ReturnType<typeof core.productionActivations.create>>();
  const verifications = new WeakMap<AdminActor, DurableCoreReleaseReader>();
  const verified = new WeakMap<AdminActor, NonNullable<Awaited<ReturnType<DurableCoreReleaseReader['read']>>>>();
  const collecting = new Map<string, Promise<Awaited<ReturnType<ReleaseVerificationCollector['collect']>>>>();
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
  async function verifyPublicationRelease(actor: AdminActor): Promise<boolean> {
    if (!releaseCollector) return true; // Existing passive gates still deny absent authority.
    await active(actor);
    const online = grant(actor);
    let reader = verifications.get(actor);
    if (!reader) {
      const scope = await core.tenants.getActiveAuthorizationScope({
        shopId: actor.tenantShopId,
        installationGeneration: actor.installationGeneration,
      });
      if (!scope) return false;
      const deadlineMs = Math.min(actor.expiresAtMs, online.expiresAtMs - 30_000, Date.now() + 300_000);
      reader = createDemandDrivenReleaseReader({
        releaseProfile: releaseProfile.name,
        records: core.trustedReleaseRecords,
        collector: releaseCollector,
        binding: {
          shopId: actor.tenantShopId,
          installationGeneration: actor.installationGeneration,
          appClientId: apiKey,
          authorizationGeneration: scope.authorizationGeneration,
          authorizationEpoch: scope.authorizationEpoch,
          externalInstallationId: actor.installationId,
        },
        deadline: () => deadlineMs,
        inFlight: collecting,
        async isCurrent() {
          await active(actor);
          grant(actor);
          const managed = await core.tenants.getManagedInstallationState(actor.shop);
          if (
            !managed?.active ||
            managed.shopId !== actor.tenantShopId ||
            managed.currentGeneration !== actor.installationGeneration ||
            managed.externalInstallationId !== actor.installationId
          )
            throw new Error('Publication installation changed');
          const current = await core.tenants.getActiveAuthorizationScope({
            shopId: actor.tenantShopId,
            installationGeneration: actor.installationGeneration,
          });
          if (
            current?.authorizationGeneration !== scope.authorizationGeneration ||
            current.authorizationEpoch !== scope.authorizationEpoch
          )
            throw new Error('Publication authorization changed');
        },
      });
      verifications.set(actor, reader);
    }
    const evidence = await reader.read({
      scope: { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration, appClientId: apiKey },
      expectedActiveAppVersionRef: releaseProfile.activeVersionRef,
      now: new Date(),
    });
    if (evidence) verified.set(actor, evidence);
    else verified.delete(actor);
    return evidence !== null;
  }
  function publicationAuthorityFresh(actor: AdminActor) {
    if (!releaseCollector) return true;
    const evidence = verified.get(actor);
    const at = Date.now();
    const observed = Date.parse(evidence?.record.attestation.observedAt ?? '');
    const expires = Date.parse(evidence?.record.attestation.expiresAt ?? '');
    return (
      actor.expiresAtMs > at && Number.isFinite(observed) && observed <= at && at - observed <= 30_000 && at < expires
    );
  }

  const billing =
    partner && policy && appGid
      ? createMerchantBillingReader({
          appId: appGid,
          policy: policy.catalog,
          now: entitlementClock,
          async current(actor) {
            await active(actor);
            grant(actor);
          },
          async read(actor) {
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
            return { ...raw, tenantShopId: bound.tenantShopId, installationGeneration: bound.installationGeneration };
          },
        })
      : undefined;

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
    const adapter = createPublicationAdminAdapter({ transport });
    const remote = {
      ...adapter,
      set(target: Parameters<typeof adapter.set>[0], beforeSend?: () => boolean) {
        return adapter.set(target, () => publicationAuthorityFresh(actor) && (beforeSend?.() ?? true));
      },
    };
    const functions = createFunctionOwnershipReconciler({ transport });
    const coordinator = core.productionActivations.create({
      appId,
      appClientId: apiKey,
      remote,
      availability: createShopifyAvailabilityHoldV3Port({
        credentials,
        beforeWrite: () => publicationAuthorityFresh(actor),
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
          releaseProfile: releaseProfile.name,
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
                ...(expected.schemaVersion === 2 ? { observationVersion: 2 as const } : {}),
                transformInputQuerySha256: expected.transform.inputQuerySha256,
                validationInputQuerySha256: expected.validation.inputQuerySha256,
              },
            );
            await active(actor);
            return observed;
          },
        }),
      maxObservationAgeMs: 30_000,
      beforeWrite: () => publicationAuthorityFresh(actor),
    });
    async function settled(identity: Parameters<typeof coordinator.advance>[0]) {
      await active(actor);
      if (identity.shopId !== actor.tenantShopId) throw new Error('Publication scope mismatch');
      const candidate = await coordinator.read(identity);
      const publication = await core.configs.getCurrentPublication(identity.shopId, identity.configId);
      const config = await core.configs.getConfig(identity.shopId, identity.configId);
      return (
        candidate?.state.kind === 'RESTORED' &&
        candidate.evidence !== null &&
        publication?.operationId === identity.operationId &&
        publication.status === 'activated' &&
        publication.phase === 'active' &&
        config?.effectiveOperationId === identity.operationId
      );
    }
    const coordinated = {
      ...coordinator,
      publications: {
        ...coordinator.publications,
        async advance(shopId: string, configId: string, operationId: string) {
          if (!(await settled({ shopId, configId, operationId })) && !(await verifyPublicationRelease(actor)))
            throw new Error('Publication verification unavailable');
          return coordinator.publications.advance(shopId, configId, operationId);
        },
      },
      async advance(identity: Parameters<typeof coordinator.advance>[0]) {
        // Independent collection completes before PgActivationStore takes locks.
        // The coordinator still consumes passive evidence and checks each write.
        if (!(await settled(identity)) && !(await verifyPublicationRelease(actor)))
          throw new Error('Publication verification unavailable');
        return coordinator.advance(identity);
      },
    };
    activations.set(actor, coordinated);
    return coordinated;
  }
  const service = createMerchantConfigService({
    core,
    catalog,
    // Enable only after native schema, scoped role, inspector and cleanup composition qualify.
    capturePublicationPreviews:
      env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED === '1'
        ? createMerchantPublicationCapture({
            store: core.merchantPreviews,
            storage: () =>
              loadArtworkStorageProfile(required(env, 'ARTWORK_STORAGE_PROFILE'), {
                endpoint: required(env, 'ARTWORK_R2_ENDPOINT'),
                bucket: required(env, 'ARTWORK_R2_BUCKET'),
                prefix: required(env, 'ARTWORK_R2_PREFIX'),
              }),
            current: async (actor) => {
              await active(actor);
              grant(actor);
            },
            readProduct: async (actor, productId) => {
              await active(actor);
              const result = await createCatalogReader(
                createCatalogTransport({ shop: actor.shop, accessToken: grant(actor).accessToken }),
              ).get(productId);
              await active(actor);
              return result;
            },
            readImage: async (product, imageRevisionId) =>
              (await createCatalogImageReader().read(product, imageRevisionId))?.bytes ?? null,
            inspect: (bytes) => inspectArtworkPrivately(required(env, 'ARTWORK_WORKER_READY_SOCKET'), bytes),
          })
        : undefined,
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
        entitlement.qualifyingUsageDisposition === 'NOT_METERED' &&
        needed.every((feature) => entitlement.features.includes(feature));
      return { allowed, reason: allowed ? null : 'Current subscription does not grant every configured feature' };
    },
    publication: (actor) => activation(actor).publications,
    activation,
    async preparePublication(actor) {
      // Existing ready installations still use the ordinary M4 admission gates.
      // A private startup allocation allows initial setup; no browser plan or
      // status GET can select or dispatch it. Tokens live only with this actor.
      if (!(await verifyPublicationRelease(actor)))
        return { ready: false, reason: 'Publication verification is unavailable. Contact support.' };
      if (!signingOwner) return { ready: true, reason: null };
      await active(actor);
      grant(actor);
      const token = requestTokens.get(actor);
      if (!token) throw new Error('Publication authorization unavailable');
      const result = await signingOwner.prepare(actor, token);
      await active(actor);
      return {
        ready: result.state === 'PROVISIONED',
        reason: result.state === 'PROVISIONED' ? null : 'Publication preparation is unavailable. Contact support.',
      };
    },
  });
  if (signingOwnerConfiguration && !appId) throw new Error('Signing configuration unavailable');
  const signingOwner = signingOwnerConfiguration
    ? createSigningOwnerAction(signingOwnerConfiguration, {
        releaseProfile: releaseProfile.name,
        app: signingApplication,
        core,
        identity: shopify,
        runtimeIdentity: { appClientId: apiKey, appId: appId!, appOrigin },
        now: () => new Date(),
        bindProvider(
          online: OnlineStaffGrant,
          isCurrent: () => Promise<void>,
          tenant: { shopId: string; installationGeneration: string; appId: string; shopifyShopId: string },
        ) {
          const transport = createPublicationAdminHttpTransport({
            credentials: {
              async acquire(input) {
                if (input.shopId !== tenant.shopId || input.installationGeneration !== tenant.installationGeneration)
                  return { kind: 'inactive' as const };
                try {
                  await isCurrent();
                } catch {
                  return { kind: 'inactive' as const };
                }
                return {
                  kind: 'usable' as const,
                  shopDomain: online.shop,
                  accessToken: online.accessToken,
                  accessExpiresAt: new Date(online.expiresAtMs),
                };
              },
            },
          });
          const functions = createFunctionOwnershipReconciler({ transport });
          return {
            admin: createPublicationAdminAdapter({ transport }),
            observeFunctions: (input: typeof tenant, expected: signingApplication.ExpectedFunctionBuild) =>
              functions.read(input, {
                appKey: apiKey,
                ...(expected.schemaVersion === 2 ? { observationVersion: 2 as const } : {}),
                transformInputQuerySha256: expected.transform.inputQuerySha256,
                validationInputQuerySha256: expected.validation.inputQuerySha256,
              }),
          };
        },
      })
    : undefined;
  return {
    billing,
    appOrigin,
    ...(signingOwner
      ? {
          signingOwner: {
            async prepare(actor: AdminActor, token: string) {
              await active(actor);
              grant(actor);
              return signingOwner.prepare(actor, token);
            },
            async start(actor: AdminActor, token: string) {
              await active(actor);
              grant(actor);
              return signingOwner.start(actor, token);
            },
            async status(actor: AdminActor) {
              await active(actor);
              grant(actor);
              return signingOwner.status(actor);
            },
          },
        }
      : {}),
    recordAuthenticationRejection(authStage) {
      authenticationLogger.info('admin_authentication', { authStage, correlationId: randomUUID() });
    },
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
        requestTokens.set(actor, request.headers.get('Authorization')!.slice(7));
        if (merchantTimezone) merchantTimezones.set(actor, merchantTimezone);
        if (offlineBootstrap && actor.canRead && online.accountOwner === true) {
          const scope = await core.tenants.getActiveAuthorizationScope({
            shopId: actor.tenantShopId,
            installationGeneration: actor.installationGeneration,
          });
          if (!scope || scope.shopDomain !== actor.shop) throw new Error('Offline installation changed');
          const sessionToken = requestTokens.get(actor);
          if (!sessionToken) throw new Error('Offline session unavailable');
          const currentGrantScopes = canonicalAdminAccessScopes(online.appScopes);
          const identity = await shopify.verify(sessionToken);
          const result = await bootstrapExpiringOfflineCredentials({
            credentials: core.credentials,
            identity: {
              shopId: actor.tenantShopId,
              installationGeneration: actor.installationGeneration,
              authorizationGeneration: scope.authorizationGeneration,
              authorizationEpoch: scope.authorizationEpoch,
              externalInstallationId: actor.installationId,
            },
            async exchange(shopDomain) {
              if (
                shopDomain !== actor.shop ||
                identity.staffId !== actor.staffId ||
                identity.sessionId !== actor.sessionId
              )
                throw new Error('Offline identity changed');
              const pair = await shopify.exchangeOffline(sessionToken, identity);
              const observed = await shopify.readInstallation({ shop: shopDomain, accessToken: pair.accessToken });
              if (
                observed.shop !== actor.shop ||
                observed.shopId !== actor.shopId ||
                observed.installationId !== actor.installationId ||
                JSON.stringify(canonicalAdminAccessScopes(observed.grantedScopes)) !==
                  JSON.stringify(currentGrantScopes) ||
                JSON.stringify(canonicalAdminAccessScopes((pair.scopes ?? '').split(',').filter(Boolean))) !==
                  JSON.stringify(canonicalAdminAccessScopes(observed.grantedScopes))
              )
                throw new Error('Offline installation grant mismatch');
              return pair;
            },
          });
          diagnostic(
            (
              {
                installed: 'OFFLINE_BOOTSTRAP_INSTALLED_SUCCEEDED',
                existing: 'OFFLINE_BOOTSTRAP_EXISTING_SUCCEEDED',
                busy: 'OFFLINE_BOOTSTRAP_BUSY',
                unresolved: 'OFFLINE_BOOTSTRAP_UNRESOLVED',
                inactive: 'OFFLINE_BOOTSTRAP_INACTIVE',
                rejected: 'OFFLINE_BOOTSTRAP_REJECTED',
              } as const
            )[result],
          );
          if (result === 'unresolved' || result === 'rejected' || result === 'inactive')
            throw new Error('Offline credential bootstrap unavailable');
        }
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
      const evidence = await core.trustedReleaseRecords.read({
        scope,
        expectedActiveAppVersionRef: releaseProfile.activeVersionRef,
        now: new Date(),
      });
      // Reviewed local query fingerprints only guide collection. These are not
      // an Active-version/Wasm attestation or a replacement release authority.
      const functions = await createFunctionOwnershipReconciler({ transport }).read(tenant, {
        appKey: apiKey,
        ...(evidence?.expectedBuild.schemaVersion === 2 ? { observationVersion: 2 as const } : {}),
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
