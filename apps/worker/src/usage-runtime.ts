import type { DurableCore } from '@insignia/database';
import { createWorkerUsageReconciliation } from './usage-reconciliation.js';
import { createWorkerUsageSource } from './usage-source.js';

type WorkerUsageRuntimeInput = {
  env: Readonly<Record<string, string | undefined>>;
  core: Pick<DurableCore, 'tenants' | 'usageLedger' | 'usageDeliveryIntents'>;
};

/** Lean V1 is recurring-only. Inherited usage flags grant no new qualification, staging or dispatch. */
export function createWorkerUsageRuntime(_input: WorkerUsageRuntimeInput): undefined {
  return undefined;
}

/** Historical qualification/operator seam only; shipping main does not call this factory.
 * No commercial binding, provider credential or billing dispatch is configured here. */
export function createHistoricalWorkerUsageRuntime(
  input: WorkerUsageRuntimeInput,
): ReturnType<typeof createWorkerUsageReconciliation> | undefined {
  const flag = input.env.INSIGNIA_M9_QUALIFICATION_ENABLED;
  if (flag === undefined || flag === '0') return undefined;
  const shopId = input.env.INSIGNIA_M9_TENANT_SHOP_ID;
  const installationGeneration = input.env.INSIGNIA_M9_INSTALLATION_GENERATION;
  const appId = input.env.INSIGNIA_SHOPIFY_APP_ID;
  if (
    flag !== '1' ||
    !shopId ||
    shopId.length > 256 ||
    /[\s\p{Cc}]/u.test(shopId) ||
    !installationGeneration ||
    !/^[1-9][0-9]{0,18}$/.test(installationGeneration) ||
    BigInt(installationGeneration) > 9223372036854775807n ||
    !appId ||
    !/^[1-9][0-9]{0,19}$/.test(appId)
  )
    throw new Error('USAGE_RUNTIME_INVALID');
  const source = createWorkerUsageSource({
    appId: `gid://shopify/App/${appId}`,
    binding: null,
    transport: null,
    tenants: input.core.tenants,
  });
  return createWorkerUsageReconciliation({
    scope: { shopId, installationGeneration },
    core: input.core,
    loadCurrentCycleInput: source.load,
    resolveBinding: async () => null,
  });
}
