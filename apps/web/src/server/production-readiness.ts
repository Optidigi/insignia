import {
  type AcceptedQuote,
  assertQuoteIssuanceReady,
  type FunctionArtifactReadinessPorts,
  type QuoteReadinessObservation,
  SigningKeyLifecycle,
  type SigningKeyStore,
} from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import { createObservability } from '@insignia/observability';
import {
  createFunctionOwnershipReconciler,
  createPublicationAdminAdapter,
  expectedFunctionOwnership,
  type PublicationAdminTransport,
} from '@insignia/shopify';

/**
 * The release evidence (or Function observation) read before the signing fence lapsed before the
 * signing instant. Nothing was signed or stored; repeating the request reads a newer record (#345).
 */
export class ReleaseEvidenceExpiredError extends Error {
  constructor() {
    super('Release evidence expired before signing');
    this.name = 'ReleaseEvidenceExpiredError';
  }
}
/** When the evidence observed before the fence stops satisfying the signing-time freshness rule. */
function evidenceLapsesAt(attestation: unknown, observation: unknown, maxObservationAgeMs: number): number {
  const instant = (value: unknown, field: string) =>
    value && typeof value === 'object' ? Date.parse(String(Reflect.get(value, field))) : Number.NaN;
  return Math.min(
    ...[
      instant(attestation, 'expiresAt'),
      instant(attestation, 'observedAt') + maxObservationAgeMs,
      instant(attestation, 'targetObservedAt') + maxObservationAgeMs,
      instant(observation, 'observedAt') + maxObservationAgeMs,
    ].filter(Number.isFinite),
  );
}

/**
 * Quote issuance fails closed while the published Function config differs from the expected
 * projection. That failure is otherwise only a generic shopper error, so persistent drift (five
 * minutes or more since first seen) logs `public_config_drift` for the shop, at most every five
 * minutes, until a readiness check passes again.
 */
export function createPublicConfigDriftTracker(
  log: (shopId: string, persistedMs: number) => void,
  thresholdMs = 300_000,
) {
  const state = new Map<string, { since: number; loggedAt?: number }>();
  return {
    observe(shopId: string, at: Date) {
      const t = at.getTime();
      const entry = state.get(shopId) ?? { since: t };
      state.set(shopId, entry);
      if (t - entry.since >= thresholdMs && (entry.loggedAt === undefined || t - entry.loggedAt >= thresholdMs)) {
        entry.loggedAt = t;
        log(shopId, t - entry.since);
      }
    },
    clear(shopId: string) {
      state.delete(shopId);
    },
  };
}
let driftLogger: ReturnType<typeof createObservability>['logger'] | undefined;
const publicConfigDrift = createPublicConfigDriftTracker((shopId, persistedMs) => {
  try {
    driftLogger ??= createObservability().logger;
    driftLogger.error('public_config_drift', {
      shopId,
      errorClass: 'PUBLIC_CONFIG_DRIFT',
      count: Math.floor(persistedMs / 60_000),
    });
  } catch {}
});

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
  selectedKeyId: number;
  appId: string;
  /** Only the app key: expected Function queries come from the trusted release record. */
  expectedFunctions: { appKey: string };
  transport: PublicationAdminTransport;
  maxObservationAgeMs: number;
  clock?: () => Date;
  artifactPorts?: FunctionArtifactReadinessPorts;
  /** Names a provider read in the caller's request timing (buyer `proposalStage`). */
  stage?<T>(name: 'public-config' | 'function-ownership', run: () => Promise<T>): Promise<T>;
}): {
  observe(input: { quote: QuoteReadinessTarget }): Promise<QuoteReadinessObservation>;
  assertReady(input: { quote: QuoteReadinessTarget }): Promise<void>;
} {
  const keys = new SigningKeyLifecycle(input.core.signingKeys);
  const admin = createPublicationAdminAdapter({ transport: input.transport });
  const now = input.clock ?? (() => new Date());
  const functions = createFunctionOwnershipReconciler({ transport: input.transport, clock: now });
  const stage = input.stage ?? ((_name, run) => run());
  /** Provider and release IO before the signing fence. Active artifact ports may refresh expired
   * release evidence synchronously; nothing here is retained beyond the returned single check. */
  async function observe(quote: QuoteReadinessTarget): Promise<QuoteReadinessObservation> {
    if (!input.artifactPorts) throw new Error('Function artifact trusted evidence and expected build ports missing');
    const artifactPorts = input.artifactPorts;
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
    const artifactScope = {
      shopId: quote.shopId,
      installationGeneration: quote.installationGeneration,
      appClientId: input.expectedFunctions.appKey,
    };
    // Drain both release reads before reporting either failure.
    const artifacts = Promise.allSettled([
      Promise.resolve().then(() => artifactPorts.expectedBuild.read(artifactScope)),
      Promise.resolve().then(() => artifactPorts.trustedEvidence.read(artifactScope)),
    ]).then(([build, evidence]) => {
      if (build.status === 'rejected') throw build.reason;
      if (evidence.status === 'rejected') throw evidence.reason;
      return [build.value, evidence.value] as const;
    });
    const functionObservation = artifacts.then(([expectedBuild]) => {
      if (!expectedBuild) throw new Error('Function artifact expected build unavailable');
      return stage('function-ownership', () =>
        functions.read(tenant, expectedFunctionOwnership(input.expectedFunctions.appKey, expectedBuild)),
      );
    });
    const settled = await Promise.allSettled([
      stage('public-config', () => admin.read({ ...tenant, field: 'public_config' })).then((value) => {
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
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
    const [observed, [expectedBuild, attestation], owned, effective] = settled.map(
      (result) => (result as PromiseFulfilledResult<unknown>).value,
    ) as [
      { value: string; observedAt: Date },
      [Awaited<ReturnType<typeof artifactPorts.expectedBuild.read>>, unknown],
      Awaited<ReturnType<typeof functions.read>>,
      Awaited<ReturnType<typeof input.core.acceptedQuotes.getEffective>>[],
    ];
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
    return {
      // Inside the fence: stored signing-key configuration only. Every observation's freshness
      // (public config, Function ownership and the 30-second release record) is applied at this instant.
      async assertCurrent() {
        const desired = await keys.desiredPublicConfig(scope, now());
        const signingAt = now();
        try {
          assertQuoteIssuanceReady({
            scope,
            selectedKeyId: input.selectedKeyId,
            acceptedDay: quote.acceptedDay,
            desired,
            observed,
            now: signingAt,
            maxObservationAgeMs: input.maxObservationAgeMs,
            functions: owned,
            effectiveRevision,
            artifact: { appClientId: artifactScope.appClientId, expectedBuild, attestation },
          });
          publicConfigDrift.clear(scope.shopId);
        } catch (error) {
          if (error instanceof Error && error.name === 'PublicConfigDriftError')
            publicConfigDrift.observe(scope.shopId, now());
          // Same check, finer class: evidence that was fresh when read but lapsed by the signing instant.
          if (
            error instanceof Error &&
            error.message === 'Function artifact evidence invalid or mismatched' &&
            +signingAt >= evidenceLapsesAt(attestation, owned.observation, input.maxObservationAgeMs)
          )
            throw new ReleaseEvidenceExpiredError();
          throw error;
        }
      },
    };
  }
  return {
    observe: ({ quote }) => observe(quote),
    async assertReady({ quote }) {
      await (await observe(quote)).assertCurrent();
    },
  };
}
