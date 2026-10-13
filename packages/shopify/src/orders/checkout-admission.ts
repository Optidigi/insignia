import {
  assertProductionFunctionArtifactReady,
  type ExpectedFunctionBuild,
  type FunctionArtifactScope,
  type ProviderTenantScopePort,
  parseExpectedFunctionBuild,
  type SupportedCheckoutPurchasePort,
} from '@insignia/application';
import type { AdminCredentialSource } from '../contextual-pricing.js';
import { createFunctionOwnershipReconciler } from '../function-ownership.js';
import { createPublicationAdminHttpTransport } from '../publication-admin.js';

/** Trusted native qualification, never derived from a source label or browser input. */
export type QualifiedCheckoutOrigin = Readonly<{
  shopId: string;
  installationGeneration: string;
  creatorAppId: string;
  supportedFrom: string;
}>;
export type CheckoutAdmissionConfig = {
  appId: string;
  appClientId: string;
  origin: QualifiedCheckoutOrigin | null;
  tenants: ProviderTenantScopePort;
  credentials: AdminCredentialSource;
  release: {
    /** Reuse the independently authenticated, SELECT-only trusted release reader. */
    read(input: { scope: FunctionArtifactScope; now: Date }): Promise<{
      expectedBuild: ExpectedFunctionBuild;
      attestation: unknown;
    } | null>;
  };
  fetchImpl?: typeof fetch;
  clock?: () => Date;
};

export function createShopifyCheckoutPurchaseAdmission(config: CheckoutAdmissionConfig): SupportedCheckoutPurchasePort {
  if (!/^[1-9][0-9]{0,19}$/.test(config.appId) || !/^[A-Za-z0-9_-]{1,128}$/.test(config.appClientId))
    throw new TypeError('Checkout admission app identity unavailable');
  const origin = config.origin ? Object.freeze({ ...config.origin }) : null;
  const appId = config.appId,
    appClientId = config.appClientId;
  const clock = config.clock ?? (() => new Date());
  return {
    async admit({ order }) {
      try {
        const observed = Date.parse(order.observedAt),
          created = Date.parse(order.createdAt);
        if (
          !origin ||
          origin.shopId !== order.shopId ||
          origin.installationGeneration !== order.installationGeneration ||
          !/^gid:\/\/shopify\/App\/[1-9][0-9]{0,19}$/.test(origin.creatorAppId) ||
          order.checkoutOrigin?.creatorAppId !== origin.creatorAppId ||
          order.checkoutOrigin.sourceName !== 'web' ||
          !/^[a-f0-9]{64}$/.test(order.checkoutOrigin.checkoutTokenDigest ?? '') ||
          !Number.isFinite(created) ||
          !Number.isFinite(observed) ||
          created > observed ||
          !Number.isFinite(Date.parse(origin.supportedFrom)) ||
          created < Date.parse(origin.supportedFrom)
        )
          return null;
        const started = clock();
        if (!Number.isFinite(+started) || observed > +started || +started - observed > 30_000) return null;
        const target = { shopId: order.shopId, installationGeneration: order.installationGeneration };
        const resolved = await config.tenants.getActiveProviderScope(target);
        const active = resolved ? { ...resolved } : null;
        if (
          !active ||
          active.shopId !== target.shopId ||
          active.installationGeneration !== target.installationGeneration ||
          !/^[1-9][0-9]{0,19}$/.test(active.shopifyShopId)
        )
          return null;
        const scope = { ...target, appClientId };
        const release = await config.release.read({ scope, now: started });
        if (!release) return null;
        const expected = parseExpectedFunctionBuild(release.expectedBuild);
        if (expected.transform.apiVersion !== '2026-07' || expected.validation.apiVersion !== '2026-07') return null;
        const functions = createFunctionOwnershipReconciler({
          transport: createPublicationAdminHttpTransport({
            credentials: {
              acquire: async (requested) => {
                if (
                  requested.shopId !== target.shopId ||
                  requested.installationGeneration !== target.installationGeneration
                )
                  throw new Error('Checkout admission scope unavailable');
                const credential = await config.credentials.acquire(requested);
                if (credential.kind === 'usable' && credential.shopDomain !== active.shopDomain)
                  throw new Error('Checkout admission destination unavailable');
                return credential;
              },
            },
            fetchImpl: config.fetchImpl,
            now: clock,
          }),
          clock,
        });
        const owned = await functions.read(
          {
            ...target,
            appId,
            shopifyShopId: `gid://shopify/Shop/${active.shopifyShopId}`,
          },
          {
            appKey: appClientId,
            transformInputQuerySha256: expected.transform.inputQuerySha256,
            validationInputQuerySha256: expected.validation.inputQuerySha256,
            ...(expected.schemaVersion === 2 ? { observationVersion: 2 as const } : {}),
          },
        );
        if (owned.transform !== 'present' || owned.validation !== 'present') return null;
        const current = await config.tenants.getActiveProviderScope(target);
        if (
          !current ||
          current.shopId !== active.shopId ||
          current.installationGeneration !== active.installationGeneration ||
          current.shopifyShopId !== active.shopifyShopId ||
          current.shopDomain !== active.shopDomain
        )
          return null;
        const finished = clock();
        if (!Number.isFinite(+finished) || +finished < +started || +finished - observed > 30_000) return null;
        assertProductionFunctionArtifactReady({
          scope,
          expectedBuild: expected,
          attestation: release.attestation,
          observation: owned.observation,
          now: finished,
          maxObservationAgeMs: 30_000,
        });
        return { creatorAppId: origin.creatorAppId, enforcementObservedAt: finished.toISOString() };
      } catch {
        // A failed read never authorizes purchase, changes resources or exposes provider/credential details.
        return null;
      }
    },
  };
}
