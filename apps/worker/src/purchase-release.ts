import type { DurableCore } from '@insignia/database';
import {
  type AdminCredentialSource,
  createDemandDrivenReleaseReader,
  type ReleaseVerificationCollector,
  type RuntimeReleaseProfileName,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { type NativePurchaseQualification, nativePurchaseQualification } from './purchase-admission.js';

/** Prepare before reading the order. Never spend the order's 30-second
 * observation window on collection, or the entire 60-second inbox lease. */
export function createPurchaseReleasePreparation(input: {
  core: Pick<DurableCore, 'tenants' | 'trustedReleaseRecords'>;
  credentials: AdminCredentialSource;
  collector: ReleaseVerificationCollector;
  qualification?: NativePurchaseQualification | null;
  releaseProfile?: RuntimeReleaseProfileName;
  clock?: () => Date;
}) {
  const qualification = input.qualification === undefined ? nativePurchaseQualification : input.qualification;
  if (!qualification) return undefined;
  const profile = resolveRuntimeReleaseProfile(input.releaseProfile);
  if (qualification.activeVersionRef !== profile.activeVersionRef) return undefined;
  const origin = Object.freeze({ ...qualification.origin });
  const appClientId = qualification.appClientId;
  const now = input.clock ?? (() => new Date());
  const inFlight = new Map<string, Promise<{ requestId: string; recordId: string | null; state: string }>>();
  return async (target: { shopId: string; installationGeneration: string }): Promise<void> => {
    try {
      const started = +now();
      function require(value: unknown): asserts value {
        if (!value) throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
      }
      require(target.shopId === origin.shopId && target.installationGeneration === origin.installationGeneration);
      const auth = await input.core.tenants.getActiveAuthorizationScope(target);
      require(auth && auth.shopId === target.shopId && auth.installationGeneration === target.installationGeneration);
      const managed = await input.core.tenants.getManagedInstallationState(auth.shopDomain);
      require(
        managed?.active &&
          managed.shopId === target.shopId &&
          managed.currentGeneration === target.installationGeneration &&
          managed.shopifyShopId === auth.shopifyShopId &&
          managed.externalInstallationId,
      );
      const credential = await input.credentials.acquire(target);
      require(
        credential.kind === 'usable' &&
          credential.shopDomain === auth.shopDomain &&
          credential.accessExpiresAt instanceof Date &&
          Number.isFinite(+credential.accessExpiresAt),
      );
      const deadline = Math.min(started + 15000, +credential.accessExpiresAt - 30000);
      require(Number.isFinite(deadline) && +now() < deadline);
      const binding = Object.freeze({
        shopId: target.shopId,
        installationGeneration: target.installationGeneration,
        appClientId,
        authorizationGeneration: auth.authorizationGeneration,
        authorizationEpoch: auth.authorizationEpoch,
        externalInstallationId: managed.externalInstallationId,
      });
      const current = async () => {
        require(+now() < deadline);
        const latest = await input.core.tenants.getActiveAuthorizationScope(target);
        const installation = await input.core.tenants.getManagedInstallationState(auth.shopDomain);
        require(
          latest?.authorizationGeneration === binding.authorizationGeneration &&
            latest.authorizationEpoch === binding.authorizationEpoch &&
            latest.shopId === binding.shopId &&
            latest.installationGeneration === binding.installationGeneration &&
            latest.shopDomain === auth.shopDomain &&
            latest.shopifyShopId === auth.shopifyShopId,
        );
        require(
          installation?.active &&
            installation.shopId === binding.shopId &&
            installation.currentGeneration === binding.installationGeneration &&
            installation.externalInstallationId === binding.externalInstallationId &&
            installation.shopifyShopId === auth.shopifyShopId &&
            +now() < deadline,
        );
      };
      const reader = createDemandDrivenReleaseReader({
        records: input.core.trustedReleaseRecords,
        binding,
        collector: input.collector,
        deadline: () => deadline,
        isCurrent: current,
        now,
        releaseProfile: profile.name,
        inFlight,
      });
      const evidence = await reader.read({
        scope: binding,
        expectedActiveAppVersionRef: profile.activeVersionRef,
        now: now(),
      });
      await current();
      require(
        evidence?.expectedBuild.appVersionRef === profile.activeVersionRef &&
          evidence.expectedBuild.sourceCommit === profile.functionsSourceCommit,
      );
    } catch {
      throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
    }
  };
}
