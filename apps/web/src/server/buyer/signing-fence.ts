import { AsyncLocalStorage } from 'node:async_hooks';

// One context instance, isolated by async execution rather than mutable request flags.
const signingFence = new AsyncLocalStorage<true>();

/**
 * Runs an acceptance or renewal signing callback, which executes while the store holds the shop-row
 * lock. Inside it only stored facts (read on the fence's own connection), freshness at the signing
 * instant and the signer RPC may run (spec §8.4, #386, #390).
 */
export function runSigningFence<T>(run: () => Promise<T>): Promise<T> {
  return signingFence.run(true, run);
}

/** Provider IO, credential acquisition and release reads all happen before the fence; refuse them inside. */
export function assertOutsideSigningFence(operation: string): void {
  if (signingFence.getStore()) throw new Error(`${operation} is not allowed inside the signing fence`);
}

/** A provider transport's fetch that refuses to dispatch while a signing fence holds the shop lock. */
export function fenceGuardedFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (target, options) => {
    assertOutsideSigningFence('Provider request');
    return fetchImpl(target, options);
  };
}
