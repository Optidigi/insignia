import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newMethod } from '../../examples/admin/support/method-configuration.mts';
import {
  createMethodWorkflowState,
  methodWorkflowDirty,
  methodWorkflowReducer,
  requestMethodNavigation,
} from '../../examples/admin/support/method-workflow-state.mts';

test('currency-only review uses the same leave confirmation as value edits without changing clean demo navigation', () => {
  const method = { ...newMethod(), id: 'method', name: 'Print', amount: '3.50' };
  const state = createMethodWorkflowState([method], method, 'session', newMethod());
  const target = { kind: 'method-route' as const, path: '/admin/methods' };
  assert.equal(methodWorkflowDirty(state), false);
  assert.equal(requestMethodNavigation(state, target, 'ordinary').decision.kind, 'navigate');
  assert.equal(requestMethodNavigation(state, target, 'currency-review', true).decision.kind, 'confirm');
  const guarded = methodWorkflowReducer(state, {
    type: 'navigation-requested',
    confirmationId: 'currency-review',
    target,
    additionalDirty: true,
  });
  assert.equal(guarded.dialog.kind, 'leave');
  const cancelled = methodWorkflowReducer(guarded, { type: 'navigation-canceled', id: 'currency-review' });
  assert.equal(cancelled.dialog.kind, 'closed');
  assert.deepEqual(cancelled.editor, method);
});
