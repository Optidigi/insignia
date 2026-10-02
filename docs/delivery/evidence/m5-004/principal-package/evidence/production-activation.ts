import {
  type ActivationReadinessPort,
  activationDigest,
  createPublicationActivation,
  type ProductAvailabilityHoldPort,
  type TrustedAvailabilityRecoveryAuthorityPort,
} from '@insignia/application';
import type { Kysely } from 'kysely';
import type { Database } from '../client/database.js';
import { PgActivationStore } from './activation.js';
import { createAvailabilityRecovery } from './availability-recovery.js';
import {
  exactPublicationField,
  PgProductionPublication,
  type ProductionPublicationRemote,
  publicationProjection,
} from './production-publication.js';

/** Provider callbacks run under shop/install/config locks. Acquire or refresh offline credentials
 * before invoking this facade; callbacks must use bounded, prebound credentials or online grants,
 * not reenter core.credentials.acquire (which needs the same shop lock). */
export type ProductionActivationOptions = {
  appId: string;
  appClientId: string;
  remote: ProductionPublicationRemote;
  availability: ProductAvailabilityHoldPort;
  readiness: Omit<ActivationReadinessPort, 'observeProjection'>;
  now?: () => Date;
  maxObservationAgeMs: number;
  recoveryAuthority?: TrustedAvailabilityRecoveryAuthorityPort;
};
/** Scoped server-only factory. Raw executor, store sessions and commit never escape. */
export function createProductionActivation(database: Kysely<Database>, options: ProductionActivationOptions) {
  if (!/^[1-9][0-9]*$/.test(options.appId)) throw new Error('Invalid trusted app identity');
  const store = new PgActivationStore(database, options.appClientId);
  const now = options.now ?? (() => new Date());
  const coordinator = createPublicationActivation({
    store,
    availability: options.availability,
    now,
    maxObservationAgeMs: options.maxObservationAgeMs,
    readiness: {
      ...options.readiness,
      observeProjection: async (candidate) => {
        const projection = publicationProjection(candidate.desiredProjection);
        const tenant = {
          shopId: candidate.shopId,
          installationGeneration: candidate.scope.installationGeneration,
          shopifyShopId: candidate.availabilityScope.shopifyShopId,
          appId: options.appId,
        };
        const targets = [
          { ...tenant, field: 'public_config' as const },
          { ...tenant, field: 'registration' as const, productId: candidate.productId },
          { ...tenant, field: 'policy' as const, productId: candidate.productId },
        ];
        // Time marks observation start, not completion; slow reads cannot refresh stale evidence.
        const observedAt = now().toISOString();
        const values = await Promise.all(targets.map((target) => options.remote.read(target)));
        const desired = [projection.publicConfig, projection.registrationReady, projection.policy];
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          const value = desired[i];
          if (!target || value === undefined || !exactPublicationField(values[i] ?? null, target, value))
            throw new Error('Remote activation projection drift');
        }
        return { projection, observedAt };
      },
    },
  });
  const publications = new PgProductionPublication(database, options.remote, options.appId, {
    established: async (identity) => {
      const record = await store.read(identity);
      const hold = record?.state.hold;
      if (
        record?.state.kind !== 'HELD' ||
        !hold?.held ||
        hold.operationId !== identity.operationId ||
        hold.before.productId !== identity.productId ||
        hold.before.scope.shopId !== identity.shopId ||
        hold.before.scope.installationGeneration !== identity.installationGeneration ||
        hold.before.scope.appClientId !== options.appClientId
      )
        return null;
      const observed = await options.availability.observe(hold.before.scope, hold);
      const establishedAt = now().getTime();
      const time = Date.parse(observed.current.observedAt);
      if (
        !(
          observed.kind === 'HELD' &&
          observed.hold.held !== null &&
          observed.current.productId === hold.held.productId &&
          observed.current.state === 'unavailable' &&
          activationDigest(observed.current.scope) === activationDigest(hold.held.scope) &&
          observed.current.providerVersion === hold.held.providerVersion &&
          observed.current.visibilityDigest === hold.held.visibilityDigest &&
          Number.isFinite(time) &&
          Number.isFinite(establishedAt) &&
          time <= establishedAt &&
          establishedAt - time <= options.maxObservationAgeMs
        )
      )
        return null;
      let lastCheckedAt = establishedAt;
      return {
        isFresh: () => {
          const at = now().getTime();
          const valid = Number.isFinite(at) && at >= lastCheckedAt && at - time <= options.maxObservationAgeMs;
          lastCheckedAt = at;
          return valid;
        },
      };
    },
  });
  return {
    publications: {
      prepare: publications.prepare.bind(publications),
      advance: publications.advance.bind(publications),
    },
    recover: createAvailabilityRecovery(database, { ...options, now }),
    advance: coordinator.advance,
    read: (identity: Parameters<typeof store.read>[0]) => store.read(identity),
  };
}
