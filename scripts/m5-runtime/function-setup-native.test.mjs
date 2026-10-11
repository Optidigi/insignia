import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import candidateBaseline from '../../deployment/m5-runtime/native-function-module-baseline.json' with { type: 'json' };
import previousBaseline from '../../deployment/m5-runtime/native-module-baseline.json' with { type: 'json' };
import {
  functionSetupBuildHash,
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

test('observed write-scope candidate qualifies while the historical read-only baseline stays denied', () => {
  assert.doesNotThrow(() => qualifyFunctionSetupBaseline(candidateBaseline));
  assert.throws(() => qualifyFunctionSetupBaseline(previousBaseline), /function_write_release_not_bound/);
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

test('compiled transitive domain and visualizer changes refuse frozen executable admission', () => {
  const gate = {
    operatorCommit: 'a'.repeat(40),
    operatorTree: 'b'.repeat(40),
    operatorBuildSha256: functionSetupBuildHash(),
  };
  for (const name of ['domain', 'visualizer']) {
    const path = new URL(`../../packages/${name}/dist/index.js`, import.meta.url);
    const original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from('\n// changed compiled dependency\n')]));
      assert.throws(
        () => qualifyFunctionSetupExecutable(gate, { ...gate, operatorBuildSha256: functionSetupBuildHash() }),
        /function_setup_executable_mismatch/,
      );
    } finally {
      writeFileSync(path, original);
    }
  }
  assert.equal(functionSetupBuildHash(), gate.operatorBuildSha256);
});

test('consumer workspace redirection refuses executable admission before credentials', () => {
  const link = fileURLToPath(new URL('../../apps/web/node_modules/@insignia/database', import.meta.url));
  const original = readlinkSync(link),
    foreign = mkdtempSync(join(tmpdir(), 'insignia-foreign-module-'));
  writeFileSync(join(foreign, 'package.json'), JSON.stringify({ name: '@insignia/database', exports: './index.js' }));
  writeFileSync(join(foreign, 'index.js'), 'export const unreviewed = true;');
  try {
    unlinkSync(link);
    symlinkSync(foreign, link);
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { functionSetupBuildHash } from './scripts/m5-runtime/function-setup-native.mjs'; functionSetupBuildHash();",
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /function_setup_module_resolution_mismatch/);
  } finally {
    unlinkSync(link);
    symlinkSync(original, link);
    rmSync(foreign, { recursive: true });
  }
});
