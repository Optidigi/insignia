import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeNative, reserveNative, settleNative } from './native-actions.mjs';

test('native release and two-scope consent are durable one-use operations with dependency and ambiguity stops', () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5010-native-'));
  const binding = { source: 'synthetic', tree: 'synthetic-tree', modules: {} };
  try {
    initializeNative(directory, binding);
    assert.throws(() => initializeNative(directory, binding));
    assert.throws(() => reserveNative(directory, binding, 'request'));
    reserveNative(directory, binding, 'release');
    assert.throws(() => reserveNative(directory, binding, 'release'));
    assert.throws(() => reserveNative(directory, binding, 'request'));
    assert.throws(() => settleNative(directory, { ...binding, source: 'changed' }, 'release', 'VERIFIED', {}));
    settleNative(directory, binding, 'release', 'VERIFIED', { version: 'synthetic-only' });
    reserveNative(directory, binding, 'request');
    settleNative(directory, binding, 'request', 'VERIFIED', {
      newlyRequested: ['read_publications', 'read_product_listings'],
    });
    reserveNative(directory, binding, 'approval');
    settleNative(directory, binding, 'approval', 'UNKNOWN', { reason: 'synthetic response loss' });
    assert.throws(() => reserveNative(directory, binding, 'approval'));
    const state = JSON.parse(readFileSync(join(directory, 'native-actions.json')));
    assert.equal(state.state, 'STOPPED');
    assert.deepEqual(state.counts, { release: 1, request: 1, approval: 1 });
    assert.equal(state.events.length, 6);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native successful sequence closes after exactly one release/request/approval and rejects reset reservation history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5010-native-success-'));
  const binding = { source: 'synthetic', modules: {} };
  try {
    initializeNative(directory, binding);
    reserveNative(directory, binding, 'release');
    settleNative(directory, binding, 'release', 'VERIFIED', {});
    const path = join(directory, 'native-actions.json');
    const valid = readFileSync(path);
    const bad = JSON.parse(valid);
    bad.counts.release = 0;
    writeFileSync(path, JSON.stringify(bad));
    assert.throws(() => reserveNative(directory, binding, 'release'));
    writeFileSync(path, valid);
    for (const action of ['request', 'approval']) {
      reserveNative(directory, binding, action);
      settleNative(directory, binding, action, 'VERIFIED', {});
    }
    assert.equal(JSON.parse(readFileSync(path)).state, 'CLOSED_VERIFIED');
    assert.throws(() => reserveNative(directory, binding, 'release'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
