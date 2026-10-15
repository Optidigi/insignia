import type { PaidOrderUsageHistory, PaidOrderUsageQualification, UsagePolicyIdentity } from '@insignia/domain';
import { type CurrentCycleUsageHistoryInput, normalizeCurrentCycleUsageHistory } from './usage-history.js';
export interface PurchaseUsageScope {
  readonly shopId: string;
  readonly installationGeneration: string;
}
export interface PurchaseUsageLedgerRecord extends PurchaseUsageScope {
  readonly purchaseId: string;
  readonly decision: PaidOrderUsageQualification;
}
export interface PurchaseUsageLedgerPort {
  record(
    scope: PurchaseUsageScope,
    input: { purchaseId: string; policy: UsagePolicyIdentity | null; history: PaidOrderUsageHistory },
  ): Promise<PurchaseUsageLedgerRecord>;
}
export type PurchaseUsageQualificationResult = {
  kind: 'RECORDED' | 'SOURCE_UNAVAILABLE' | 'SCOPE_MISMATCH';
  record: PurchaseUsageLedgerRecord;
};
function project(
  record: PurchaseUsageLedgerRecord,
  scope: PurchaseUsageScope,
  purchaseId: string,
): PurchaseUsageLedgerRecord {
  if (
    record?.shopId !== scope.shopId ||
    record.installationGeneration !== scope.installationGeneration ||
    record.purchaseId !== purchaseId
  )
    throw new Error('Usage ledger identity mismatch');
  return {
    shopId: record.shopId,
    installationGeneration: record.installationGeneration,
    purchaseId: record.purchaseId,
    decision: record.decision,
  };
}
/** Source loader supplies verified backend observations and a separately qualified billing mapping.
 * This use case neither authenticates provider reads nor dispatches usage. Immutable facts belong to the ledger. */
export function createPurchaseUsageQualifier(ports: {
  ledger: PurchaseUsageLedgerPort;
  loadCurrentCycleInput(scope: PurchaseUsageScope): Promise<CurrentCycleUsageHistoryInput>;
}) {
  return {
    async qualify(
      callerScope: PurchaseUsageScope,
      input: { purchaseId: string },
    ): Promise<PurchaseUsageQualificationResult> {
      const scope = { shopId: callerScope.shopId, installationGeneration: callerScope.installationGeneration };
      const purchaseId = input.purchaseId;
      const preflight = project(
        await ports.ledger.record({ ...scope }, { purchaseId, policy: null, history: { kind: 'UNVERIFIED' } }),
        scope,
        purchaseId,
      );
      if (preflight.decision.kind !== 'UNRESOLVED' || preflight.decision.reason !== 'HISTORY_UNVERIFIED')
        return { kind: 'RECORDED', record: preflight };
      let source: CurrentCycleUsageHistoryInput;
      try {
        source = await ports.loadCurrentCycleInput({ ...scope });
      } catch {
        return { kind: 'SOURCE_UNAVAILABLE', record: preflight };
      }
      if (
        source?.installation?.tenantShopId !== scope.shopId ||
        source.installation.generation !== scope.installationGeneration
      )
        return { kind: 'SCOPE_MISMATCH', record: preflight };
      const normalized = normalizeCurrentCycleUsageHistory(source);
      const record = project(
        await ports.ledger.record(
          { ...scope },
          { purchaseId, policy: source.binding?.policy ?? null, history: normalized.history },
        ),
        scope,
        purchaseId,
      );
      return { kind: 'RECORDED', record };
    },
  };
}
