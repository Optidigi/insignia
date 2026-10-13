import type { SupportedCheckoutPurchasePort } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import {
  type AdminCredentialSource,
  createShopifyCheckoutPurchaseAdmission,
  type QualifiedCheckoutOrigin,
} from '@insignia/shopify';

/** Server composition after representative native qualification; never browser/env JSON. */
export type NativePurchaseQualification = Readonly<{
  origin: QualifiedCheckoutOrigin;
  appId: string;
  appClientId: string;
  activeVersionRef: string;
}>;

/** Native creator/representative-path proof is still missing. */
export const nativePurchaseQualification: NativePurchaseQualification | null = null;

export function createProductionPurchaseAdmission(input: {
  core: Pick<DurableCore, 'tenants' | 'trustedReleaseRecords'>;
  credentials: AdminCredentialSource;
  qualification?: NativePurchaseQualification | null;
  clock?: () => Date;
}): SupportedCheckoutPurchasePort | undefined {
  const qualification = input.qualification === undefined ? nativePurchaseQualification : input.qualification;
  if (!qualification) return undefined;
  const { appId, appClientId, activeVersionRef } = qualification;
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
          expectedActiveAppVersionRef: activeVersionRef,
          now,
        });
        return evidence ? { expectedBuild: evidence.expectedBuild, attestation: evidence.record.attestation } : null;
      },
    },
  });
}
