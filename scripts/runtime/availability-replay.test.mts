import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { object } from './validation.mts';

test('recorded Shopify restore responses replay as RESTORED offline without compensation', () => {
  const replay = object(
    JSON.parse(
      execFileSync(process.execPath, [new URL('./availability-replay.mts', import.meta.url).pathname], {
        encoding: 'utf8',
      }),
    ),
  );
  assert.equal(replay.kind, 'RESTORED');
  assert.equal(replay.exactSemanticReadbackEqualToBefore, true);
  assert.deepEqual(replay.effectivePublicationIds, ['gid://shopify/Publication/339456917787']);
  assert.equal(replay.externalRequests, 0);
  assert.equal(replay.ambientFetchAttempts, 0);
  assert.equal(replay.compensationAttempts, 0);
  assert.equal(replay.memoryResponseInvocations, 7);
  assert.equal(replay.originalAckRetainedExactly, true);
  assert.equal(replay.fixtureBytesUnchanged, true);
  assert.equal(replay.canonicalManifestSha256, '0eb6c0006ad414d9b327f87581b3f3f35fef0ac09c4f67d096f9aa1102d544f2');
  assert.equal(replay.historicalLiveOutcome, 'STOPPED');
  assert.equal(replay.historicalRestoreKind, 'CONFLICT');
});
