import { parseAbandonmentConfig } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import type {
  Observability,
  PublicationAbandonmentOutcome,
  PublicationAbandonmentReason,
} from '@insignia/observability';
import { createShopifyAvailabilityHoldV3Port } from '@insignia/shopify';

type OfflineToken = Awaited<ReturnType<Parameters<DurableCore['publicationAbandonment']['create']>[0]['acquireToken']>>;

/**
 * #466 B: automatic release of an abandoned publication hold, a pass of the reconciliation loop.
 * `INSIGNIA_PUBLICATION_ABANDONMENT=off|flag|restore` (default off); bounds outside their range
 * fail at startup. The offline token is used for this one status-only restore and nothing else.
 */
export function createWorkerPublicationAbandonment(input: {
  core: Pick<DurableCore, 'publicationAbandonment'>;
  env: Record<string, string | undefined>;
  appClientId: string;
  /** Shop offline token, acquired outside every database lock. */
  credentials: { acquire(input: { shopId: string; installationGeneration: string }): Promise<OfflineToken> };
  observability: Pick<Observability, 'logger' | 'metrics'>;
  fetchImpl?: typeof fetch;
}) {
  const config = parseAbandonmentConfig(input.env);
  if (config.mode === 'off') return undefined;
  const { logger, metrics } = input.observability;
  const pass = input.core.publicationAbandonment.create({
    appClientId: input.appClientId,
    ...config,
    acquireToken: (scope) => input.credentials.acquire(scope),
    availability: ({ credentials, isCurrent }) =>
      createShopifyAvailabilityHoldV3Port({
        credentials,
        isCurrent,
        fetchImpl: input.fetchImpl ?? globalThis.fetch.bind(globalThis),
      }),
    onEvent: (event) => {
      const outcome = event.outcome as PublicationAbandonmentOutcome;
      const details = {
        shopId: event.shopId,
        configId: event.configId,
        operationId: event.operationId,
        outcome,
        reasons: event.reasons as PublicationAbandonmentReason[],
      };
      if (outcome === 'restored' || outcome === 'finalized') logger.info('publication_abandonment', details);
      else logger.warn('publication_abandonment', details);
      metrics.publicationAbandonment(outcome);
    },
    onRowError: () => logger.error('queue_job_rejected', { errorClass: 'PUBLICATION_ABANDONMENT_UNAVAILABLE' }),
  });
  return {
    mode: config.mode,
    async runOnce() {
      const result = await pass.runPass();
      metrics.publicationHoldsFlagged(result.flaggedHolds);
      return result;
    },
  };
}
