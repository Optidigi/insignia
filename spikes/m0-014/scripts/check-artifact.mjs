#!/usr/bin/env node
// Replays retained synthetic inputs against the exact pinned CI executables.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prior = path.resolve(root, '../m0-013');
const runner = process.env.M0_014_RUNNER;
assert.ok(runner, 'pinned Shopify Function runner path is required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(prior,
  'evidence/measurements/candidate/matrix.json')));
const namedCapacityCases = new Set(['valid-10-mixed-200', 'valid-32-mixed-200']);
const expectedWasm = {
  transform: 'cebca846a17013a42dc590c18069ef5d9f0432452eb702d29bc46bbc1985590b',
  validation: '93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd',
};
const rows = [];
for (const target of ['transform', 'validation']) {
  const wasm = path.join(root, 'artifacts', `${target}.wasm`);
  assert.equal(sha(readFileSync(wasm)), expectedWasm[target]);
  const query = path.join(root, 'rust', target, 'src', target === 'transform'
    ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql');
  const schema = path.join(root, 'rust', target, 'schema.graphql');
  for (const row of manifest.rows.filter(row => row.target === target)) {
    const name = row.caseName;
    const prefix = path.join(prior, 'evidence/measurements/candidate', `${target}-${name}`);
    const input = readFileSync(`${prefix}.input.json`);
    const expected = readFileSync(`${prefix}.expected.json`);
    const run = spawnSync(runner, ['-f', wasm, '--export', target === 'transform'
      ? 'cart_transform_run' : 'cart_validations_generate_run', '--query-path', query,
      '--schema-path', schema, '--json'], { input, encoding: 'utf8', maxBuffer: 5_000_000 });
    assert.equal(run.status, 0, `${target}/${name}: ${run.stderr}`);
    const actual = JSON.parse(run.stdout);
    const output = Buffer.from(JSON.stringify(actual.output));
    assert.equal(sha(output), sha(expected), `${target}/${name} output mismatch`);
    if (namedCapacityCases.has(name)) {
      assert.ok(actual.instructions <= 8_800_000, `${target}/${name} instruction ceiling`);
      assert.ok(output.length <= 16_000, `${target}/${name} output ceiling`);
    }
    rows.push({ target, name, inputBytes: input.length, outputBytes: output.length,
      instructions: actual.instructions, linearMemoryKiB: actual.memory_usage,
      wasmSha256: expectedWasm[target], inputSha256: sha(input), outputSha256: sha(output) });
  }
}
assert.equal(rows.length, 88);
const report = { status: 'PASS', runnerSha256: sha(readFileSync(runner)), rows };
console.log(JSON.stringify({ status: report.status, runnerSha256: report.runnerSha256,
  verifiedRows: rows.length, capacityRows: rows.filter(row => namedCapacityCases.has(row.name)) }));
