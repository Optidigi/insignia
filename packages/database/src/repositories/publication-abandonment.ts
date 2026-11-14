import {
  type AbandonedHold,
  type AbandonmentDecision,
  type AbandonmentFlagReason,
  type AbandonmentObservation,
  type ActivationStateKind,
  type AnyAvailabilityHold,
  AvailabilityProviderUnavailableError,
  type AvailabilityRestorationReceiptV3,
  type AvailabilityScope,
  abandonmentRearmable,
  abandonmentReceiptReason,
  activationDigest,
  decideAbandonment,
  isAvailabilityV3,
  type ProductAvailabilityHoldV3Port,
  type ProductAvailabilitySnapshotV3,
  restorationClaimStale,
  settleAbandonmentReceipt,
} from '@insignia/application';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';

/** #466 B: one row's outcome, for the worker's log line and counter. */
export type PublicationAbandonmentEvent = Readonly<{
  shopId: string;
  configId: string;
  operationId: string;
  outcome: 'restored' | 'flagged' | 'not_dispatched' | 'ambiguous' | 'conflict' | 'skipped' | 'finalized';
  reasons: readonly string[];
}>;
export type OfflineToken =
  | { kind: 'usable'; shopDomain: string; accessToken: string; accessExpiresAt: Date }
  | { kind: 'inactive' | 'missing' | 'reauth_required' | 'temporarily_unavailable' };
export type PublicationAbandonmentOptions = {
  appClientId: string;
  mode: 'off' | 'flag' | 'restore';
  abandonAfterMs: number;
  releaseWaitFlagMs: number;
  claimStaleMs: number;
  /** Acquires the shop's offline token. Called only outside every lock (the facade forbids
   * re-entering credential acquisition under the shop lock). */
  acquireToken(input: { shopId: string; installationGeneration: string }): Promise<OfflineToken>;
  /** A fresh availability port for one row only, bound to that row's prebound token. Only
   * observe and restore are used. */
  availability(input: {
    credentials: { acquire(input: { shopId: string; installationGeneration: string }): Promise<OfflineToken> };
    isCurrent(scope: AvailabilityScope): Promise<boolean>;
  }): Pick<ProductAvailabilityHoldV3Port, 'observe' | 'restore'>;
  onEvent?(event: PublicationAbandonmentEvent): void;
  now?: () => number;
};
export const ABANDONMENT_PASS_LIMITS = { claims: 2, finalizes: 10, flags: 10, budgetMs: 20_000, scan: 50 } as const;

type Identity = { shopId: string; configId: string; operationId: string };
type Locked = Identity & {
  kind: ActivationStateKind;
  hold: AnyAvailabilityHold | null;
  evidenceDigest: string | null;
  resolutionDigest: string | null;
  activationUpdatedAt: Date;
  phase: string;
  status: string;
  revisionId: string;
  operationGeneration: string;
  operationSequence: string;
  configSequence: string;
  installationCurrent: boolean;
  quietSince: Date;
  now: Date;
};
const ABANDON_KINDS = ['ABANDON_CLAIMED', 'ABANDON_RESTORED'];

/**
 * Locks shops, the current installation, the config, the operation, its progress and its
 * activation row FOR UPDATE, in that canonical order (design §3.4), then reads every fact the
 * decisions need. The database clock supplies `now`.
 */
async function lockSix(tx: Transaction<Database>, id: Identity): Promise<Locked | null> {
  const shop = await sql<{ generation: string }>`SELECT current_generation::text AS generation FROM shops
    WHERE shop_id=${id.shopId} FOR UPDATE`.execute(tx);
  const generation = shop.rows[0]?.generation;
  if (!generation) return null;
  const installation = await sql<{
    active: boolean;
  }>`SELECT deactivated_at IS NULL AS active FROM installation_generations
    WHERE shop_id=${id.shopId} AND generation=${generation}::bigint FOR UPDATE`.execute(tx);
  const config = await sql<{ sequence: string }>`SELECT publication_sequence::text AS sequence FROM product_configs
    WHERE shop_id=${id.shopId} AND config_id=${id.configId} FOR UPDATE`.execute(tx);
  const operation = await sql<{
    status: string;
    revision_id: string;
    generation: string;
    sequence: string;
    requested_at: Date;
  }>`SELECT status, revision_id, installation_generation::text AS generation, operation_sequence::text AS sequence,
      requested_at FROM publication_operations
    WHERE shop_id=${id.shopId} AND config_id=${id.configId} AND operation_id=${id.operationId} FOR UPDATE`.execute(tx);
  const progress = await sql<{ phase: string }>`SELECT phase FROM m4_publication_progress
    WHERE shop_id=${id.shopId} AND config_id=${id.configId} AND operation_id=${id.operationId} FOR UPDATE`.execute(tx);
  const activation = await sql<{
    kind: ActivationStateKind;
    hold: AnyAvailabilityHold | null;
    evidence_digest: string | null;
    resolution_digest: string | null;
    updated_at: Date;
    quiet_since: Date;
    now: Date;
  }>`SELECT a.kind, a.hold, a.evidence_digest, a.resolution_digest, a.updated_at,
      greatest(o.requested_at, p.updated_at, a.updated_at) AS quiet_since, clock_timestamp() AS now
    FROM m5_activation_state a JOIN publication_operations o USING (shop_id, config_id, operation_id)
    JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
    WHERE a.shop_id=${id.shopId} AND a.config_id=${id.configId} AND a.operation_id=${id.operationId}
    FOR UPDATE OF a`.execute(tx);
  const o = operation.rows[0],
    p = progress.rows[0],
    a = activation.rows[0],
    c = config.rows[0];
  if (!o || !p || !a || !c) return null;
  return {
    ...id,
    kind: a.kind,
    hold: a.hold,
    evidenceDigest: a.evidence_digest,
    resolutionDigest: a.resolution_digest,
    activationUpdatedAt: a.updated_at,
    phase: p.phase,
    status: o.status,
    revisionId: o.revision_id,
    operationGeneration: o.generation,
    operationSequence: o.sequence,
    configSequence: c.sequence,
    installationCurrent: o.generation === generation && installation.rows[0]?.active === true,
    quietSince: a.quiet_since,
    now: a.now,
  };
}

async function setKind(
  tx: Transaction<Database>,
  id: Identity,
  kind: ActivationStateKind,
  hold?: AnyAvailabilityHold,
  reasons?: readonly AbandonmentFlagReason[],
) {
  // Diagnostic reason codes for the audit trigger; transaction-local, never authority.
  if (reasons)
    await sql`SELECT set_config('insignia.publication_abandonment_detail', ${JSON.stringify({ reasons })}, true)`.execute(
      tx,
    );
  await sql`UPDATE m5_activation_state SET kind=${kind}, version=version+1
      ${hold ? sql`, hold=${JSON.stringify(hold)}::jsonb` : sql``}
    WHERE shop_id=${id.shopId} AND config_id=${id.configId} AND operation_id=${id.operationId}`.execute(tx);
}

/** Worker pass of the reconciliation loop (design §6). Never exported beyond the facade. */
export function createPublicationAbandonment(database: Kysely<Database>, options: PublicationAbandonmentOptions) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.appClientId)) throw new Error('Invalid trusted app client identity');
  const clock = options.now ?? (() => Date.now());
  const emit = (row: Identity, outcome: PublicationAbandonmentEvent['outcome'], reasons: readonly string[] = []) => {
    try {
      options.onEvent?.({ ...row, outcome, reasons });
    } catch {}
  };
  const flag = async (tx: Transaction<Database>, row: Identity, reasons: readonly AbandonmentFlagReason[]) => {
    await setKind(tx, row, 'OPERATOR_HOLD', undefined, reasons);
    emit(row, 'flagged', reasons);
  };

  /** A per-row port that sees only this token and this scope (design §4.4, §5). */
  function portFor(row: Identity & { operationGeneration: string }, token: OfflineToken & { kind: 'usable' }) {
    const credentials = {
      acquire: async (input: { shopId: string; installationGeneration: string }): Promise<OfflineToken> =>
        input.shopId === row.shopId && input.installationGeneration === row.operationGeneration
          ? token
          : { kind: 'inactive' },
    };
    return options.availability({
      credentials,
      isCurrent: async (scope) =>
        scope.shopId === row.shopId &&
        scope.installationGeneration === row.operationGeneration &&
        scope.appClientId === options.appClientId,
    });
  }
  const token = async (row: Identity & { operationGeneration: string }) => {
    try {
      const acquired = await options.acquireToken({
        shopId: row.shopId,
        installationGeneration: row.operationGeneration,
      });
      return acquired.kind === 'usable' && acquired.accessExpiresAt.getTime() > clock() + 30_000 ? acquired : null;
    } catch {
      return null;
    }
  };

  /** T1: recheck under the lock, observe read-only (E8), then FLAG or commit the one-use claim. */
  async function claim(id: Identity & { operationGeneration: string }, kind: ActivationStateKind, allowClaim: boolean) {
    const prebound = allowClaim && options.mode === 'restore' && kind === 'HELD' ? await token(id) : null;
    return database.transaction().execute(async (tx) => {
      const row = await lockSix(tx, id);
      if (!row) return { claimed: false, flagged: false, token: null };
      const decide = (observation?: AbandonmentObservation): AbandonmentDecision =>
        decideAbandonment({
          candidate: row,
          observation,
          abandonAfterMs: options.abandonAfterMs,
          releaseWaitFlagMs: options.releaseWaitFlagMs,
        });
      let decision = decide();
      if (decision.kind === 'OBSERVE') {
        // Flag mode, the pass's claim limit or no usable offline token: no Shopify read, no claim.
        if (!prebound) {
          if (allowClaim && options.mode === 'restore') emit(row, 'skipped', ['credential_unavailable']);
          return { claimed: false, flagged: false, token: null };
        }
        const hold = row.hold as AbandonedHold;
        let observation: AbandonmentObservation;
        try {
          observation = await portFor(row, prebound).observe(hold.before.scope, hold);
        } catch (error) {
          if (!(error instanceof AvailabilityProviderUnavailableError)) throw error;
          observation = { kind: 'UNAVAILABLE' };
        }
        decision = decide(observation);
      }
      if (decision.kind === 'FLAG') {
        await flag(tx, row, decision.reasons);
        return { claimed: false, flagged: true, token: null };
      }
      if (decision.kind !== 'CLAIM') {
        if (decision.kind === 'SKIP' && decision.reason.startsWith('observation'))
          emit(row, 'skipped', [decision.reason]);
        return { claimed: false, flagged: false, token: null };
      }
      const hold = row.hold as AbandonedHold;
      await setKind(tx, row, 'ABANDON_CLAIMED', {
        ...hold,
        abandonmentClaim: decision.abandonmentClaim,
        restorationClaim: decision.restorationClaim,
      } as AbandonedHold);
      return { claimed: true, flagged: false, token: prebound };
    });
  }

  /**
   * T2: recheck the claim, then the unchanged v3 restore with the per-row port. The receipt and
   * the resulting kind commit together. `claimedHere` is true only for the invocation whose T1
   * committed the claim; any other invocation dispatches only by rearming an unconsumed
   * NOT_DISPATCHED receipt (one retry), otherwise it waits for the stale bound.
   */
  async function restore(
    id: Identity & { operationGeneration: string },
    claimedHere: boolean,
    prebound: (OfflineToken & { kind: 'usable' }) | null,
  ) {
    const bound = prebound ?? (options.mode === 'restore' ? await token(id) : null);
    return database.transaction().execute(async (tx) => {
      const row = await lockSix(tx, id);
      if (!row || row.kind !== 'ABANDON_CLAIMED') return 'skipped' as const;
      const hold = row.hold as AbandonedHold;
      if (
        hold?.version !== 'm5-availability-hold-v3' ||
        !hold.abandonmentClaim ||
        !hold.held ||
        row.phase !== 'prepared' ||
        row.status !== 'requested' ||
        row.operationSequence !== row.configSequence ||
        !row.installationCurrent
      ) {
        await flag(tx, row, ['claim_fenced']);
        return 'flagged' as const;
      }
      let dispatchHold: AbandonedHold = hold;
      const settle = () =>
        settleAbandonmentReceipt({
          hold,
          receipt: hold.restorationReceipt,
          claimUpdatedAt: row.activationUpdatedAt,
          now: row.now,
          staleMs: options.claimStaleMs,
        });
      if (hold.restorationReceipt) {
        if (!abandonmentRearmable(hold)) {
          const next = settle();
          if (next === 'OPERATOR_HOLD') {
            await flag(tx, row, ['claim_unsettled']);
            return 'flagged' as const;
          }
          if (next === 'ABANDON_RESTORED') {
            await setKind(tx, row, 'ABANDON_RESTORED');
            return 'restored' as const;
          }
          emit(row, 'skipped', ['claim_in_flight']);
          return 'skipped' as const;
        }
        if (options.mode !== 'restore' || !bound) return 'skipped' as const;
        // Rearm once: the migration-51 rule consumes this receipt digest into the claim.
        dispatchHold = {
          ...hold,
          restorationClaim: {
            ...hold.restorationClaim!,
            settledNoDispatchReceiptDigest: activationDigest(hold.restorationReceipt),
          },
        };
        await sql`UPDATE m5_activation_state SET hold=${JSON.stringify(dispatchHold)}::jsonb, version=version+1
          WHERE shop_id=${row.shopId} AND config_id=${row.configId} AND operation_id=${row.operationId}`.execute(tx);
      } else if (!claimedHere) {
        if (settle() === 'OPERATOR_HOLD') {
          // A crash after T1 (or inside T2) may have dispatched: never restore again.
          await flag(tx, row, ['claim_unsettled']);
          return 'flagged' as const;
        }
        emit(row, 'skipped', ['claim_in_flight']);
        return 'skipped' as const;
      }
      if (!bound) return 'skipped' as const;
      let open = true;
      const scope = hold.before.scope;
      const beforeSend = () =>
        open &&
        scope.shopId === row.shopId &&
        scope.installationGeneration === row.operationGeneration &&
        bound.accessExpiresAt.getTime() > clock() + 30_000;
      let outcome: Awaited<ReturnType<ProductAvailabilityHoldV3Port['restore']>>;
      try {
        outcome = await portFor(row, bound).restore(scope, dispatchHold, hold.held, beforeSend);
      } catch {
        // No receipt: a write may have been dispatched. Commit the stop with the claim (and any
        // consumed rearm) so nothing can replay it.
        await setKind(tx, row, 'OPERATOR_HOLD', undefined, ['restore_ambiguous']);
        emit(row, 'ambiguous', ['restore_ambiguous']);
        return 'flagged' as const;
      } finally {
        open = false;
      }
      if (
        (outcome.current && !isAvailabilityV3(outcome.current)) ||
        ('acknowledgement' in outcome &&
          outcome.acknowledgement &&
          outcome.acknowledgement.version !== 'm5-availability-mutation-ack-v3')
      )
        throw new Error('V3 restoration returned legacy evidence');
      const receipt: AvailabilityRestorationReceiptV3 = {
        version: 'm5-availability-restoration-receipt-v3',
        kind: outcome.kind,
        acknowledgement: (outcome.acknowledgement as AvailabilityRestorationReceiptV3['acknowledgement']) ?? null,
        current: outcome.current as ProductAvailabilitySnapshotV3 | null,
        ...('compensation' in outcome && outcome.compensation ? { compensation: outcome.compensation } : {}),
      } as AvailabilityRestorationReceiptV3;
      const stored: AbandonedHold = { ...dispatchHold, restorationReceipt: receipt };
      // Receipt first (audit RECEIPT), then the kind it settles to, in this same transaction.
      await sql`UPDATE m5_activation_state SET hold=${JSON.stringify(stored)}::jsonb, version=version+1
        WHERE shop_id=${row.shopId} AND config_id=${row.configId} AND operation_id=${row.operationId}`.execute(tx);
      const next = settleAbandonmentReceipt({
        hold: stored,
        receipt,
        claimUpdatedAt: row.now,
        now: row.now,
        staleMs: options.claimStaleMs,
      });
      if (next === 'ABANDON_RESTORED') {
        await setKind(tx, row, 'ABANDON_RESTORED');
        emit(row, 'restored');
        return 'restored' as const;
      }
      if (next === 'ABANDON_CLAIMED') {
        emit(row, 'not_dispatched');
        return 'not_dispatched' as const;
      }
      const reason = receipt.kind === 'RESTORED' ? 'restore_conflict' : abandonmentReceiptReason(receipt);
      await setKind(tx, row, 'OPERATOR_HOLD', undefined, [reason]);
      emit(row, reason === 'restore_ambiguous' ? 'ambiguous' : 'conflict', [reason]);
      return 'flagged' as const;
    });
  }

  /** T3, idempotent: phase abandoned, operation failed with its disposition, pointer cleared. */
  async function finalize(id: Identity) {
    return database.transaction().execute(async (tx) => {
      const row = await lockSix(tx, id);
      if (!row || row.kind !== 'ABANDON_RESTORED' || row.phase !== 'prepared') return false;
      const observedAt = (row.hold as AbandonedHold).restorationReceipt?.current?.observedAt;
      if (!observedAt) throw new Error('Restored abandonment receipt lacks its readback');
      await sql`UPDATE m4_publication_progress SET phase='abandoned', version=version+1
        WHERE shop_id=${row.shopId} AND config_id=${row.configId} AND operation_id=${row.operationId}`.execute(tx);
      await sql`UPDATE publication_operations SET status='failed', failed_at=clock_timestamp(),
          failure_class='publication-abandoned', availability_resolved_at=${observedAt}::timestamptz
        WHERE shop_id=${row.shopId} AND config_id=${row.configId} AND operation_id=${row.operationId}`.execute(tx);
      // Exactly as an operator resolution (availability-recovery.ts): only this request's pointer.
      await sql`DELETE FROM m5_current_publication_pointer WHERE shop_id=${row.shopId} AND config_id=${row.configId}
        AND revision_id=${row.revisionId} AND ${row.operationId}=${row.revisionId}
        AND installation_generation=${row.operationGeneration}::bigint`.execute(tx);
      emit(row, 'finalized');
      return true;
    });
  }

  /** Activated path (§4.4): a stale RESTORATION_CLAIMED goes to the operator; never restored here. */
  async function staleActivated(id: Identity) {
    return database.transaction().execute(async (tx) => {
      const row = await lockSix(tx, id);
      const hold = row?.hold;
      if (!row || row.kind !== 'RESTORATION_CLAIMED' || hold?.version !== 'm5-availability-hold-v3') return false;
      if (
        !restorationClaimStale({
          hold,
          claimUpdatedAt: row.activationUpdatedAt,
          now: row.now,
          staleMs: options.claimStaleMs,
        })
      )
        return false;
      await flag(tx, row, ['claim_unsettled']);
      return true;
    });
  }

  return {
    /** One bounded pass: at most 2 restores, 10 finalizes and 10 flags within 20 s. `scope`
     * limits it to one shop (the operator command and tests); the worker passes none. */
    async runPass(
      scope: { shopId: string } | null = null,
    ): Promise<{ restored: number; finalized: number; flagged: number; flaggedHolds: number }> {
      const result = { restored: 0, finalized: 0, flagged: 0, flaggedHolds: 0 };
      let claims = 0;
      if (options.mode === 'off') return result;
      const started = clock();
      const limits = ABANDONMENT_PASS_LIMITS;
      const rows = await sql<Identity & { kind: ActivationStateKind; operationGeneration: string }>`
        SELECT a.shop_id AS "shopId", a.config_id AS "configId", a.operation_id AS "operationId", a.kind,
          o.installation_generation::text AS "operationGeneration"
        FROM m5_activation_state a
        JOIN publication_operations o USING (shop_id, config_id, operation_id)
        JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
        JOIN shops s ON s.shop_id=a.shop_id
        WHERE a.hold IS NOT NULL AND a.kind NOT IN ('RESTORED','RESOLVED')
          ${scope ? sql`AND a.shop_id=${scope.shopId}` : sql``} AND (
          (a.kind IN ('HELD','ACQUISITION_PENDING') AND s.current_generation=o.installation_generation
            AND greatest(o.requested_at,p.updated_at,a.updated_at) <= clock_timestamp() - ${options.abandonAfterMs} * interval '1 millisecond')
          OR (a.kind='WAITING_RELEASE' AND s.current_generation=o.installation_generation
            AND greatest(o.requested_at,p.updated_at,a.updated_at) <= clock_timestamp() - ${options.releaseWaitFlagMs} * interval '1 millisecond')
          OR a.kind='ABANDON_CLAIMED'
          OR (a.kind='ABANDON_RESTORED' AND p.phase='prepared')
          OR (a.kind='RESTORATION_CLAIMED'
            AND a.updated_at <= clock_timestamp() - ${options.claimStaleMs} * interval '1 millisecond'))
        ORDER BY a.updated_at LIMIT ${limits.scan}`.execute(database);
      for (const row of rows.rows) {
        if (clock() - started >= limits.budgetMs) break;
        try {
          if (row.kind === 'ABANDON_RESTORED') {
            if (result.finalized < limits.finalizes && (await finalize(row))) result.finalized++;
          } else if (row.kind === 'RESTORATION_CLAIMED') {
            if (result.flagged < limits.flags && (await staleActivated(row))) result.flagged++;
          } else if (row.kind === 'ABANDON_CLAIMED') {
            if (claims >= limits.claims || result.flagged >= limits.flags) continue;
            claims++;
            const outcome = await restore(row, false, null);
            if (outcome === 'restored') {
              result.restored++;
              if (await finalize(row)) result.finalized++;
            } else if (outcome === 'flagged') result.flagged++;
          } else {
            if (result.flagged >= limits.flags) continue;
            const t1 = await claim(row, row.kind, claims < limits.claims);
            if (t1.flagged) result.flagged++;
            if (!t1.claimed) continue;
            claims++;
            const outcome = await restore(row, true, t1.token);
            if (outcome === 'restored') {
              result.restored++;
              if (await finalize(row)) result.finalized++;
            } else if (outcome === 'flagged') result.flagged++;
          }
        } catch {
          // One row's database or provider failure changes nothing for the others (next pass).
        }
      }
      const flagged = await sql<{ count: string }>`SELECT count(*)::text AS count FROM m5_activation_state
        WHERE kind='OPERATOR_HOLD' AND hold IS NOT NULL`.execute(database);
      result.flaggedHolds = Number(flagged.rows[0]?.count ?? 0);
      return result;
    },
  };
}
