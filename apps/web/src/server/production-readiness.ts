import {
  type AcceptedQuote,
  assertQuoteIssuanceReady,
  type FunctionArtifactReadinessPorts,
  SigningKeyLifecycle,
  type SigningKeyRing,
} from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import {
  createFunctionOwnershipReconciler,
  createPublicationAdminAdapter,
  type ExpectedFunctionOwnership,
  type PublicationAdminTransport,
} from '@insignia/shopify';

/** No default deployment trust: Admin object observations alone cannot attest deployed Wasm identity. */
export function createProductionQuoteReadiness(input: {
  core: DurableCore;
  ring: SigningKeyRing;
  selectedKeyId: number;
  appId: string;
  expectedFunctions: ExpectedFunctionOwnership;
  transport: PublicationAdminTransport;
  maxObservationAgeMs: number;
  clock?: () => Date;
  artifactPorts?: FunctionArtifactReadinessPorts;
}): { assertReady(input: { quote: AcceptedQuote }): Promise<void> } {
  const keys = new SigningKeyLifecycle(input.core.signingKeys, input.ring);
  const admin = createPublicationAdminAdapter({ transport: input.transport });
  const now = input.clock ?? (() => new Date());
  const functions = createFunctionOwnershipReconciler({ transport: input.transport, clock: now });
  return {
    async assertReady({ quote }) {
      if (!input.artifactPorts) throw new Error('Function artifact trusted evidence and expected build ports missing');
      const scope = {
        shopId: quote.shopId,
        installationGeneration: quote.installationGeneration,
        authorizationGeneration: quote.authorizationGeneration,
        authorizationEpoch: quote.authorizationEpoch,
      };
      const active = await input.core.tenants.getActiveAuthorizationScope({
        shopId: quote.shopId,
        installationGeneration: quote.installationGeneration,
      });
      if (
        !active ||
        active.authorizationGeneration !== scope.authorizationGeneration ||
        active.authorizationEpoch !== scope.authorizationEpoch
      )
        throw new Error('Quote installation authorization changed');
      const tenant = {
        shopId: quote.shopId,
        installationGeneration: quote.installationGeneration,
        shopifyShopId: `gid://shopify/Shop/${active.shopifyShopId}`,
        appId: input.appId,
      };
      const desired = await keys.desiredPublicConfig(scope);
      const observed = await admin.read({ ...tenant, field: 'public_config' });
      if (!observed) throw new Error('Public Function config missing');
      const observedAt = now();
      const owned = await functions.read(tenant, input.expectedFunctions);
      const artifactScope = {
        shopId: quote.shopId,
        installationGeneration: quote.installationGeneration,
        appClientId: input.expectedFunctions.appKey,
      };
      const [expectedBuild, attestation] = await Promise.all([
        input.artifactPorts.expectedBuild.read(artifactScope),
        input.artifactPorts.trustedEvidence.read(artifactScope),
      ]);
      const effective = await Promise.all(
        quote.effectiveRevisions.map((revision) =>
          input.core.acceptedQuotes.getEffective(quote.shopId, revision.productId),
        ),
      );
      const effectiveRevision =
        quote.effectiveRevisions.length > 0 &&
        effective.every((row, index) => {
          const revision = quote.effectiveRevisions[index];
          return Boolean(
            row &&
              revision &&
              row.configId === revision.configId &&
              row.operationId === revision.operationId &&
              row.config.revisionId === revision.revisionId &&
              row.config.revisionContentHash === revision.contentHash,
          );
        });
      assertQuoteIssuanceReady({
        scope,
        selectedKeyId: input.selectedKeyId,
        acceptedDay: quote.acceptedDay,
        desired,
        observed: { value: observed.value, observedAt },
        now: now(),
        maxObservationAgeMs: input.maxObservationAgeMs,
        functions: owned,
        effectiveRevision,
        artifact: { appClientId: artifactScope.appClientId, expectedBuild, attestation },
      });
    },
  };
}
