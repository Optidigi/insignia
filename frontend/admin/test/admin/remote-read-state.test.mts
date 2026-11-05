import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialRemoteReadState, remoteReadReducer as step } from '../../src/shared/remote-read-state.ts';

test('a denied or missing resource removes private data and cannot be revived by an earlier read', () => {
  const loaded = step(step(initialRemoteReadState<string>(), { type: 'read-started', request: 1 }), {
    type: 'read-succeeded',
    request: 1,
    value: 'private',
  });
  const refreshing = step(loaded, { type: 'read-started', request: 2 });
  assert.equal(refreshing.value, 'private');
  const denied = step(refreshing, { type: 'read-failed', request: 2, status: 403, message: 'No access' });
  assert.equal(denied.value, null);
  assert.equal(step(denied, { type: 'read-succeeded', request: 1, value: 'stale' }), denied);
  const retry = step(denied, { type: 'read-started', request: 3 });
  const missing = step(retry, { type: 'read-failed', request: 3, status: 404, message: 'Not found' });
  assert.equal(missing.phase, 'missing');
  assert.equal(missing.value, null);
});

test('a confirmed artwork change supersedes reads while transient refresh failure preserves the observation', () => {
  const reading = step(initialRemoteReadState<string>(), { type: 'read-started', request: 1 });
  const changed = step(reading, { type: 'observation-replaced', request: 2, value: 'replacement' });
  assert.equal(step(changed, { type: 'read-succeeded', request: 1, value: 'old attachment' }), changed);
  const refreshed = step(changed, { type: 'read-started', request: 3 });
  const failed = step(refreshed, { type: 'read-failed', request: 3, status: 503, message: 'Try again' });
  assert.equal(failed.value, 'replacement');
  assert.equal(failed.phase, 'failed');
  assert.equal(step(failed, { type: 'context-reset', request: 4 }).value, null);
});
