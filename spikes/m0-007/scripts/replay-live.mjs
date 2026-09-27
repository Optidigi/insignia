#!/usr/bin/env node
// Re-execute retained Shopify Function inputs against the exact dev-preview bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionInfo, runFunction } from '../../m0-005/node_modules/@shopify/shopify-function-test-helpers/dist/wasm-testing-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const previewIdentity = JSON.parse(readFileSync(path.join(root, 'evidence/preview-bundle-identity.json')));
const cases = [
  'policy-missing-checkout', 'policy-malformed-checkout', 'policy-stale-checkout',
  'optional-plain-checkout', 'required-unsigned-checkout',
  'expired-checkout', 'future-checkout', 'current-checkout',
  'cart-repair-optional', 'discounted-checkout',
];
const rows = [];
for (const target of ['transform', 'validation']) {
  const info = await getFunctionInfo(path.join(repo, 'spikes/m0-006/extensions', target));
  const name = target === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
  const execution = info.targeting[name];
  assert.ok(execution, `${target} targeting unavailable`);
  const wasmPath = path.join(root, `evidence/live-preview-${target}.wasm`);
  const wasm = readFileSync(wasmPath);
  const identity = previewIdentity.functions.find(f => f.target === target);
  assert.equal(sha(wasm), identity.wasmSha256, `${target} preview-byte identity`);
  for (const caseName of cases) {
    const receiptPath = path.join(root, 'evidence', `${caseName}-${target}.json`);
    const receiptBytes = readFileSync(receiptPath);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.target, name);
    assert.equal(receipt.status, 'success');
    const replay = await runFunction({target: name, export: execution.export, input: receipt.input},
      info.functionRunnerPath, wasmPath, execution.inputQueryPath, info.schemaPath);
    assert.equal(replay.error, null, `${caseName}/${target}: ${replay.error}`);
    assert.deepEqual(replay.result.output, receipt.output, `${caseName}/${target} output`);
    rows.push({caseName, target, provenance: 'retained Shopify CLI Function log',
      receiptSha256: sha(receiptBytes), rawEventSha256: receipt.sourceSha256,
      previewWasmSha256: identity.wasmSha256, previewWasmBytes: wasm.length,
      inputSha256: sha(JSON.stringify(receipt.input)),
      outputSha256: sha(JSON.stringify(receipt.output)),
      operationCount: receipt.output.operations.length,
      liveFuelConsumed: receipt.fuelConsumed,
      replayInstructions: replay.metadata?.instructionCount ?? null,
      replayMemoryKiB: replay.metadata?.memoryUsageKiB ?? null,
      exactOutputMatch: true});
  }
}
console.log(JSON.stringify({source: 'exact retained dev-preview Wasm and actual Shopify Function inputs', rows}, null, 2));
