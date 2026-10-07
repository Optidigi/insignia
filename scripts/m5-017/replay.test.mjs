import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('sealed live restore responses replay as RESTORED in a network-denied fresh process without compensation', () => {
  const replay = JSON.parse(
    execFileSync(process.execPath, [new URL('./replay.mjs', import.meta.url).pathname], { encoding: 'utf8' }),
  );
  assert.equal(replay.kind, 'RESTORED');
  assert.equal(replay.exactSemanticReadbackEqualToBefore, true);
  assert.deepEqual(replay.effectivePublicationIds, ['gid://shopify/Publication/339456917787']);
  assert.equal(replay.externalRequests, 0);
  assert.equal(replay.ambientFetchAttempts, 0);
  assert.equal(replay.compensationAttempts, 0);
  assert.equal(replay.memoryResponseInvocations, 7);
  assert.equal(replay.originalAckRetainedExactly, true);
  assert.equal(replay.canonicalBytesUnchanged, true);
  assert.equal(replay.historicalLiveOutcome, 'STOPPED');
  assert.equal(replay.historicalRestoreKind, 'CONFLICT');
});
