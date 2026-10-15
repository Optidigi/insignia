import { createPrivateKey } from 'node:crypto';
import {
  type ArtworkScope,
  type CustomizationFxProvider,
  createArtworkUsabilityPort,
  type EntitlementPolicyConfig,
  type FunctionArtifactReadinessPorts,
  type KeyScope,
  localDay,
  type QuoteAuthorityPorts,
  SigningKeyLifecycle,
  type SigningKeyRing,
} from '@insignia/application';
import { currencyExponent, InjectedEd25519Signer } from '@insignia/cart-authorization';
import type { DurableCore } from '@insignia/database';
import {
  type ActiveSubscriptionSnapshot,
  type AdminCredentialSource,
  createAppProxyVerifier,
  createCatalogReader,
  createCatalogTransport,
  createPublicationAdminHttpTransport,
  createShopifyAdminGraphqlReadTransport,
  type ExpectedFunctionOwnership,
  readVariantAvailability as readAvailability,
  readShopContext,
} from '@insignia/shopify';
import { loadArtworkStorageProfile } from '@insignia/storage';
import { createArtworkGuestAuthority } from '../artwork/guest.ts';
import { createFrozenPreviewReader } from '../merchant-preview/read.ts';
import { createProductionQuoteReadiness } from '../production-readiness.ts';
import { createQuoteAuthorityPorts } from '../quote-composition.ts';
import { createBuyerServices } from './service.ts';

type Scope = { shopId: string; installationGeneration: string };
export type BuyerVariantAvailability = Scope & {
  productId: string;
  observedAt: string;
  freshUntil: string;
  variants: readonly { id: string; available: boolean }[];
};
export type ProductionBuyerInputs = {
  core: DurableCore;
  env: NodeJS.ProcessEnv;
  ring: SigningKeyRing;
  entitlementPolicy: EntitlementPolicyConfig;
  credentials: AdminCredentialSource;
  /** SELECT-only credentials for final checks; no claim or refresh fallback. */
  passiveCredentials?: AdminCredentialSource;
  readSubscription(target: { appId: string; shopId: string }): Promise<ActiveSubscriptionSnapshot>;
  artifactPorts: FunctionArtifactReadinessPorts;
  /** Independent stored evidence only; never collect while acceptance owns locks. */
  passiveArtifactPorts?: FunctionArtifactReadinessPorts;
  expectedFunctions: ExpectedFunctionOwnership;
  maxObservationAgeMs: number;
  /** Qualified server readiness authority, including current installed projections and release identity. */
  configurationReady?(target: Scope & { productId: string; selectedKeyId: number }): Promise<void>;
  /** Current provider inventory eligibility, not a guessed boolean from product status or variant existence. */
  readVariantAvailability?(
    target: Scope & { productId: string; variantIds: readonly string[] },
  ): Promise<BuyerVariantAvailability>;
  fx?: CustomizationFxProvider;
  clock?: () => Date;
  fetchImpl?: typeof fetch;
};

/** Composition only: actual offline credentials, wrapping keys, commercial policy and trusted evidence
 * must be supplied by the server bootstrap. Missing authority never becomes a diagnostic success. */
export function createProductionBuyerServices(input: ProductionBuyerInputs) {
  const required = (key: string) => {
    const value = input.env?.[key];
    if (!value) throw new Error('Buyer production configuration incomplete');
    return value;
  };
  const apiKey = required('SHOPIFY_CLIENT_ID'),
    secret = required('SHOPIFY_CLIENT_SECRET');
  const appOrigin = new URL(required('APP_URL'));
  const appId = required('INSIGNIA_SHOPIFY_APP_ID');
  if (
    appOrigin.protocol !== 'https:' ||
    appOrigin.username ||
    appOrigin.password ||
    !/^[1-9][0-9]*$/.test(appId) ||
    !input.core ||
    !input.ring?.currentKeyId ||
    input.ring.keys?.[input.ring.currentKeyId]?.byteLength !== 32 ||
    !input.entitlementPolicy?.policyVersion ||
    !Array.isArray(input.entitlementPolicy.plans) ||
    typeof input.credentials?.acquire !== 'function' ||
    typeof input.readSubscription !== 'function' ||
    typeof input.artifactPorts?.expectedBuild?.read !== 'function' ||
    typeof input.artifactPorts?.trustedEvidence?.read !== 'function' ||
    input.expectedFunctions?.appKey !== apiKey ||
    (input.configurationReady !== undefined && typeof input.configurationReady !== 'function') ||
    (input.readVariantAvailability !== undefined && typeof input.readVariantAvailability !== 'function') ||
    !Number.isSafeInteger(input.maxObservationAgeMs) ||
    input.maxObservationAgeMs < 1 ||
    input.maxObservationAgeMs > 300000
  )
    throw new Error('Buyer production configuration incomplete');
  const clock = input.clock ?? (() => new Date());
  const fetchImpl: typeof fetch = (target, options) =>
    (input.fetchImpl ?? fetch)(target, { ...options, redirect: 'error' });
  const keys = new SigningKeyLifecycle(input.core.signingKeys, input.ring);
  const guest = createArtworkGuestAuthority({
    core: input.core,
    secret,
    clock: () => +clock(),
    sessionDurationMs: 7 * 86400000,
    verifyProxy: createAppProxyVerifier({
      apiKey,
      apiSecret: secret,
      hostName: appOrigin.host,
      pathPrefix: required('ARTWORK_PROXY_PATH_PREFIX'),
    }),
  });

  async function active(scope: Scope) {
    const current = await input.core.tenants.getActiveAuthorizationScope({
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
    });
    if (
      !current ||
      current.shopId !== scope.shopId ||
      current.installationGeneration !== scope.installationGeneration ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(current.shopDomain) ||
      !/^[1-9][0-9]*$/.test(current.shopifyShopId)
    )
      throw new Error('Buyer installation authority unavailable');
    return current;
  }
  function credentials(scope: Scope, passive: () => boolean = () => false): AdminCredentialSource {
    return {
      async acquire(target) {
        if (target.shopId !== scope.shopId || target.installationGeneration !== scope.installationGeneration)
          return { kind: 'inactive' };
        const before = await active(scope);
        const source = passive() ? input.passiveCredentials : input.credentials;
        if (!source) return { kind: 'temporarily_unavailable' };
        const credential = await source.acquire({
          shopId: scope.shopId,
          installationGeneration: scope.installationGeneration,
        });
        if (credential.kind !== 'usable') return credential;
        const after = await active(scope);
        if (
          after.authorizationGeneration !== before.authorizationGeneration ||
          after.authorizationEpoch !== before.authorizationEpoch ||
          credential.shopDomain !== after.shopDomain ||
          !credential.accessToken ||
          !(credential.accessExpiresAt instanceof Date) ||
          !Number.isFinite(+credential.accessExpiresAt) ||
          +credential.accessExpiresAt <= +clock() + 30000
        )
          return { kind: 'inactive' };
        return credential;
      },
    };
  }
  async function selection(scope: Scope) {
    const current = await active(scope);
    const keyScope: KeyScope = {
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      authorizationGeneration: current.authorizationGeneration,
      authorizationEpoch: current.authorizationEpoch,
    };
    const candidates = (await input.core.signingKeys.list(keyScope)).filter((key) => key.state === 'active');
    const selected = candidates[0];
    if (!selected || candidates.length !== 1) throw new Error('Buyer active signing key selection unavailable');
    if (
      selected.shopId !== keyScope.shopId ||
      selected.installationGeneration !== keyScope.installationGeneration ||
      selected.authorizationGeneration !== keyScope.authorizationGeneration ||
      selected.keyId !== selected.id ||
      !Number.isInteger(selected.id) ||
      selected.id < 1 ||
      selected.id > 65535
    )
      throw new Error('Buyer signing key identity mismatch');
    return { keyScope, selected };
  }
  function ports(scope: ArtworkScope): QuoteAuthorityPorts {
    if (scope.kind !== 'guest' || !scope.ownerHash || !/^[a-f0-9]{64}$/.test(scope.ownerHash))
      throw new Error('Buyer resource ownership unavailable');
    const artwork = createArtworkUsabilityPort(input.core.artwork, clock, scope);
    let acceptanceFenceHeld = false;
    let composed: QuoteAuthorityPorts | undefined, pending: Promise<QuoteAuthorityPorts> | undefined;
    const compose = () =>
      (pending ??= (async () => {
        const { keyScope, selected } = await selection(scope);
        const credentialSource = credentials(scope, () => acceptanceFenceHeld);
        const signer = new InjectedEd25519Signer({
          async getSigningKey(statement) {
            if (
              statement.keyId !== selected.id ||
              statement.generationHex !== keyScope.authorizationGeneration.replaceAll('-', '') ||
              statement.epoch !== keyScope.authorizationEpoch
            )
              throw new Error('Buyer signing statement identity mismatch');
            const current = await selection(scope);
            if (
              current.selected.id !== selected.id ||
              current.keyScope.authorizationGeneration !== keyScope.authorizationGeneration ||
              current.keyScope.authorizationEpoch !== keyScope.authorizationEpoch
            )
              throw new Error('Buyer signing key changed');
            const seed = await keys.openActiveSeed(keyScope, selected.id);
            const bytes = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
            try {
              return {
                key: createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' }),
                keyId: selected.id,
                publicKeyFingerprint: current.selected.publicKeyFingerprint,
                revoked: false,
                firstValidDay: current.selected.firstDay,
                lastValidDay: current.selected.lastDay,
              };
            } finally {
              seed.fill(0);
              bytes.fill(0);
            }
          },
        });
        const readiness = createProductionQuoteReadiness({
          core: input.core,
          ring: input.ring,
          selectedKeyId: selected.id,
          appId,
          expectedFunctions: input.expectedFunctions,
          transport: createPublicationAdminHttpTransport({ credentials: credentialSource, fetchImpl }),
          maxObservationAgeMs: input.maxObservationAgeMs,
          artifactPorts: {
            expectedBuild: {
              read: async (target) =>
                (acceptanceFenceHeld ? input.passiveArtifactPorts : input.artifactPorts)?.expectedBuild.read(target) ??
                null,
            },
            trustedEvidence: {
              read: async (target) =>
                (acceptanceFenceHeld ? input.passiveArtifactPorts : input.artifactPorts)?.trustedEvidence.read(
                  target,
                ) ?? null,
            },
          },
          clock,
        });
        composed = createQuoteAuthorityPorts({
          core: input.core,
          appId: `gid://shopify/App/${appId}`,
          entitlementPolicy: input.entitlementPolicy,
          readSubscription: input.readSubscription,
          credentials: credentialSource,
          catalogTransport: createShopifyAdminGraphqlReadTransport({
            credentials: credentialSource,
            fetchImpl,
            now: clock,
          }),
          artwork,
          fx: input.fx,
          signing: { keyId: selected.id, signer },
          readiness,
          clock,
          fetchImpl,
        });
        return composed;
      })());
    return {
      clock,
      ids: {
        quoteId: () => {
          if (!composed) throw new Error('Buyer quote preparation incomplete');
          return composed.ids.quoteId();
        },
      },
      tenant: {
        getActive: async (shopId, generation) => {
          if (shopId !== scope.shopId || generation !== scope.installationGeneration) return null;
          return (await compose()).tenant.getActive(shopId, generation);
        },
      },
      shop: { getContext: async (tenant) => (await compose()).shop.getContext(tenant) },
      entitlement: { getFresh: async (tenant) => (await compose()).entitlement.getFresh(tenant) },
      publication: {
        getEffective: async (shopId, productId) => (await compose()).publication.getEffective(shopId, productId),
      },
      artwork,
      catalog: { resolveVariantContext: async (target) => (await compose()).catalog.resolveVariantContext(target) },
      currency: { exponent: (code) => currencyExponent(code) ?? null },
      fx: { resolve: async (target) => (await compose()).fx.resolve(target) },
      readiness: { assertReady: async (target) => (await compose()).readiness.assertReady(target) },
      authorization: {
        admit: (target) => {
          if (!composed) throw new Error('Buyer quote preparation incomplete');
          composed.authorization.admit(target);
        },
        issue: async (target) => (await compose()).authorization.issue(target),
      },
      store: {
        findCompleted: async (target) => (await compose()).store.findCompleted(target),
        async accept(target, commit) {
          const ports = await compose();
          if (!input.passiveCredentials || !input.passiveArtifactPorts)
            throw new Error('Passive buyer acceptance authority unavailable');
          // Prepare writes before serialization; final callbacks still re-read provider
          // facts, stored evidence and economics under the original acceptance fences.
          const credential = await credentials(scope).acquire(scope);
          if (credential.kind !== 'usable') throw new Error('Buyer acceptance credential unavailable');
          const artifactScope = { ...scope, appClientId: apiKey };
          const [build, evidence] = await Promise.all([
            input.artifactPorts.expectedBuild.read(artifactScope),
            input.artifactPorts.trustedEvidence.read(artifactScope),
          ]);
          if (!build || !evidence) throw new Error('Buyer acceptance release unavailable');
          acceptanceFenceHeld = true;
          try {
            return await ports.store.accept(target, commit);
          } finally {
            acceptanceFenceHeld = false;
          }
        },
      },
    };
  }

  return createBuyerServices({
    core: input.core,
    guest,
    ports,
    clock,
    previewImages:
      input.env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED === '1'
        ? createFrozenPreviewReader({
            store: input.core.merchantPreviews,
            clock,
            storage: {
              async presignRead(target) {
                const storage = await loadArtworkStorageProfile(required('ARTWORK_STORAGE_PROFILE'), {
                  endpoint: required('ARTWORK_R2_ENDPOINT'),
                  bucket: required('ARTWORK_R2_BUCKET'),
                  prefix: required('ARTWORK_R2_PREFIX'),
                });
                return storage.presignRead(target);
              },
            },
          })
        : undefined,
    async configurationReady(scope, productId) {
      const selected = await selection(scope);
      if (input.configurationReady) {
        await input.configurationReady({
          shopId: scope.shopId,
          installationGeneration: scope.installationGeneration,
          productId,
          selectedKeyId: selected.selected.id,
        });
      } else {
        const tenant = await active(scope),
          source = credentials(scope);
        const context = await readShopContext(
          {
            shopId: scope.shopId,
            installationGeneration: scope.installationGeneration,
            shopifyShopId: tenant.shopifyShopId,
          },
          { credentials: source, fetchImpl, now: clock },
        );
        const revision = await input.core.acceptedQuotes.getEffective(scope.shopId, productId);
        if (!revision || revision.config.shopId !== scope.shopId || revision.config.productId !== productId)
          throw new Error('Buyer effective publication unavailable');
        const day = localDay(clock(), context.ianaTimezone).ordinal;
        if (+clock() < Date.parse(context.observedAt) || +clock() >= Date.parse(context.freshUntil))
          throw new Error('Buyer shop context unavailable');
        const readiness = createProductionQuoteReadiness({
          core: input.core,
          ring: input.ring,
          selectedKeyId: selected.selected.id,
          appId,
          expectedFunctions: input.expectedFunctions,
          transport: createPublicationAdminHttpTransport({ credentials: source, fetchImpl }),
          maxObservationAgeMs: input.maxObservationAgeMs,
          artifactPorts: input.artifactPorts,
          clock,
        });
        await readiness.assertReady({
          quote: {
            ...selected.keyScope,
            acceptedDay: day,
            effectiveRevisions: [
              {
                configId: revision.configId,
                operationId: revision.operationId,
                productId,
                revisionId: revision.config.revisionId,
                contentHash: revision.config.revisionContentHash,
              },
            ],
          },
        });
      }
      const after = await selection(scope);
      if (
        after.selected.id !== selected.selected.id ||
        after.keyScope.authorizationGeneration !== selected.keyScope.authorizationGeneration ||
        after.keyScope.authorizationEpoch !== selected.keyScope.authorizationEpoch
      )
        throw new Error('Buyer readiness changed');
    },
    async catalog(scope, productId, phase) {
      const source = await credentials(scope, () => phase === 'final').acquire(scope);
      if (source.kind !== 'usable') throw new Error('Buyer catalog credential unavailable');
      const catalog = createCatalogReader(
        createCatalogTransport({ shop: source.shopDomain, accessToken: source.accessToken, fetchImpl }),
      );
      const gid = `gid://shopify/Product/${productId}`;
      const product = await catalog.get(gid);
      if (
        !product ||
        product.id !== gid ||
        product.variantsTruncated ||
        product.variants.length > 250 ||
        product.status !== 'ACTIVE'
      )
        throw new Error('Buyer catalog product unavailable');
      const target = {
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        productId: gid,
        variantIds: product.variants.map((variant) => variant.id),
      };
      const inventory = input.readVariantAvailability
        ? await input.readVariantAvailability(target)
        : await readAvailability(target, {
            credentials: credentials(scope, () => phase === 'final'),
            fetchImpl,
            clock,
          });
      if (!inventory) throw new Error('Buyer inventory authority unavailable');
      const now = +clock(),
        observed = Date.parse(inventory.observedAt),
        until = Date.parse(inventory.freshUntil);
      if (
        inventory.shopId !== scope.shopId ||
        inventory.installationGeneration !== scope.installationGeneration ||
        inventory.productId !== gid ||
        !Number.isFinite(observed) ||
        !Number.isFinite(until) ||
        observed > now ||
        now >= until ||
        until <= observed ||
        until - observed > 300000 ||
        !Array.isArray(inventory.variants) ||
        inventory.variants.length !== product.variants.length ||
        new Set(inventory.variants.map((variant) => variant.id)).size !== inventory.variants.length ||
        inventory.variants.some(
          (variant) =>
            typeof variant.available !== 'boolean' || !product.variants.some((item) => item.id === variant.id),
        )
      )
        throw new Error('Buyer inventory authority unavailable');
      await active(scope);
      const imageUrls: Record<string, string> = {};
      if (product.image) {
        imageUrls[`product_${productId}`] = product.image.url;
        imageUrls[`product_${gid}`] = product.image.url;
      }
      const availability = new Map(inventory.variants.map((variant) => [variant.id, variant.available]));
      return {
        variants: product.variants.map((variant) => {
          const id = variant.id.slice('gid://shopify/ProductVariant/'.length);
          const image = variant.image ?? product.image;
          if (image) imageUrls[`variant_${id}`] = image.url;
          if (variant.image) {
            imageUrls[variant.id] = variant.image.url;
            imageUrls[id] = variant.image.url;
          }
          return { id, label: variant.title, available: availability.get(variant.id) === true };
        }),
        imageUrls,
      };
    },
  });
}
