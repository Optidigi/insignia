import {
  type AvailabilityRecoveryContext,
  type AvailabilityRecoveryRequest,
  type AvailabilityRecoveryResolution,
  type AvailabilityRecoveryResolutionV1,
  type AvailabilityRecoveryResolutionV2,
  activationDigest,
  assertOriginalAvailabilityObserved,
  availabilitySnapshotIdentityDigest,
  isAvailabilityV2,
  type VersionedProductAvailabilityHoldPort as ProductAvailabilityHoldPort,
  sameAvailabilityV2,
  type TrustedAvailabilityRecoveryAuthorityPort,
  validateAvailabilityRecoveryDecision,
} from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { createTenantRepository } from './tenant.js';

/** Internal scoped observation-only operator resolution. No provider mutation,
 * activation, authority bypass, private executor or callback escapes. */
export function createAvailabilityRecovery(
  database: Kysely<Database>,
  options: {
    appClientId: string;
    availability: ProductAvailabilityHoldPort;
    recoveryAuthority?: TrustedAvailabilityRecoveryAuthorityPort;
    now: () => Date;
    maxObservationAgeMs: number;
  },
) {
  return async (request: AvailabilityRecoveryRequest): Promise<AvailabilityRecoveryResolution> => {
    const recoveryAuthority = options.recoveryAuthority;
    if (!recoveryAuthority || !/^[A-Za-z0-9_-]{1,128}$/.test(request.commandKey))
      throw new Error('Trusted availability recovery unavailable');
    return database.transaction().execute(async (tx) => {
      const shop = await tx
        .selectFrom('shops')
        .selectAll()
        .where('shop_id', '=', request.shopId)
        .forUpdate()
        .executeTakeFirst();
      if (!shop?.shopify_shop_id) throw new Error('Recovery shop unavailable');
      const active = await createTenantRepository(tx).lockActiveAuthorizationScope({
        shopId: request.shopId,
        installationGeneration: shop.current_generation,
      });
      if (!active) throw new Error('Recovery installation inactive');
      const config = await tx
        .selectFrom('product_configs')
        .selectAll()
        .where('shop_id', '=', request.shopId)
        .where('config_id', '=', request.configId)
        .forUpdate()
        .executeTakeFirst();
      const operation = await tx
        .selectFrom('publication_operations')
        .selectAll()
        .where('shop_id', '=', request.shopId)
        .where('config_id', '=', request.configId)
        .where('operation_id', '=', request.operationId)
        .forUpdate()
        .executeTakeFirst();
      if (!config || !operation) throw new Error('Recovery publication unavailable');
      const state = (
        await sql<{
          kind: string;
          hold: AvailabilityRecoveryContext['hold'] | null;
          evidence_digest: string | null;
          resolution_digest: string | null;
        }>`
        SELECT kind,hold,evidence_digest,resolution_digest FROM m5_activation_state
        WHERE shop_id=${request.shopId} AND config_id=${request.configId} AND operation_id=${request.operationId} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      const prior = (
        await sql<{ resolution: AvailabilityRecoveryResolution; resolution_digest: string }>`
        SELECT resolution,resolution_digest FROM m5_availability_resolutions WHERE shop_id=${request.shopId}
        AND config_id=${request.configId} AND operation_id=${request.operationId}`.execute(tx)
      ).rows[0];
      if (prior) {
        if (
          prior.resolution.commandKey !== request.commandKey ||
          activationDigest(prior.resolution) !== prior.resolution_digest ||
          state?.resolution_digest !== prior.resolution_digest
        )
          throw new Error('Recovery idempotency conflict');
        return prior.resolution;
      }
      if (
        !state ||
        !['OPERATOR_HOLD', 'RESTORATION_CLAIMED'].includes(state.kind) ||
        !state.hold ||
        state.hold.before.productId !== `gid://shopify/Product/${config.external_product_id}`
      )
        throw new Error('Publication does not have an operator availability hold');
      const currentScope = {
        shopId: request.shopId,
        installationGeneration: active.installationGeneration,
        shopifyShopId: `gid://shopify/Shop/${active.shopifyShopId}`,
        appClientId: options.appClientId,
      };
      const version = state.hold.version === 'm5-availability-hold-v1' ? 'v1' : 'v2';
      const observed = await options.availability.snapshot(currentScope, state.hold.before.productId, version);
      const context: AvailabilityRecoveryContext = { ...request, currentScope, hold: state.hold, observed };
      assertOriginalAvailabilityObserved(context);
      // A separately reviewed settled-write decision is indispensable. Status alone
      // cannot clear an ambiguous write which may still be in flight.
      const authority = await recoveryAuthority.read(context);
      const readback = await options.availability.snapshot(currentScope, state.hold.before.productId, version);
      if (
        version === 'v1'
          ? availabilitySnapshotIdentityDigest(readback) !== availabilitySnapshotIdentityDigest(observed)
          : !isAvailabilityV2(observed) || !isAvailabilityV2(readback) || !sameAvailabilityV2(observed, readback)
      )
        throw new Error('Recovery observation drift');
      const finalContext = { ...context, observed: readback };
      assertOriginalAvailabilityObserved(finalContext);
      const at = options.now();
      const decision = validateAvailabilityRecoveryDecision(
        authority,
        version === 'v1' ? finalContext : context,
        at,
        options.maxObservationAgeMs,
      );
      const commonResolution = {
        ...request,
        outcome: 'ORIGINAL_STATE_OBSERVED' as const,
        currentScope,
        originalHold: state.hold,
        observed: readback,
        decision,
        activationEvidenceDigest: state.evidence_digest,
        createdAt: at.toISOString(),
      };
      let resolution: AvailabilityRecoveryResolution;
      if (state.hold.version === 'm5-availability-hold-v2') {
        if (
          !isAvailabilityV2(observed) ||
          !isAvailabilityV2(readback) ||
          decision.version !== 'm5-availability-recovery-decision-v2'
        )
          throw new Error('V2 recovery evidence mismatch');
        resolution = {
          ...commonResolution,
          version: 'm5-availability-resolution-v2',
          originalHold: state.hold,
          reviewedObservation: observed,
          observed: readback,
          decision,
        } satisfies AvailabilityRecoveryResolutionV2;
      } else {
        if (
          isAvailabilityV2(observed) ||
          isAvailabilityV2(readback) ||
          decision.version !== 'm5-availability-recovery-decision-v1'
        )
          throw new Error('Historical recovery evidence mismatch');
        resolution = {
          ...commonResolution,
          version: 'm5-availability-resolution-v1',
          originalHold: state.hold,
          observed: readback,
          decision,
        } satisfies AvailabilityRecoveryResolutionV1;
      }
      const digest = activationDigest(resolution);
      await sql`INSERT INTO m5_availability_resolutions (shop_id,config_id,operation_id,command_key,resolution_digest,resolution)
        VALUES (${request.shopId},${request.configId},${request.operationId},${request.commandKey},${digest},${JSON.stringify(resolution)}::jsonb)`.execute(
        tx,
      );
      const effective =
        operation.status === 'activated' &&
        operation.installation_generation === active.installationGeneration &&
        config.effective_operation_id === operation.operation_id &&
        config.effective_revision_id === operation.revision_id;
      await sql`UPDATE m5_activation_state SET kind=${effective ? 'RESTORED' : 'RESOLVED'},resolution_digest=${digest},version=version+1
        WHERE shop_id=${request.shopId} AND config_id=${request.configId} AND operation_id=${request.operationId}`.execute(
        tx,
      );
      if (!effective) {
        await sql`UPDATE publication_operations SET availability_resolved_at=${resolution.createdAt}::timestamptz
          WHERE shop_id=${request.shopId} AND config_id=${request.configId} AND operation_id=${request.operationId}`.execute(
          tx,
        );

        // Abandon only this resolved request. Preserve newer work, generation,
        // effective pointers, original projections and historical activation.
        await sql`UPDATE publication_operations SET status='failed',failed_at=clock_timestamp(),failure_class='availability-resolved'
          WHERE shop_id=${request.shopId} AND config_id=${request.configId} AND operation_id=${request.operationId}
          AND status IN ('requested','acknowledged','observed')`.execute(tx);
        await sql`UPDATE m4_publication_progress SET phase='operator-hold',version=version+1 WHERE shop_id=${request.shopId}
          AND config_id=${request.configId} AND operation_id=${request.operationId} AND phase <> 'active'`.execute(tx);
        await sql`DELETE FROM m5_current_publication_pointer WHERE shop_id=${request.shopId} AND config_id=${request.configId}
          AND revision_id=${operation.revision_id} AND ${operation.operation_id}=${operation.revision_id} AND installation_generation=${operation.installation_generation}::bigint`.execute(
          tx,
        );
      }
      return resolution;
    });
  };
}
