import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closedPlacementPhotoPicker,
  confirmPlacementPhotoPicker,
  placementPhotoPickerReducer,
} from '../../examples/admin/support/placement-photo-assignment.mts';

const opened = placementPhotoPickerReducer(closedPlacementPhotoPicker, {
  type: 'opened',
  sessionId: 's1',
  intent: 'assign-variant-groups',
  productId: 'p1',
  viewId: 'front',
  targetRevision: 3,
  groupKeys: ['red'],
});
const ready = placementPhotoPickerReducer(
  placementPhotoPickerReducer(opened, {
    type: 'selection-changed',
    sessionId: 's1',
    pickerRevision: 0,
    imageIds: ['i1'],
  }),
  { type: 'selection-ready', sessionId: 's1', pickerRevision: 0, imageIds: ['i1'], ready: true },
);
const context = { sessionId: 's1', pickerRevision: 0, productId: 'p1', viewId: 'front', targetRevision: 3 };

test('a refused colour-photo assignment keeps the picker on the same colour and selection for a retry', () => {
  const refused = placementPhotoPickerReducer(ready, {
    type: 'assignment-refused',
    sessionId: 's1',
    pickerRevision: 0,
  });
  assert.equal(refused.assignmentRefused, true);
  assert.deepEqual(refused.groupKeys, ['red']);
  assert.equal(refused.pickerRevision, 0);
  assert.deepEqual(confirmPlacementPhotoPicker(refused, context), {
    kind: 'ready',
    imageIds: ['i1'],
    groupKeys: ['red'],
    targetViewId: 'front',
  });
  // A late refusal from an earlier picker revision never marks the current colour.
  assert.equal(
    placementPhotoPickerReducer(ready, { type: 'assignment-refused', sessionId: 's1', pickerRevision: 1 }),
    ready,
  );
});

test('an applied assignment advancing to the next colour clears an earlier refusal', () => {
  const refused = placementPhotoPickerReducer(ready, {
    type: 'assignment-refused',
    sessionId: 's1',
    pickerRevision: 0,
  });
  const advanced = placementPhotoPickerReducer(refused, {
    type: 'assignment-advanced',
    sessionId: 's1',
    nextGroupKey: 'blue',
    targetRevision: 4,
  });
  assert.equal(advanced.assignmentRefused, false);
  assert.deepEqual(advanced.groupKeys, ['blue']);
  assert.equal(ready.assignmentRefused, false);
});
