import type { DurableCore } from '@insignia/database';
import {
  createDemandDrivenReleaseReader,
  type ReleaseVerificationCollector,
  type RuntimeReleaseProfileName,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { type NativePurchaseQualification, nativePurchaseQualification } from './purchase-admission.js';

/** Prepare before reading the order. Never spend the order's 30-second
 * observation window on collection, or the entire 60-second inbox lease. */
export function createPurchaseReleasePreparation(input: {
  core: Pick<DurableCore, 'tenants' | 'trustedReleaseRecords'> & {
    credentials: Pick<DurableCore['credentials'], 'metadata'>;
  };
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
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = +now();
    let deadline = started + 15000;
    let expire!: () => void;
    const timeout = new Promise<never>((_, reject) => {
      expire = () => {
        expired = true;
        reject(new Error('PURCHASE_RELEASE_UNAVAILABLE'));
      };
      timer = setTimeout(expire, 15000);
    });
    // Only SELECTs and the correlated metadata collector cross this boundary.
    // No credential acquisition/refresh mutation may be abandoned here.
    const bounded = <T>(read: () => Promise<T>): Promise<T> => {
      if (expired || +now() >= deadline) return Promise.reject(new Error('PURCHASE_RELEASE_UNAVAILABLE'));
      return Promise.race([read(), timeout]);
    };
    try {
      function require(value: unknown): asserts value {
        if (!value) throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
      }
      require(target.shopId === origin.shopId && target.installationGeneration === origin.installationGeneration);
      const auth = await bounded(() => input.core.tenants.getActiveAuthorizationScope(target));
      require(auth && auth.shopId === target.shopId && auth.installationGeneration === target.installationGeneration);
      const managed = await bounded(() => input.core.tenants.getManagedInstallationState(auth.shopDomain));
      require(
        managed?.active &&
          managed.shopId === target.shopId &&
          managed.currentGeneration === target.installationGeneration &&
          managed.shopifyShopId === auth.shopifyShopId &&
          managed.externalInstallationId,
      );
      const credential = await bounded(() => input.core.credentials.metadata(target));
      require(
        credential?.shop_id === target.shopId &&
          credential.installation_generation === target.installationGeneration &&
          credential.state === 'active' &&
          credential.access_expires_at instanceof Date &&
          Number.isFinite(+credential.access_expires_at),
      );
      deadline = Math.min(deadline, +credential.access_expires_at - 30000);
      require(Number.isFinite(deadline) && !expired && +now() < deadline);
      clearTimeout(timer);
      timer = setTimeout(expire, deadline - +now());
      const binding = Object.freeze({
        shopId: target.shopId,
        installationGeneration: target.installationGeneration,
        appClientId,
        authorizationGeneration: auth.authorizationGeneration,
        authorizationEpoch: auth.authorizationEpoch,
        externalInstallationId: managed.externalInstallationId,
      });
      const current = async () => {
        require(!expired && +now() < deadline);
        const latest = await bounded(() => input.core.tenants.getActiveAuthorizationScope(target));
        const installation = await bounded(() => input.core.tenants.getManagedInstallationState(auth.shopDomain));
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
        records: { read: (request) => bounded(() => input.core.trustedReleaseRecords.read(request)) },
        binding,
        collector: input.collector,
        deadline: () => deadline,
        isCurrent: current,
        now,
        releaseProfile: profile.name,
        inFlight,
      });
      const evidence = await bounded(() =>
        reader.read({
          scope: binding,
          expectedActiveAppVersionRef: profile.activeVersionRef,
          now: now(),
        }),
      );
      await current();
      require(
        evidence?.expectedBuild.appVersionRef === profile.activeVersionRef &&
          evidence.expectedBuild.sourceCommit === profile.functionsSourceCommit,
      );
    } catch {
      throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
    } finally {
      expired = true;
      clearTimeout(timer);
    }
  };
}
