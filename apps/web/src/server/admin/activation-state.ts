import type { PublicationState } from '../../shared/admin-view.js';

export function projectActivationPublicationState(input: {
  phase: string | null;
  effectiveOperationId: string | null;
  operationId: string | null;
  activationKind: string | null;
  operationStatus?: string;
  reconciliationKind?: string | null;
  recoveryFromAnotherOperation?: boolean;
  /** #466: the config's newest operation was abandoned and its product restored (derived input). */
  abandonedLatest?: boolean;
  /** #466: the current operation's activation row still carries an availability hold. */
  holdPresent?: boolean;
}): PublicationState {
  // #466, before the reconciliation and `failed` branches. The abandoned request is invisible
  // after finalize, so the restoring state comes from the current operation and the restored one
  // from the derived input.
  if (
    input.activationKind === 'ABANDON_CLAIMED' ||
    (input.activationKind === 'ABANDON_RESTORED' && input.operationStatus === 'requested')
  )
    return 'ABANDONMENT_RESTORING';
  // Safe before the other-operation hold below: prepare() refuses a publication while any hold of
  // this config is unresolved, and only the newest operation can take one. When the newest one was
  // abandoned and restored, no other operation of the config can still carry a hold.
  if (input.abandonedLatest) return 'ABANDONED_RESTORED';
  // A pre-activation hold that needs the operator shows the support copy (spec: the product may be
  // unavailable), also when a reconciliation hold is recorded: a hold another operation of this
  // config still carries (an older request, a prior installation), or this request's own.
  if (input.recoveryFromAnotherOperation) return 'HOLD_NEEDS_SUPPORT';
  if (input.activationKind === 'OPERATOR_HOLD' && input.operationStatus !== 'activated' && input.holdPresent)
    return 'HOLD_NEEDS_SUPPORT';
  if (input.reconciliationKind === 'OPERATOR_HOLD') return 'OPERATOR_HOLD';
  if (input.operationStatus === 'failed' || input.operationStatus === 'superseded')
    return input.activationKind === null || ['RESOLVED', 'RESTORED', 'ABANDON_RESTORED'].includes(input.activationKind)
      ? 'FAILED'
      : 'OPERATOR_HOLD';
  if (input.phase === 'operator-hold') return 'OPERATOR_HOLD';
  if (input.phase === 'conflict') return 'CONFLICT';
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
    case 'RESTORATION_CLAIMED':
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
