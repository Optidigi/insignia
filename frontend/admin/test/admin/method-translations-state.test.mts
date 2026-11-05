import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMethodWorkflowState, methodWorkflowDirty, methodWorkflowReducer } from '../../examples/admin/support/method-workflow-state.mts';
import { newMethod } from '../../examples/admin/support/method-configuration.mts';

test('Method translation editing preserves default text and other-language drafts, with sparse fallback and stale-session fencing', () => {
  const method = { ...newMethod(), id: 'method', name: 'Print', explanation: 'Full colour', pricing: 'product' as const };
  const state = createMethodWorkflowState([method], method, 'session', newMethod());
  const dutch = methodWorkflowReducer(state, { type: 'method-translation-edited', sessionId: 'session', locale: 'nl', field: 'name', value: 'Bedrukking' });
  assert.equal(dutch.editor?.name, 'Print');
  assert.equal(dutch.editor?.explanation, 'Full colour');
  assert.equal(dutch.editor?.translations?.nl?.name, 'Bedrukking');
  assert.equal(methodWorkflowDirty(dutch), true);
  const french = methodWorkflowReducer(dutch, { type: 'method-translation-edited', sessionId: 'session', locale: 'fr', field: 'explanation', value: 'En couleur' });
  assert.equal(french.editor?.translations?.nl?.name, 'Bedrukking');
  const cleared = methodWorkflowReducer(french, { type: 'method-translation-edited', sessionId: 'session', locale: 'nl', field: 'name', value: '' });
  assert.equal(cleared.editor?.translations?.nl, undefined);
  assert.equal(cleared.editor?.translations?.fr?.explanation, 'En couleur');
  assert.equal(methodWorkflowReducer(cleared, { type: 'method-translation-edited', sessionId: 'old-session', locale: 'fr', field: 'name', value: 'Stale' }), cleared);
});
