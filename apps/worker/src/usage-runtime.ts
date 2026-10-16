import type { DurableCore } from '@insignia/database';

type WorkerUsageRuntimeInput = {
  env: Readonly<Record<string, string | undefined>>;
  core: Pick<DurableCore, 'tenants' | 'usageLedger' | 'usageDeliveryIntents'>;
};

/** Lean V1 is recurring-only. Inherited usage flags grant no new qualification, staging or dispatch. */
export function createWorkerUsageRuntime(_input: WorkerUsageRuntimeInput): undefined {
  return undefined;
}
