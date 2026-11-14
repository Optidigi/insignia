import {
  ABANDON_AFTER_DEFAULT_MS,
  ABANDON_CLAIM_STALE_DEFAULT_MS,
  type AbandonedHold,
  type ActivationStateKind,
  type AnyAvailabilityHold,
  type AvailabilityRecoveryResolution,
  type AvailabilityScope,
  activationDigest,
  availabilitySnapshotIdentityDigest,
  isAvailabilityV3,
  OPERATOR_INSPECT_MAX_AGE_MS,
  type OperatorHoldFacts,
  type OperatorHoldLive,
  type OperatorHoldReason,
  type OperatorLiveField,
  operatorInspectToken,
  operatorLiveFieldDigest,
  operatorProductHeld,
  operatorRestoreReasons,
  type ProductAvailabilityHoldV3Port,
  type ProductAvailabilitySnapshotV3,
  parseOperatorInspectToken,
  RELEASE_WAIT_FLAG_DEFAULT_MS,
  sameAvailabilityV3,
} from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { createAvailabilityRecovery } from './availability-recovery.js';
import {
  createAbandonmentFence,
  type OfflineToken,
  type PublicationAbandonmentEvent,
} from './publication-abandonment.js';

type Usable = OfflineToken & { kind: 'usable' };
type Credentials = { acquire(input: { shopId: string; installationGeneration: string }): Promise<OfflineToken> };
/** The app-owned field reader of the publication Admin adapter (read only). */
export type OperatorFieldTarget = {
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  appId: string;
  field: 'public_config' | 'registration' | 'policy';
  productId?: string;
};
export type PublicationHoldOperatorOptions = {
  /** Numeric Shopify app ID (the `app--<id>` field namespace). */
  appId: string;
  appClientId: string;
  /** B's stale bound for a claim without a settled receipt (default 2 minutes). */
  claimStaleMs?: number;
  /** The shop's offline token, acquired before any lock is taken. */
  acquireToken(input: { shopId: string; installationGeneration: string }): Promise<OfflineToken>;
  /** A fresh availability port bound to one prebound token. */
  availability(input: {
    credentials: Credentials;
    isCurrent(scope: AvailabilityScope): Promise<boolean>;
  }): Pick<ProductAvailabilityHoldV3Port, 'snapshot' | 'observe' | 'restore'>;
  /** A fresh field reader bound to one prebound token. */
  fields(input: { credentials: Credentials }): {
    read(target: OperatorFieldTarget): Promise<{ compareDigest: string } | null>;
  };
  onEvent?(event: PublicationAbandonmentEvent): void;
  /** The provider clock of the availability port, for the resolution's decision times. */
  now?: () => Date;
};

type Row = OperatorHoldFacts & {
  revisionId: string;
  operationGeneration: string;
  currentGeneration: string | null;
  shopifyShopId: string | null;
  installationActive: boolean;
  requestedAt: Date;
  activationUpdatedAt: Date;
  priorPublicConfigDigest: string | null;
  mode: string;
  priorMode: string | null;
  now: Date;
};
export type OperatorHoldInspection = {
  operationId: string;
  revisionId: string;
  activation: { kind: ActivationStateKind; version: string; updatedAt: string };
  hold: {
    version: string;
    heldSince: string | null;
    before: string | null;
    held: string | null;
    acquisitionAcknowledged: boolean;
    abandonmentClaim: { authority: string; commandKey: string | null; claimedAt: string } | null;
    restorationClaim: boolean;
    restorationReceipt: string | null;
  };
  publication: {
    phase: string;
    status: string;
    mode: string;
    priorMode: string | null;
    current: boolean;
    requestedAt: string;
  };
  installation: { operationGeneration: string; currentGeneration: string | null; current: boolean };
  shopify: {
    product: { state: string; equalsHeld: boolean; equalsBefore: boolean } | { unavailable: true } | null;
    registration: FieldFinding;
    policy: FieldFinding;
    /** Shop-wide; for information only (design §2.2). */
    publicConfig: FieldFinding;
  };
  safeToRestore: boolean;
  reasons: OperatorHoldReason[];
  /** Only when safe: pass it to `restore --inspect-digest` within 10 minutes. */
  inspectDigest: string | null;
};
type FieldFinding = { present: boolean; matchesPrior: boolean } | { unavailable: true } | null;
export type OperatorRestoreResult = {
  outcome: 'refused' | 'restored' | 'flagged' | 'not_dispatched' | 'skipped';
  reasons: readonly string[];
  kind: ActivationStateKind | null;
  phase: string | null;
  status: string | null;
};

const finding = (field: OperatorLiveField | null, prior: string | null): FieldFinding =>
  !field
    ? null
    : field.kind === 'unavailable'
      ? { unavailable: true }
      : { present: field.kind === 'present', matchesPrior: operatorLiveFieldDigest(field) === prior };
const commandKeyPattern = /^[A-Za-z0-9_-]{1,128}$/;
export class OperatorCommandError extends Error {
  constructor(readonly reason: string) {
    super(`Publication hold command refused: ${reason}`);
    this.name = 'OperatorCommandError';
  }
}

/**
 * #466 part A (design §9): the owner-run, server-only operator command. One shop and config per
 * call. It adds no state: `restore` claims through `m5_operator_claim_abandoned_hold` (executable
 * only by the operator role) and then runs B's T2 and T3 unchanged; `resolve` is the existing
 * observation-only resolution with an authority backed by the confirmed command.
 */
export function createPublicationHoldOperator(database: Kysely<Database>, options: PublicationHoldOperatorOptions) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.appClientId)) throw new Error('Invalid trusted app client identity');
  if (!/^[1-9][0-9]*$/.test(options.appId)) throw new Error('Invalid Shopify app identity');
  const claimStaleMs = options.claimStaleMs ?? ABANDON_CLAIM_STALE_DEFAULT_MS;
  const now = options.now ?? (() => new Date());

  const bind = (shopId: string, generation: string, token: Usable) => ({
    credentials: {
      acquire: async (input: { shopId: string; installationGeneration: string }): Promise<OfflineToken> =>
        input.shopId === shopId && input.installationGeneration === generation ? token : { kind: 'inactive' },
    },
    isCurrent: async (scope: AvailabilityScope) =>
      scope.shopId === shopId &&
      scope.installationGeneration === generation &&
      scope.appClientId === options.appClientId,
  });
  const token = async (shopId: string, generation: string | null): Promise<Usable | null> => {
    if (!generation) return null;
    try {
      const acquired = await options.acquireToken({ shopId, installationGeneration: generation });
      return acquired.kind === 'usable' && acquired.accessExpiresAt.getTime() > Date.now() + 30_000 ? acquired : null;
    } catch {
      return null;
    }
  };

  async function load(shopId: string, configId: string, operationId?: string): Promise<Row[]> {
    const rows = await sql<{
      operation_id: string;
      kind: ActivationStateKind;
      version: string;
      hold: AnyAvailabilityHold | null;
      evidence_digest: string | null;
      resolution_digest: string | null;
      updated_at: Date;
      phase: string;
      prior_registration_digest: string | null;
      prior_policy_digest: string | null;
      prior_public_config_digest: string | null;
      mode: string;
      prior_mode: string | null;
      status: string;
      revision_id: string;
      operation_sequence: string;
      operation_generation: string;
      requested_at: Date;
      config_sequence: string;
      current_generation: string | null;
      shopify_shop_id: string | null;
      active: boolean | null;
      now: Date;
    }>`SELECT a.operation_id, a.kind, a.version::text, a.hold, a.evidence_digest, a.resolution_digest, a.updated_at,
        p.phase, p.prior_registration_digest, p.prior_policy_digest, p.prior_public_config_digest, p.mode, p.prior_mode,
        o.status, o.revision_id, o.operation_sequence::text, o.installation_generation::text AS operation_generation,
        o.requested_at, c.publication_sequence::text AS config_sequence, s.current_generation::text AS current_generation,
        s.shopify_shop_id, i.deactivated_at IS NULL AS active, clock_timestamp() AS now
      FROM m5_activation_state a
      JOIN publication_operations o USING (shop_id, config_id, operation_id)
      JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
      JOIN product_configs c ON c.shop_id=a.shop_id AND c.config_id=a.config_id
      JOIN shops s ON s.shop_id=a.shop_id
      LEFT JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE a.shop_id=${shopId} AND a.config_id=${configId}
        ${operationId === undefined ? sql`` : sql`AND a.operation_id=${operationId}`}
        AND a.hold IS NOT NULL AND a.kind NOT IN ('RESTORED','RESOLVED')
        AND NOT (a.kind='ABANDON_RESTORED' AND p.phase='abandoned')
      ORDER BY a.updated_at, a.operation_id`.execute(database);
    return rows.rows.map((r) => ({
      shopId,
      configId,
      operationId: r.operation_id,
      kind: r.kind,
      activationVersion: r.version,
      hold: r.hold,
      evidenceDigest: r.evidence_digest,
      resolutionDigest: r.resolution_digest,
      phase: r.phase,
      status: r.status,
      operationSequence: r.operation_sequence,
      configSequence: r.config_sequence,
      installationCurrent: r.operation_generation === r.current_generation && r.active === true,
      priorRegistrationDigest: r.prior_registration_digest,
      priorPolicyDigest: r.prior_policy_digest,
      priorPublicConfigDigest: r.prior_public_config_digest,
      revisionId: r.revision_id,
      operationGeneration: r.operation_generation,
      currentGeneration: r.active === true ? r.current_generation : null,
      shopifyShopId: r.shopify_shop_id,
      installationActive: r.active === true,
      requestedAt: r.requested_at,
      activationUpdatedAt: r.updated_at,
      mode: r.mode,
      priorMode: r.prior_mode,
      now: r.now,
    }));
  }

  /** Live reads with the current installation's offline token, outside every lock. */
  async function readLive(row: Row, bound: Usable | null) {
    const hold = row.hold;
    if (!bound || !row.currentGeneration || !row.shopifyShopId || !hold || !('before' in hold))
      return { live: null, publicConfig: null };
    const scope: AvailabilityScope = {
      shopId: row.shopId,
      installationGeneration: row.currentGeneration,
      shopifyShopId: `gid://shopify/Shop/${row.shopifyShopId}`,
      appClientId: options.appClientId,
    };
    const binding = bind(row.shopId, row.currentGeneration, bound);
    const productId = hold.before.productId;
    let product: NonNullable<OperatorHoldLive>['product'];
    try {
      const anchors =
        hold.version === 'm5-availability-hold-v3' ? hold.before.effectiveAnchors.map((a) => a.publicationId) : [];
      const snapshot = await options.availability(binding).snapshot(scope, productId, 'v3', anchors);
      product = isAvailabilityV3(snapshot) ? { kind: 'read', snapshot } : { kind: 'unavailable' };
    } catch {
      product = { kind: 'unavailable' };
    }
    const tenant = {
      shopId: row.shopId,
      installationGeneration: row.currentGeneration,
      shopifyShopId: scope.shopifyShopId,
      appId: options.appId,
    };
    const field = async (name: OperatorFieldTarget['field']): Promise<OperatorLiveField> => {
      try {
        const observed = await options
          .fields({ credentials: binding.credentials })
          .read(name === 'public_config' ? { ...tenant, field: name } : { ...tenant, field: name, productId });
        return observed ? { kind: 'present', compareDigest: observed.compareDigest } : { kind: 'absent' };
      } catch {
        return { kind: 'unavailable' };
      }
    };
    const registration = await field('registration');
    const policy = await field('policy');
    const publicConfig = await field('public_config');
    return { live: { product, registration, policy } satisfies OperatorHoldLive, publicConfig };
  }

  /** Findings for one row; the digest only when every reason is clear. */
  async function examine(row: Row, bound: Usable | null) {
    // Live reads are informative even when a stored fact already refuses (resolve needs them).
    const { live, publicConfig } = await readLive(row, bound);
    const reasons = operatorRestoreReasons(row, live);
    let digest: { token: string; digest: string } | null = null;
    if (reasons.length === 0 && live?.product.kind === 'read')
      digest = operatorInspectToken({
        facts: row,
        installationGeneration: row.operationGeneration,
        product: live.product.snapshot,
        registrationDigest: operatorLiveFieldDigest(live.registration),
        policyDigest: operatorLiveFieldDigest(live.policy),
        inspectedAt: row.now,
      });
    return { live, publicConfig, reasons, digest };
  }

  function present(row: Row, examined: Awaited<ReturnType<typeof examine>>): OperatorHoldInspection {
    const hold = row.hold;
    const v3 = hold?.version === 'm5-availability-hold-v3' ? (hold as AbandonedHold) : null;
    const product = examined.live?.product;
    const swap = (snapshot: ProductAvailabilitySnapshotV3 | null | undefined, live: ProductAvailabilitySnapshotV3) =>
      Boolean(snapshot && sameAvailabilityV3({ ...snapshot, scope: live.scope }, live));
    return {
      operationId: row.operationId,
      revisionId: row.revisionId,
      activation: { kind: row.kind, version: row.activationVersion, updatedAt: row.activationUpdatedAt.toISOString() },
      hold: {
        version: hold?.version ?? 'none',
        heldSince: v3?.held?.observedAt ?? null,
        before: v3?.before.state ?? null,
        held: v3?.held?.state ?? null,
        acquisitionAcknowledged: Boolean(v3?.acquisitionAcknowledgement),
        abandonmentClaim: v3?.abandonmentClaim
          ? {
              authority: v3.abandonmentClaim.authority,
              commandKey: v3.abandonmentClaim.commandKey ?? null,
              claimedAt: v3.abandonmentClaim.claimedAt,
            }
          : null,
        restorationClaim: Boolean(v3?.restorationClaim),
        restorationReceipt: v3?.restorationReceipt?.kind ?? null,
      },
      publication: {
        phase: row.phase,
        status: row.status,
        mode: row.mode,
        priorMode: row.priorMode,
        current: row.operationSequence === row.configSequence,
        requestedAt: row.requestedAt.toISOString(),
      },
      installation: {
        operationGeneration: row.operationGeneration,
        currentGeneration: row.currentGeneration,
        current: row.installationCurrent,
      },
      shopify: {
        product: !product
          ? null
          : product.kind !== 'read'
            ? { unavailable: true }
            : {
                state: product.snapshot.state,
                equalsHeld: operatorProductHeld(hold, examined.live) || swap(v3?.held, product.snapshot),
                equalsBefore: swap(v3?.before, product.snapshot),
              },
        registration: finding(examined.live?.registration ?? null, row.priorRegistrationDigest),
        policy: finding(examined.live?.policy ?? null, row.priorPolicyDigest),
        publicConfig: finding(examined.publicConfig, row.priorPublicConfigDigest),
      },
      safeToRestore: examined.reasons.length === 0 && examined.digest !== null,
      reasons: examined.reasons,
      inspectDigest: examined.digest?.token ?? null,
    };
  }

  const state = async (row: { shopId: string; configId: string; operationId: string }) =>
    (
      await sql<{ kind: ActivationStateKind; phase: string; status: string }>`SELECT a.kind, p.phase, o.status
        FROM m5_activation_state a JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
        JOIN publication_operations o USING (shop_id, config_id, operation_id)
        WHERE a.shop_id=${row.shopId} AND a.config_id=${row.configId} AND a.operation_id=${row.operationId}`.execute(
        database,
      )
    ).rows[0] ?? null;
  /** A command key is single-use per shop: one operator claim or one resolution. */
  const keyUses = async (shopId: string, commandKey: string) =>
    (
      await sql<{ operation_id: string; use: 'claim' | 'resolution' }>`
        SELECT operation_id, 'claim' AS use FROM m5_activation_state
          WHERE shop_id=${shopId} AND hold#>>'{abandonmentClaim,commandKey}'=${commandKey}
        UNION ALL SELECT operation_id, 'resolution' FROM m5_availability_resolutions
          WHERE shop_id=${shopId} AND command_key=${commandKey}`.execute(database)
    ).rows;
  const abandonment = (events: PublicationAbandonmentEvent[]) =>
    createAbandonmentFence(database, {
      appClientId: options.appClientId,
      mode: 'restore',
      abandonAfterMs: ABANDON_AFTER_DEFAULT_MS,
      releaseWaitFlagMs: RELEASE_WAIT_FLAG_DEFAULT_MS,
      claimStaleMs,
      acquireToken: options.acquireToken,
      availability: options.availability,
      onEvent: (event) => {
        events.push(event);
        options.onEvent?.(event);
      },
    });

  return {
    /** Read only: findings and, when safe, the inspection digest for each unresolved hold. */
    async inspect(input: { shopId: string; configId: string }) {
      const rows = await load(input.shopId, input.configId);
      const holds: OperatorHoldInspection[] = [];
      for (const row of rows)
        holds.push(present(row, await examine(row, await token(row.shopId, row.currentGeneration))));
      return { shopId: input.shopId, configId: input.configId, holds };
    },

    /**
     * Restores an `OPERATOR_HOLD` exactly as B would: fresh live reads must still be safe and give
     * the same digest as a recent inspection, before anything is claimed; then the operator claim and
     * B's T2/T3. Re-running the same command resumes its own claim by B's rules.
     */
    async restore(input: {
      shopId: string;
      configId: string;
      operationId: string;
      inspectDigest: string;
      commandKey: string;
    }): Promise<OperatorRestoreResult> {
      const parsed = parseOperatorInspectToken(input.inspectDigest);
      if (!parsed) throw new OperatorCommandError('invalid_inspect_digest');
      if (!commandKeyPattern.test(input.commandKey)) throw new OperatorCommandError('invalid_command_key');
      const refused = (reasons: readonly string[], row?: Row | null): OperatorRestoreResult => ({
        outcome: 'refused',
        reasons,
        kind: row?.kind ?? null,
        phase: row?.phase ?? null,
        status: row?.status ?? null,
      });
      const row = (await load(input.shopId, input.configId, input.operationId))[0];
      if (!row) return refused(['hold_not_found']);
      const claim = (row.hold as AbandonedHold | null)?.abandonmentClaim;
      const events: PublicationAbandonmentEvent[] = [];
      const finish = async (settled: { outcome: string }) => {
        const after = await state(row);
        const outcome = (
          after?.kind === 'ABANDON_RESTORED'
            ? 'restored'
            : ['restored', 'flagged', 'not_dispatched'].includes(settled.outcome)
              ? settled.outcome
              : 'skipped'
        ) as OperatorRestoreResult['outcome'];
        return {
          outcome,
          reasons: [...new Set(events.flatMap((e) => e.reasons))],
          kind: after?.kind ?? null,
          phase: after?.phase ?? null,
          status: after?.status ?? null,
        };
      };
      if (row.kind === 'ABANDON_CLAIMED' || row.kind === 'ABANDON_RESTORED') {
        // Resume only this command's own operator claim; B's rules decide what happens next.
        if (
          claim?.authority !== 'SETTLED_BY_TRUSTED_OPERATOR' ||
          claim.commandKey !== input.commandKey ||
          claim.inspectDigest !== parsed.digest
        )
          return refused(['claimed_by_another_command'], row);
        const bound = await token(row.shopId, row.operationGeneration);
        return finish(await abandonment(events).settleOperatorClaim(row, false, bound));
      }
      if ((await keyUses(row.shopId, input.commandKey)).length > 0) return refused(['command_key_used'], row);
      const age = row.now.getTime() - parsed.inspectedAt.getTime();
      if (age < 0 || age > OPERATOR_INSPECT_MAX_AGE_MS) return refused(['inspection_stale'], row);
      // Re-read the product and the fields before claiming; refuse without claiming on any change.
      const bound = row.installationCurrent ? await token(row.shopId, row.operationGeneration) : null;
      const examined = await examine(row, bound);
      if (examined.reasons.length > 0) return refused(examined.reasons, row);
      if (!bound || examined.live?.product.kind !== 'read') return refused(['observation_unavailable'], row);
      const recomputed = operatorInspectToken({
        facts: row,
        installationGeneration: row.operationGeneration,
        product: examined.live.product.snapshot,
        registrationDigest: operatorLiveFieldDigest(examined.live.registration),
        policyDigest: operatorLiveFieldDigest(examined.live.policy),
        inspectedAt: parsed.inspectedAt,
      });
      if (recomputed.digest !== parsed.digest) return refused(['inspection_mismatch'], row);
      try {
        await sql`SELECT m5_operator_claim_abandoned_hold(${row.shopId}, ${row.configId}, ${row.operationId},
          ${row.activationVersion}::bigint, ${input.commandKey}, ${parsed.digest})`.execute(database);
      } catch {
        // The activation version moved after the reads, or a trigger refused: nothing was claimed.
        return refused(['claim_refused'], row);
      }
      return finish(await abandonment(events).settleOperatorClaim(row, true, bound));
    },

    /** The existing observation-only resolution (`OPERATOR_HOLD`/`RESTORATION_CLAIMED` → RESOLVED or
     * RESTORED). The confirmed command is its trusted authority; it never writes to Shopify. */
    async resolve(input: {
      shopId: string;
      configId: string;
      operationId: string;
      commandKey: string;
    }): Promise<{ resolution: AvailabilityRecoveryResolution; kind: ActivationStateKind | null }> {
      if (!commandKeyPattern.test(input.commandKey)) throw new OperatorCommandError('invalid_command_key');
      if ((await keyUses(input.shopId, input.commandKey)).some((use) => use.operation_id !== input.operationId))
        throw new OperatorCommandError('command_key_used');
      // The recovery itself requires the hold (or returns this command's earlier resolution).
      const shop = (
        await sql<{ generation: string }>`SELECT s.current_generation::text AS generation FROM shops s
          JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
          WHERE s.shop_id=${input.shopId} AND i.deactivated_at IS NULL`.execute(database)
      ).rows[0];
      const bound = shop ? await token(input.shopId, shop.generation) : null;
      if (!bound || !shop) throw new OperatorCommandError('credential_unavailable');
      const binding = bind(input.shopId, shop.generation, bound);
      const port = options.availability(binding);
      const unsupported = async (): Promise<never> => {
        throw new Error('Observation-only resolution');
      };
      const recover = createAvailabilityRecovery(database, {
        appClientId: options.appClientId,
        availability: { snapshot: port.snapshot, acquire: unsupported, observe: unsupported, restore: unsupported },
        now,
        maxObservationAgeMs: 60_000,
        recoveryAuthority: {
          read: async (context) => {
            const reviewedAt = now();
            return {
              version:
                context.hold.version === 'm5-availability-hold-v3'
                  ? 'm5-availability-recovery-decision-v3'
                  : context.hold.version === 'm5-availability-hold-v2'
                    ? 'm5-availability-recovery-decision-v2'
                    : 'm5-availability-recovery-decision-v1',
              shopId: context.shopId,
              configId: context.configId,
              operationId: context.operationId,
              commandKey: context.commandKey,
              decisionRef: `publication-hold-command:${context.commandKey}`,
              actorRef: 'publication-hold-command',
              currentScopeDigest: activationDigest(context.currentScope),
              holdDigest: activationDigest(context.hold),
              observedSnapshotDigest: availabilitySnapshotIdentityDigest(context.observed),
              outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR',
              reviewedAt: reviewedAt.toISOString(),
              expiresAt: new Date(reviewedAt.getTime() + 60_000).toISOString(),
            };
          },
        },
      });
      const resolution = await recover({
        shopId: input.shopId,
        configId: input.configId,
        operationId: input.operationId,
        commandKey: input.commandKey,
      });
      return { resolution, kind: (await state(input))?.kind ?? null };
    },
  };
}
