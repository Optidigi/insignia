import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectActivationPublicationState } from '../../src/server/admin/activation-state.ts';

test('admin distinguishes activation waiting, held, restoration and conflict without manufacturing ACTIVE', () => {
  const active = { phase: 'active', effectiveOperationId: 'op', operationId: 'op', activationKind: 'RESTORED' };
  assert.equal(projectActivationPublicationState(active), 'ACTIVE');
  // #466: a hold on another operation of this config needs support.
  assert.equal(
    projectActivationPublicationState({ ...active, recoveryFromAnotherOperation: true }),
    'HOLD_NEEDS_SUPPORT',
  );
  assert.equal(projectActivationPublicationState({ ...active, effectiveOperationId: null }), 'OPERATOR_HOLD');
  for (const [activationKind, expected] of [
    ['WAITING_RELEASE', 'ACTIVATION_WAITING_RELEASE'],
    ['HOLD_INTENT', 'ACTIVATION_WAITING_HOLD'],
    ['ACQUISITION_PENDING', 'ACTIVATION_WAITING_HOLD'],
    ['HELD', 'HELD_ACTIVATION_PENDING'],
  ] as const)
    assert.equal(
      projectActivationPublicationState({
        ...active,
        phase: 'activation-pending',
        effectiveOperationId: null,
        activationKind,
      }),
      expected,
    );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'RESTORATION_PENDING' }),
    'ACTIVATED_RESTORATION_PENDING',
  );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'RESTORATION_CLAIMED' }),
    'ACTIVATED_RESTORATION_PENDING',
  );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'RESTORATION_CLAIMED', effectiveOperationId: null }),
    'OPERATOR_HOLD',
  );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'OPERATOR_HOLD' }),
    'RESTORATION_CONFLICT',
  );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'RESTORATION_PENDING', effectiveOperationId: null }),
    'OPERATOR_HOLD',
  );
  assert.equal(
    projectActivationPublicationState({ ...active, activationKind: 'OPERATOR_HOLD', effectiveOperationId: null }),
    'OPERATOR_HOLD',
  );
  assert.equal(projectActivationPublicationState({ ...active, activationKind: null }), 'ACTIVE');
  assert.equal(
    projectActivationPublicationState({
      ...active,
      phase: 'activation-pending',
      effectiveOperationId: null,
      activationKind: null,
    }),
    'REMOTE_READY_ACTIVATION_PENDING',
  );
  assert.equal(projectActivationPublicationState({ ...active, activationKind: 'unknown' }), 'OPERATOR_HOLD');
});

test('publication conflict outranks a retained held/pending activation state', () => {
  assert.equal(
    projectActivationPublicationState({
      phase: 'conflict',
      effectiveOperationId: null,
      operationId: 'op',
      activationKind: 'HELD',
    }),
    'CONFLICT',
  );
});

test('terminal operator hold outranks stale held activation', () => {
  assert.equal(
    projectActivationPublicationState({
      phase: 'operator-hold',
      effectiveOperationId: null,
      operationId: 'op',
      activationKind: 'HELD',
    }),
    'OPERATOR_HOLD',
  );
});

test('failed immutable request is explicit while unresolved availability still takes precedence', () => {
  const failed = {
    phase: 'operator-hold',
    operationStatus: 'failed',
    operationId: 'request',
    effectiveOperationId: 'prior',
    activationKind: 'RESOLVED',
  };
  assert.equal(projectActivationPublicationState(failed), 'FAILED');
  // #466: an unresolved hold on another operation needs support.
  assert.equal(
    projectActivationPublicationState({ ...failed, recoveryFromAnotherOperation: true }),
    'HOLD_NEEDS_SUPPORT',
  );
});

test('#466: abandoned-hold states project before the failed branch; support copy only where a hold exists', () => {
  const requested = {
    phase: 'prepared',
    effectiveOperationId: null,
    operationId: 'op',
    operationStatus: 'requested',
  };
  assert.equal(
    projectActivationPublicationState({ ...requested, activationKind: 'ABANDON_CLAIMED' }),
    'ABANDONMENT_RESTORING',
  );
  // Restored but not yet finalized (operation still requested): still restoring.
  assert.equal(
    projectActivationPublicationState({ ...requested, activationKind: 'ABANDON_RESTORED', abandonedLatest: true }),
    'ABANDONMENT_RESTORING',
  );
  // Finalized: the request is invisible; the derived input carries the state, even over an older effective one.
  assert.equal(
    projectActivationPublicationState({
      phase: 'active',
      effectiveOperationId: 'old',
      operationId: 'old',
      activationKind: 'RESTORED',
      operationStatus: 'activated',
      abandonedLatest: true,
    }),
    'ABANDONED_RESTORED',
  );
  assert.equal(
    projectActivationPublicationState({
      phase: null,
      effectiveOperationId: null,
      operationId: null,
      activationKind: null,
      abandonedLatest: true,
    }),
    'ABANDONED_RESTORED',
  );
  // failed + ABANDON_RESTORED is a terminal failure, never OPERATOR_HOLD.
  assert.equal(
    projectActivationPublicationState({
      ...requested,
      phase: 'abandoned',
      operationStatus: 'failed',
      activationKind: 'ABANDON_RESTORED',
    }),
    'FAILED',
  );
  // An operator hold that still holds the product needs support.
  assert.equal(
    projectActivationPublicationState({ ...requested, activationKind: 'OPERATOR_HOLD', holdPresent: true }),
    'HOLD_NEEDS_SUPPORT',
  );
  assert.equal(
    projectActivationPublicationState({
      ...requested,
      operationStatus: 'failed',
      activationKind: 'OPERATOR_HOLD',
      holdPresent: true,
    }),
    'HOLD_NEEDS_SUPPORT',
  );
  // Review U2: the support copy wins over a recorded reconciliation hold.
  assert.equal(
    projectActivationPublicationState({
      ...requested,
      activationKind: 'OPERATOR_HOLD',
      holdPresent: true,
      reconciliationKind: 'OPERATOR_HOLD',
    }),
    'HOLD_NEEDS_SUPPORT',
  );
  assert.equal(
    projectActivationPublicationState({
      phase: 'active',
      effectiveOperationId: 'op',
      operationId: 'op',
      activationKind: 'RESTORED',
      reconciliationKind: 'OPERATOR_HOLD',
      recoveryFromAnotherOperation: true,
    }),
    'HOLD_NEEDS_SUPPORT',
  );
  // Without a hold, a reconciliation hold keeps its review wording.
  assert.equal(
    projectActivationPublicationState({
      phase: 'active',
      effectiveOperationId: 'op',
      operationId: 'op',
      activationKind: 'RESTORED',
      reconciliationKind: 'OPERATOR_HOLD',
    }),
    'OPERATOR_HOLD',
  );
  // An `operator-hold` phase without a hold (a field conflict) keeps its review wording.
  assert.equal(
    projectActivationPublicationState({
      ...requested,
      phase: 'operator-hold',
      activationKind: null,
      holdPresent: false,
    }),
    'OPERATOR_HOLD',
  );
  assert.equal(
    projectActivationPublicationState({
      ...requested,
      phase: 'operator-hold',
      activationKind: 'OPERATOR_HOLD',
      holdPresent: false,
    }),
    'OPERATOR_HOLD',
  );
  // After activation an operator hold stays a restoration conflict.
  assert.equal(
    projectActivationPublicationState({
      phase: 'active',
      effectiveOperationId: 'op',
      operationId: 'op',
      operationStatus: 'activated',
      activationKind: 'OPERATOR_HOLD',
      holdPresent: true,
    }),
    'RESTORATION_CONFLICT',
  );
});
