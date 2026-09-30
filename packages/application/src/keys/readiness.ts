import type { KeyScope } from './crypto.js';
import { type PublicConfig, requireIssuanceReady } from './public-config.js';

export type FunctionPresence = 'present' | 'missing' | 'duplicate' | 'drift' | 'unknown';
export type QuoteIssuanceReadinessInput = {
  scope: KeyScope;
  selectedKeyId: number;
  acceptedDay: number;
  desired: PublicConfig;
  observed: { value: string; observedAt: Date };
  now: Date;
  maxObservationAgeMs: number;
  functions: { transform: FunctionPresence; validation: FunctionPresence };
  effectiveRevision: boolean;
};

/** Fail closed immediately before signing; a Shopify Admin readback is only observation, not propagation proof. */
export function assertQuoteIssuanceReady(input: QuoteIssuanceReadinessInput): void {
  const { scope, desired, observed } = input;
  if (
    desired.scope.shopId !== scope.shopId ||
    desired.scope.installationGeneration !== scope.installationGeneration ||
    desired.scope.authorizationGeneration !== scope.authorizationGeneration ||
    desired.scope.authorizationEpoch !== scope.authorizationEpoch
  )
    throw new Error('Signing scope changed');
  requireIssuanceReady({ config: desired, keyId: input.selectedKeyId, acceptedDay: input.acceptedDay });
  if (
    !Number.isFinite(input.maxObservationAgeMs) ||
    input.maxObservationAgeMs < 0 ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(observed.observedAt.getTime()) ||
    observed.observedAt.getTime() > input.now.getTime() ||
    input.now.getTime() - observed.observedAt.getTime() > input.maxObservationAgeMs ||
    observed.value !== desired.value
  )
    throw new Error('Public Function config unobserved or drifted');
  if (input.functions.transform !== 'present' || input.functions.validation !== 'present')
    throw new Error('Required Function pair not ready');
  if (!input.effectiveRevision) throw new Error('ProductConfig revision is not active');
}
