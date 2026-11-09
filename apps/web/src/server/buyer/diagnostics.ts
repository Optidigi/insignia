import { AsyncLocalStorage } from 'node:async_hooks';
import type { BuyerFailureDiagnostic } from '@insignia/observability';

type Stage = NonNullable<BuyerFailureDiagnostic['proposalStage']>;
type Attribution = { stage: Stage; path: readonly symbol[] };
const context = new AsyncLocalStorage<{
  failures: Map<unknown, Attribution>;
  path: readonly symbol[];
}>();
// Attribution belongs to one HTTP request. Never mutate or wrap original errors:
// typed handling and stock-first rejection precedence retain their contracts.
export function proposalDiagnostics<T>(run: () => T): T {
  return context.run({ failures: new Map(), path: [] }, run);
}
export function proposalFailureStage(error: unknown): Stage | undefined {
  return context.getStore()?.failures.get(error)?.stage;
}
export async function proposalStage<T>(stage: Stage, run: () => T | Promise<T>): Promise<T> {
  const parent = context.getStore();
  if (!parent) return run();
  const path = [...parent.path, Symbol()];
  return context.run({ failures: parent.failures, path }, async () => {
    try {
      return await run();
    } catch (error) {
      const existing = parent.failures.get(error);
      if (!existing) parent.failures.set(error, { stage, path });
      // A provider may reuse one error in distinct branches. Do not attribute
      // that failure to whichever branch happened to reject first.
      else if (!path.every((part, index) => existing.path[index] === part))
        parent.failures.set(error, { stage: 'ambiguous', path: [] });
      throw error;
    }
  });
}
