import type { SupportedCheckoutPurchasePort } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import {
  type AdminCredentialSource,
  createShopifyCheckoutPurchaseAdmission,
  type QualifiedCheckoutOrigin,
  type RuntimeReleaseProfileName,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';

/** Server composition after representative native qualification; never browser/env JSON. */
export type NativePurchaseQualification = Readonly<{
  origin: QualifiedCheckoutOrigin;
  appId: string;
  appClientId: string;
  activeVersionRef: string;
}>;

/** No unscoped default; the production entrypoint supplies the observed origin explicitly. */
export const nativePurchaseQualification: NativePurchaseQualification | null = null;

/** Bounded rewrite-dev qualification from the independently read native test order
 * and altered-member checkout rejection. This asserts no historical localization
 * or Function execution. Server app identity still needs independent release and
 * current Function ownership checks on every admission. */
export function resolveNativePurchaseQualification(input: {
  appId: string;
  appClientId: string;
  releaseProfile?: RuntimeReleaseProfileName;
}): NativePurchaseQualification | null {
  const profile = resolveRuntimeReleaseProfile(input.releaseProfile);
  if (
    !['m8-cookie-91b35ab', 'm8-preview-28443bd', 'lean-markets-7b17cd9', 'lean-privacy-theme-23fd116'].includes(
      profile.name,
    ) ||
    !/^[1-9][0-9]{0,19}$/.test(input.appId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.appClientId)
  )
    return null;
  return Object.freeze({
    origin: Object.freeze({
      shopId: 'db771bea-c585-4954-9f88-70771c9a0c89',
      installationGeneration: '1',
      creatorAppId: 'gid://shopify/App/580111',
      supportedFrom: '2026-10-14T20:03:04Z',
    }),
    appId: input.appId,
    appClientId: input.appClientId,
    activeVersionRef: profile.activeVersionRef,
  });
}

export function createProductionPurchaseAdmission(input: {
  core: Pick<DurableCore, 'tenants' | 'trustedReleaseRecords'>;
  credentials: AdminCredentialSource;
  qualification?: NativePurchaseQualification | null;
  clock?: () => Date;
  releaseProfile?: RuntimeReleaseProfileName;
}): SupportedCheckoutPurchasePort | undefined {
  const releaseProfile = resolveRuntimeReleaseProfile(input.releaseProfile);
  const qualification = input.qualification === undefined ? nativePurchaseQualification : input.qualification;
  if (!qualification) return undefined;
  if (qualification.activeVersionRef !== releaseProfile.activeVersionRef) return undefined;
  const { appId, appClientId } = qualification;
  return createShopifyCheckoutPurchaseAdmission({
    appId,
    appClientId,
    origin: qualification.origin,
    tenants: input.core.tenants,
    credentials: input.credentials,
    clock: input.clock,
    release: {
      async read({ scope, now }) {
        const evidence = await input.core.trustedReleaseRecords.read({
          scope,
          expectedActiveAppVersionRef: releaseProfile.activeVersionRef,
          now,
        });
        return evidence ? { expectedBuild: evidence.expectedBuild, attestation: evidence.record.attestation } : null;
      },
    },
  });
}
