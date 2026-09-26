#!/usr/bin/env node
// Replay the exact retained CLI preview bundle assets, not a subsequent cargo build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionInfo, runFunction } from '../../m0-005/node_modules/@shopify/shopify-function-test-helpers/dist/wasm-testing-helpers.js';

const spike = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];
for (const target of ['transform', 'validation']) {
  const info = await getFunctionInfo(path.join(spike, 'extensions', target));
  const name = target === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
  const execution = info.targeting[name];
  assert.ok(execution, `target unavailable: ${name}`);
  const wasm = path.join(spike, 'evidence', `live-preview-${target}.wasm`);
  const wasmSha256 = createHash('sha256').update(readFileSync(wasm)).digest('hex');
  for (const [caseName, signedBuckets, ordinaryLines] of [
    ['valid', 2, 0],
    ['10-signed-190-ordinary', 10, 190],
    ['32-signed-0-ordinary', 32, 0],
    ['64-signed-0-ordinary', 64, 0],
  ]) {
    const input = JSON.parse(readFileSync(path.join(spike, 'extensions/fixtures', `${target}-${caseName}.json`)));
    const actual = await runFunction({target: name, export: execution.export, input},
      info.functionRunnerPath, wasm, execution.inputQueryPath, info.schemaPath);
    assert.equal(actual.error, null, `${target}/${caseName}: ${actual.error}`);
    const output = actual.result.output;
    const operations = output.operations;
    assert.ok(Array.isArray(operations), `${target}/${caseName}: no operations array`);
    if (target === 'transform') {
      assert.equal(operations.length, signedBuckets <= 10 ? signedBuckets : 0,
        `${target}/${caseName}: unexpected application or partial expansion`);
      if (signedBuckets <= 10) {
        for (const operation of operations) {
          assert.ok(operation.lineExpand?.expandedCartItems?.length === 1,
            `${target}/${caseName}: malformed expansion`);
        }
      }
    } else {
      assert.equal(operations.length, signedBuckets <= 10 ? 0 : 1,
        `${target}/${caseName}: unexpected validation result`);
      if (signedBuckets > 10) assert.equal(operations[0].validationAdd.errors.length, 1);
    }
    rows.push({target, caseName, signedBuckets, ordinaryLines, wasmSha256,
      inputSha256: createHash('sha256').update(readFileSync(path.join(spike, 'extensions/fixtures', `${target}-${caseName}.json`))).digest('hex'),
      outputSha256: createHash('sha256').update(JSON.stringify(output)).digest('hex'),
      operationCount: operations.length,
      instructions: actual.metadata.instructionCount,
      memoryUsageKiB: actual.metadata.memoryUsageKiB,
      outputBytes: Buffer.byteLength(JSON.stringify(output))});
  }
}
console.log(JSON.stringify({provenance: 'Off-store replay of retained Shopify CLI preview bundle assets with pinned Shopify function runner; synthetic fixtures only', rows}, null, 2));
