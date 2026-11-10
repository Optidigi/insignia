import {
  type AcceptedQuote,
  assertQuoteIssuanceReady,
  type FunctionArtifactReadinessPorts,
  requireIssuanceReady,
  SigningKeyLifecycle,
  type SigningKeyRing,
  type SigningKeyStore,
} from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import {
  createFunctionOwnershipReconciler,
  createPublicationAdminAdapter,
  expectedFunctionOwnership,
  type PublicationAdminTransport,
} from '@insignia/shopify';

/** Configuration readiness uses actual scope/day/publication facts without manufacturing a quote. */
export type QuoteReadinessTarget = Pick<
  AcceptedQuote,
  | 'shopId'
  | 'installationGeneration'
  | 'authorizationGeneration'
  | 'authorizationEpoch'
  | 'acceptedDay'
  | 'effectiveRevisions'
>;

/** No default deployment trust: Admin object observations alone cannot attest deployed Wasm identity. */
export function createProductionQuoteReadiness(input: {
  core: {
    tenants: Pick<DurableCore['tenants'], 'getActiveAuthorizationScope'>;
    signingKeys: SigningKeyStore;
    acceptedQuotes: {
      getEffective(
        shopId: string,
        productId: string,
      ): Promise<{
        configId: string;
        operationId: string;
        config: { revisionId: string; revisionContentHash: string };
      } | null>;
    };
  };
  ring: SigningKeyRing;
  selectedKeyId: number;
  appId: string;
  /** Only the app key: expected Function queries come from the trusted release record. */
  expectedFunctions: { appKey: string };
  transport: PublicationAdminTransport;
  maxObservationAgeMs: number;
  clock?: () => Date;
  artifactPorts?: FunctionArtifactReadinessPorts;
}): {
  prepare(input: { quote: QuoteReadinessTarget }): Promise<void>;
  assertReady(input: { quote: QuoteReadinessTarget }): Promise<void>;
} {
  const keys = new SigningKeyLifecycle(input.core.signingKeys, input.ring);
  const admin = createPublicationAdminAdapter({ transport: input.transport });
  const now = input.clock ?? (() => new Date());
  const functions = createFunctionOwnershipReconciler({ transport: input.transport, clock: now });
  async function currentContext(quote: QuoteReadinessTarget) {
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
    requireIssuanceReady({ config: desired, keyId: input.selectedKeyId, acceptedDay: quote.acceptedDay });
    const artifactScope = {
      shopId: quote.shopId,
      installationGeneration: quote.installationGeneration,
      appClientId: input.expectedFunctions.appKey,
    };
    return { scope, tenant, desired, artifactScope, artifacts: input.artifactPorts };
  }
  return {
    async prepare({ quote }) {
      const { artifactScope, artifacts } = await currentContext(quote);
      const [build, evidence] = await Promise.allSettled([
        Promise.resolve().then(() => artifacts.expectedBuild.read(artifactScope)),
        Promise.resolve().then(() => artifacts.trustedEvidence.read(artifactScope)),
      ]);
      if (build.status === 'rejected') throw build.reason;
      if (evidence.status === 'rejected') throw evidence.reason;
      if (!build.value || !evidence.value) throw new Error('Function artifact preparation unavailable');
      // No result is retained or approved; assertReady independently observes current evidence.
    },
    async assertReady({ quote }) {
      const { scope, tenant, desired, artifactScope, artifacts: artifactPorts } = await currentContext(quote);
      const artifacts = Promise.all([
        artifactPorts.expectedBuild.read(artifactScope),
        artifactPorts.trustedEvidence.read(artifactScope),
      ]);
      const functionObservation = artifacts.then(([expectedBuild]) => {
        if (!expectedBuild) throw new Error('Function artifact expected build unavailable');
        return functions.read(tenant, expectedFunctionOwnership(input.expectedFunctions.appKey, expectedBuild));
      });
      const [observed, [expectedBuild, attestation], owned, effective] = await Promise.all([
        admin.read({ ...tenant, field: 'public_config' }).then((value) => {
          if (!value) throw new Error('Public Function config missing');
          // Timestamp the completed observation, not the later end of unrelated IO.
          return { value: value.value, observedAt: now() };
        }),
        artifacts,
        functionObservation,
        Promise.all(
          quote.effectiveRevisions.map((revision) =>
            input.core.acceptedQuotes.getEffective(quote.shopId, revision.productId),
          ),
        ),
      ]);
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
        observed,
        now: now(),
        maxObservationAgeMs: input.maxObservationAgeMs,
        functions: owned,
        effectiveRevision,
        artifact: { appClientId: artifactScope.appClientId, expectedBuild, attestation },
      });
    },
  };
}
