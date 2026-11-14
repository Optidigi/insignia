import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialPlacementWorkspaceState,
  placementWorkspaceReducer,
} from '../../examples/admin/support/placement-workflow-state.mts';

const oldImage = 'https://cdn.example/front.jpg?v=1';
const newImage = 'https://cdn.example/front.jpg?v=2';
const started = placementWorkspaceReducer(initialPlacementWorkspaceState, {
  type: 'measurement-started',
  viewId: 'front',
  placementId: null,
  imageUrl: oldImage,
  line: { a: { x: 0.1, y: 0.1 }, b: { x: 0.6, y: 0.1 } },
  distance: '40',
});

test('a commit for another image than the measured one is fenced and the measurement stays open', () => {
  assert.equal(
    placementWorkspaceReducer(started, { type: 'measurement-committed', viewId: 'front', imageUrl: newImage }),
    started,
  );
});

test('a URL mismatch restarts measuring on the current image without the old line, then reports the error', () => {
  const restarted = placementWorkspaceReducer(started, {
    type: 'measurement-started',
    viewId: 'front',
    placementId: null,
    imageUrl: newImage,
    line: null,
    distance: '',
  });
  const reported = placementWorkspaceReducer(restarted, { type: 'measurement-error', reason: 'measurement-invalid' });
  assert.equal(reported.mode.kind, 'measuring');
  if (reported.mode.kind !== 'measuring') return;
  assert.equal(reported.mode.imageUrl, newImage);
  assert.equal(reported.mode.line, null);
  assert.equal(reported.mode.error, 'measurement-invalid');
  // The old image can no longer commit; the new one is the measured identity.
  assert.equal(
    placementWorkspaceReducer(reported, { type: 'measurement-committed', viewId: 'front', imageUrl: oldImage }),
    reported,
  );
});
