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
