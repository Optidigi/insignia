import {
  type CurrentCycleUsageHistoryInput,
  createPurchaseUsageQualifier,
  type PurchaseUsageScope,
} from '@insignia/application';
import type { DurableCore, UsageDeliveryBinding } from '@insignia/database';

interface Summary {
  processed: number;
  staged: number;
  held: number;
  failed: number;
}
/** Local recovery only. No dispatch, credential authorization, scheduler or durable cursor is implied. */
export function createWorkerUsageReconciliation(input: {
  scope: PurchaseUsageScope;
  pageSize?: number;
  core: Pick<DurableCore, 'usageLedger' | 'usageDeliveryIntents'>;
  loadCurrentCycleInput(scope: PurchaseUsageScope): Promise<CurrentCycleUsageHistoryInput>;
  resolveBinding(scope: PurchaseUsageScope): Promise<UsageDeliveryBinding | null>;
}) {
  const scope = { shopId: input.scope.shopId, installationGeneration: input.scope.installationGeneration },
    pageSize = input.pageSize ?? 20;
  if (
    typeof scope.shopId !== 'string' ||
    !scope.shopId ||
    scope.shopId.length > 256 ||
    /[\s\p{Cc}]/u.test(scope.shopId) ||
    typeof scope.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
    BigInt(scope.installationGeneration) > 9223372036854775807n
  )
    throw new Error('USAGE_RECOVERY_INVALID');
  const selectPending = input.core.usageLedger.selectPending.bind(input.core.usageLedger);
  const prepare = input.core.usageDeliveryIntents.prepare.bind(input.core.usageDeliveryIntents);
  const resolveBinding = input.resolveBinding;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('USAGE_RECOVERY_INVALID');
  const qualifier = createPurchaseUsageQualifier({
    ledger: { record: input.core.usageLedger.record.bind(input.core.usageLedger) },
    loadCurrentCycleInput: input.loadCurrentCycleInput,
  });
  let afterPurchaseId: string | null = null;
  let active: Promise<Summary> | undefined;
  let stopped = false;
  const empty = (): Summary => ({ processed: 0, staged: 0, held: 0, failed: 0 });
  const runOnce = (): Promise<Summary> => {
    if (stopped) return Promise.resolve(empty());
    if (active) return active;
    active = (async () => {
      const summary = empty();
      let page: Awaited<ReturnType<typeof selectPending>>;
      try {
        page = await selectPending({ ...scope }, { limit: pageSize, afterPurchaseId });
      } catch {
        return { ...summary, failed: 1 };
      }
      for (const purchase of page.purchases) {
        if (stopped) break;
        summary.processed++;
        try {
          if (purchase.shopId !== scope.shopId || purchase.installationGeneration !== scope.installationGeneration)
            throw new Error('USAGE_RECOVERY_SCOPE');
          const result = await qualifier.qualify({ ...scope }, { purchaseId: purchase.purchaseId });
          if (result.record.decision.kind !== 'ELIGIBLE' || stopped) {
            summary.held++;
            continue;
          }
          const binding = await resolveBinding({ ...scope });
          if (!binding || stopped) {
            summary.held++;
            continue;
          }
          const prepared = await prepare({ ...scope }, { purchaseId: purchase.purchaseId, binding });
          if (prepared.kind === 'STAGED') summary.staged++;
          else summary.held++;
        } catch {
          // No provider/purchase payload or collaborator error is returned or logged.
          summary.failed++;
        }
      }
      if (!stopped) afterPurchaseId = page.exhausted ? null : page.nextCursor;
      return summary;
    })().finally(() => {
      active = undefined;
    });
    return active;
  };
  return {
    runOnce,
    async stop() {
      stopped = true;
      await active;
    },
  };
}
