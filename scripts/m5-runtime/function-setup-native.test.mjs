import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseFunctionSetupPacket,
  qualifyFunctionSetupBaseline,
  qualifyFunctionSetupExecutable,
} from './function-setup-native.mjs';

test('operator admission distinguishes and verifies the exact operator commit/tree/build', () => {
  const actual = { operatorCommit: 'a'.repeat(40), operatorTree: 'b'.repeat(40), operatorBuildSha256: 'c'.repeat(64) };
  assert.deepEqual(qualifyFunctionSetupExecutable(actual, actual), actual);
  for (const key of Object.keys(actual))
    assert.throws(() => qualifyFunctionSetupExecutable({ ...actual, [key]: 'd'.repeat(actual[key].length) }, actual));
});

test('current read-only Function baseline refuses credentials and native setup before release binding', () => {
  assert.throws(qualifyFunctionSetupBaseline, /function_write_release_not_bound/);
  const process = spawnSync(
    globalThis.process.execPath,
    [fileURLToPath(new URL('./function-setup-native.mjs', import.meta.url))],
    { input: 'SYNTHETIC_PRIVATE_INPUT', encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(process.status, 1);
  assert.equal(process.stderr, '');
  assert.deepEqual(JSON.parse(process.stdout), {
    classification: 'FUNCTION_SETUP_STOPPED',
    receiptDurable: false,
    retryAuthorized: false,
    publicationReady: false,
  });
});
test('private packet rejects duplicate fields and remote database destinations', () => {
  const packet = {
    clientSecret: 'SYNTHETIC_SECRET',
    idToken: 'SYNTHETIC_ID_TOKEN',
    databaseUrl: 'postgres://insignia_runtime:SYNTHETIC_PASSWORD@127.0.0.1:5432/synthetic?sslmode=disable',
  };
  assert.deepEqual(parseFunctionSetupPacket(JSON.stringify(packet)), packet);
  assert.throws(() =>
    parseFunctionSetupPacket(JSON.stringify(packet).replace('{', '{"clientSecret":"SYNTHETIC_OTHER",')),
  );
  assert.throws(() =>
    parseFunctionSetupPacket(
      JSON.stringify({ ...packet, databaseUrl: packet.databaseUrl.replace('127.0.0.1', 'example.com') }),
    ),
  );
});
