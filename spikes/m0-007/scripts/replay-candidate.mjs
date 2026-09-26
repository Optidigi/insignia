#!/usr/bin/env node
// Deterministic off-store execution of the changed M0-006 adapter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getFunctionInfo, loadInputQuery, loadSchema, runFunction, validateTestAssets,
} from '../../m0-005/node_modules/@shopify/shopify-function-test-helpers/dist/wasm-testing-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
const commonCases = [
  {name: 'valid', signed: 2, operations: {transform: 2, validation: 0}},
  {name: '10-signed-190-ordinary', signed: 10, operations: {transform: 10, validation: 0}},
  {name: '32-signed-0-ordinary', signed: 32, operations: {transform: 0, validation: 1}},
  {name: '64-signed-0-ordinary', signed: 64, operations: {transform: 0, validation: 1}},
];
const mixedCases = [
  {name: 'mixed-damaged', signed: 10, operations: {validation: 1}},
  {name: 'mixed-repaired', signed: 10, operations: {validation: 0}},
  {name: 'mixed-plain', signed: 0, operations: {validation: 0}},
];
for (const target of ['transform', 'validation']) {
  const dir = path.join(repo, 'spikes/m0-006/extensions', target);
  const info = await getFunctionInfo(dir);
  const name = target === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
  const execution = info.targeting[name];
  assert.ok(execution, `${name} unavailable`);
  const schema = await loadSchema(info.schemaPath);
  const query = await loadInputQuery(execution.inputQueryPath);
  const wasm = readFileSync(info.wasmPath);
  for (const caseSpec of target === 'validation' ? [...commonCases, ...mixedCases] : commonCases) {
    const caseName = caseSpec.name;
    const fixturePath = path.join(root, 'fixtures', `${target}-${caseName}.json`);
    const fixtureBytes = readFileSync(fixturePath);
    const input = JSON.parse(fixtureBytes);
    const validation = await validateTestAssets({schema, inputQueryAST: query,
      fixture: {target: name, export: execution.export, input}});
    assert.deepEqual(validation.inputQuery.errors, [], `${target}/${caseName} query`);
    assert.deepEqual(validation.inputFixture.errors, [], `${target}/${caseName} fixture`);
    const actual = await runFunction({target: name, export: execution.export, input},
      info.functionRunnerPath, info.wasmPath, execution.inputQueryPath, info.schemaPath);
    assert.equal(actual.error, null, `${target}/${caseName}: ${actual.error}`);
    const output = actual.result.output;
    assert.ok(Array.isArray(output.operations));
    const signedCount = caseSpec.signed;
    const expectedCount = caseSpec.operations[target];
    assert.equal(output.operations.length, expectedCount, `${target}/${caseName} operation count`);
    rows.push({target, caseName, provenance: 'schema-valid synthetic Function input',
      signedBuckets: signedCount, ordinaryLines: input.cart.lines.length - signedCount,
      queryBytes: statSync(execution.inputQueryPath).size,
      binaryBytes: wasm.length, wasmSha256: sha(wasm),
      inputBytes: Buffer.byteLength(JSON.stringify(input)),
      outputBytes: Buffer.byteLength(JSON.stringify(output)),
      inputSha256: sha(fixtureBytes), outputSha256: sha(JSON.stringify(output)),
      operationCount: output.operations.length,
      instructions: actual.metadata?.instructionCount ?? null,
      memoryUsageKiB: actual.metadata?.memoryUsageKiB ?? null,
      stackPeak: null, numericQueryCost: null});
  }
}
console.log(JSON.stringify({source: 'current M0-006 adapter with M0-007 policy delta', rows}, null, 2));
