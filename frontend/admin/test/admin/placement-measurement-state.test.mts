import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialPlacementWorkspaceState,
  placementWorkspaceReducer,
} from '../../examples/admin/support/placement-workflow-state.mts';

const started = placementWorkspaceReducer(initialPlacementWorkspaceState, {
  type: 'measurement-started',
  viewId: 'front',
  placementId: null,
  imageUrl: 'https://cdn.example/front.jpg?v=1',
  line: { a: { x: 0.1, y: 0.1 }, b: { x: 0.6, y: 0.1 } },
  distance: '40',
});

test('a re-issued image URL for the measured view keeps the line and lets the measurement commit', () => {
  const refreshed = placementWorkspaceReducer(started, {
    type: 'measurement-image-reissued',
    viewId: 'front',
    imageUrl: 'https://cdn.example/front.jpg?v=2',
  });
  assert.equal(refreshed.mode.kind, 'measuring');
  assert.equal(refreshed.mode.kind === 'measuring' && refreshed.mode.imageUrl, 'https://cdn.example/front.jpg?v=2');
  assert.deepEqual(refreshed.mode.kind === 'measuring' && refreshed.mode.line, {
    a: { x: 0.1, y: 0.1 },
    b: { x: 0.6, y: 0.1 },
  });
  const committed = placementWorkspaceReducer(refreshed, {
    type: 'measurement-committed',
    viewId: 'front',
    imageUrl: 'https://cdn.example/front.jpg?v=2',
  });
  assert.deepEqual(committed, initialPlacementWorkspaceState);
});

test('a re-issued image URL for a different view leaves the measurement unchanged', () => {
  assert.equal(
    placementWorkspaceReducer(started, {
      type: 'measurement-image-reissued',
      viewId: 'back',
      imageUrl: 'https://cdn.example/back.jpg',
    }),
    started,
  );
});

test('a commit for a stale image URL is still fenced', () => {
  assert.equal(
    placementWorkspaceReducer(started, {
      type: 'measurement-committed',
      viewId: 'front',
      imageUrl: 'https://cdn.example/front.jpg?v=2',
    }),
    started,
  );
});
