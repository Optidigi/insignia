import type { PublicationState } from '../../shared/admin-view.js';

export function projectActivationPublicationState(input: {
  phase: string | null;
  effectiveOperationId: string | null;
  operationId: string | null;
  activationKind: string | null;
  recoveryFromAnotherOperation?: boolean;
}): PublicationState {
  if (input.recoveryFromAnotherOperation) return 'OPERATOR_HOLD';
  const active =
    input.phase === 'active' && input.effectiveOperationId !== null && input.effectiveOperationId === input.operationId;
  switch (input.activationKind) {
    case 'WAITING_RELEASE':
      return 'ACTIVATION_WAITING_RELEASE';
    case 'WAITING_HOLD':
    case 'HOLD_INTENT':
    case 'ACQUISITION_PENDING':
      return 'ACTIVATION_WAITING_HOLD';
    case 'HELD':
      return 'HELD_ACTIVATION_PENDING';
    case 'RESTORATION_PENDING':
      return active ? 'ACTIVATED_RESTORATION_PENDING' : 'OPERATOR_HOLD';
    case 'OPERATOR_HOLD':
      return active ? 'RESTORATION_CONFLICT' : 'OPERATOR_HOLD';
    case 'RESTORED':
      return active ? 'ACTIVE' : 'OPERATOR_HOLD';
    case null:
      break;
    default:
      return 'OPERATOR_HOLD';
  }
  if (active) return 'ACTIVE';
  if (input.phase === null) return input.effectiveOperationId ? 'ACTIVE' : 'DRAFT';
  if (input.phase === 'activation-pending') return 'REMOTE_READY_ACTIVATION_PENDING';
  if (input.phase === 'conflict') return 'CONFLICT';
  if (input.phase === 'operator-hold' || input.phase === 'active') return 'OPERATOR_HOLD';
  if (input.phase === 'prepared' || input.phase === 'intent') return 'PUBLISH_REQUESTED';
  return 'REMOTE_PENDING';
}
