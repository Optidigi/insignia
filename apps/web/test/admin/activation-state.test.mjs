import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectActivationPublicationState } from '../../src/server/admin/activation-state.ts';

test('admin distinguishes activation waiting, held, restoration and conflict without manufacturing ACTIVE', () => {
  const active = { phase: 'active', effectiveOperationId: 'op', operationId: 'op', activationKind: 'RESTORED' };
  assert.equal(projectActivationPublicationState(active), 'ACTIVE');
  assert.equal(projectActivationPublicationState({ ...active, recoveryFromAnotherOperation: true }), 'OPERATOR_HOLD');
  assert.equal(projectActivationPublicationState({ ...active, effectiveOperationId: null }), 'OPERATOR_HOLD');
  for (const [activationKind, expected] of [
    ['WAITING_RELEASE', 'ACTIVATION_WAITING_RELEASE'],
    ['HOLD_INTENT', 'ACTIVATION_WAITING_HOLD'],
    ['ACQUISITION_PENDING', 'ACTIVATION_WAITING_HOLD'],
    ['HELD', 'HELD_ACTIVATION_PENDING'],
  ])
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
