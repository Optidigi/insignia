import {
  createFunctionOwnershipReconciler,
  type ExpectedFunctionOwnership,
  type FunctionSetupJournal,
  type PublicationAdminTransport,
  type PublicationTenant,
  provisionOwnedFunctions,
} from '@insignia/shopify';

export type AutomaticFunctionState = 'PRESENT' | 'CREATED' | 'STOPPED' | 'OWNER_ACTION_REQUIRED' | 'UNREAD';

/** One run's in-memory journal; the store's own Function deployments are the durable truth. */
function memoryJournal(): FunctionSetupJournal {
  const reserved = new Set<string>();
  return {
    reserve(operation) {
      if (reserved.has(operation)) throw new Error('Function setup step already reserved');
      reserved.add(operation);
      return true;
    },
    settle() {},
    finish() {},
  };
}

/**
 * Deploys the app's cart transform and validation on a store that has neither, the first time it
 * publishes. A store with both needs nothing. Anything partial, foreign, duplicated or drifted is
 * left for the owner: this never replaces or removes a deployment. The Function IDs are the ones
 * the store itself lists for this app; creation uses the reviewed handles only.
 */
export async function ensureStoreFunctions(input: {
  tenant: PublicationTenant;
  expected: ExpectedFunctionOwnership;
  transport: PublicationAdminTransport;
  clock: () => Date;
  /** Rechecks the installation and staff grant; returns how long both stay current (at most 30 s). */
  verifyAuthority: () => Promise<Date>;
}): Promise<AutomaticFunctionState> {
  let owned: Awaited<ReturnType<ReturnType<typeof createFunctionOwnershipReconciler>['read']>>;
  try {
    owned = await createFunctionOwnershipReconciler({ transport: input.transport, clock: input.clock }).read(
      input.tenant,
      input.expected,
    );
  } catch {
    // Unreadable with this staff member's token: nothing is known, so nothing is created here.
    return 'UNREAD';
  }
  if (owned.transform === 'present' && owned.validation === 'present') return 'PRESENT';
  if (owned.transform === 'unknown' || owned.validation === 'unknown') return 'UNREAD';
  if (owned.transform !== 'missing' || owned.validation !== 'missing') return 'OWNER_ACTION_REQUIRED';
  const transform = owned.observation?.transform?.functionId;
  const validation = owned.observation?.validation?.functionId;
  if (!transform || !validation) return 'OWNER_ACTION_REQUIRED';
  const result = await provisionOwnedFunctions({
    tenant: input.tenant,
    expected: input.expected,
    functionIds: { transform, validation },
    transport: input.transport,
    journal: memoryJournal(),
    clock: input.clock,
    verifyAuthority: input.verifyAuthority,
    verifyClosingAuthority: input.verifyAuthority,
  });
  return result.classification === 'FUNCTIONS_VERIFIED' ? 'CREATED' : 'STOPPED';
}
