import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlacementMethodManagerState, placementMethodManagerReducer } from '../../examples/admin/support/placement-method-manager-state.mts';

test('explicitly entering the same product price still records override intent for that exact cell', () => {
  const placement = { id: 'chest', name: 'Chest', rect: { centerX: .5, centerY: .5, width: .2, height: .2 }, widthCm: '', heightCm: '', methodIds: ['print'], logoLaterAllowed: false, customPlacementAllowed: false,
    sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: { print: '3.50' } }] };
  const initial = createPlacementMethodManagerState({ sessionId: 'session', productId: '111', placement, targetRevision: 1, methods: [{ id: 'print', name: 'Printing', pricing: 'product', amount: '' }], catalogLoaded: true, initialMethodId: 'print' });
  const edited = placementMethodManagerReducer(initial, { type: 'size-price-edited', sessionId: 'session', sizeId: 'small', methodId: 'print', value: '3.50' });
  assert.deepEqual(edited.editedPriceCells, [{ sizeId: 'small', methodId: 'print' }]);
  assert.equal(edited.draft.sizes[0]!.prices.print, '3.50');
  assert.deepEqual(placementMethodManagerReducer(initial, { type: 'size-price-edited', sessionId: 'stale', sizeId: 'small', methodId: 'print', value: '3.50' }), initial);
});

test('Add method waits for the library create; a failure keeps the name for an identical retry', () => {
  const placement = { id: 'chest', name: 'Chest', rect: { centerX: .5, centerY: .5, width: .2, height: .2 }, widthCm: '', heightCm: '', methodIds: [], logoLaterAllowed: false, customPlacementAllowed: false,
    sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: {} }] };
  const send = placementMethodManagerReducer;
  let state = createPlacementMethodManagerState({ sessionId: 's', productId: '111', placement, targetRevision: 1, methods: [{ id: 'print', name: 'Printing', pricing: 'fixed', amount: '3.50' }], catalogLoaded: true });
  state = send(state, { type: 'create-screen-opened', sessionId: 's' });
  state = send(state, { type: 'create-name-edited', sessionId: 's', value: ' printing ' });
  assert.equal(send(state, { type: 'create-requested', sessionId: 's' }).nameError, 'name-duplicate');
  state = send(state, { type: 'create-name-edited', sessionId: 's', value: ' Flock ' });
  state = send(state, { type: 'create-requested', sessionId: 's' });
  assert.equal(state.creating, true);
  // While the library create is pending, the name, the screen and Done stay put.
  assert.equal(send(state, { type: 'create-name-edited', sessionId: 's', value: 'Other' }), state);
  assert.equal(send(state, { type: 'methods-screen-selected', sessionId: 's' }), state);
  assert.equal(send(state, { type: 'apply-requested', sessionId: 's' }), state);
  const failed = send(state, { type: 'create-failed', sessionId: 's' });
  assert.equal(failed.creating, false);
  assert.equal(failed.nameError, 'method-add-failed');
  assert.equal(failed.createName, ' Flock ');
  const created = send(send(failed, { type: 'create-requested', sessionId: 's' }), {
    type: 'library-method-created', sessionId: 's', method: { id: 'flock', name: 'Flock', pricing: 'product', amount: '' },
  });
  assert.equal(created.creating, false);
  assert.deepEqual(created.draft.methodIds, ['flock']);
  assert.deepEqual(created.screen, { kind: 'prices', methodId: 'flock' });
  assert.deepEqual(created.methods.map((method) => method.id), ['print', 'flock']);
  // A late result for a create that was not requested is ignored.
  assert.equal(send(failed, { type: 'library-method-created', sessionId: 's', method: { id: 'x', name: 'X', pricing: 'product', amount: '' } }), failed);
});
