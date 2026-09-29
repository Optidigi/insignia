#!/usr/bin/env node
// Artifact-bound M0-014R replay. This is local Function execution, not checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prior = path.resolve(root, '../m0-013');
const local = path.join(root, 'evidence/m0-014r/local');
const record = process.argv.includes('--record');
const runner = process.env.M0_014_RUNNER;
assert.ok(runner, 'M0_014_RUNNER must point to the pinned Shopify Function runner');
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => readFileSync(file);
const json = file => JSON.parse(read(file));
const clone = value => structuredClone(value);
const historical = json(path.join(prior, 'evidence/measurements/candidate/matrix.json'));
const wasm = target => path.join(root, 'artifacts/m0-014r', `${target}.wasm`);
const query = target => path.join(root, 'rust', target, 'src', target === 'transform'
  ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql');
const schema = target => path.join(root, 'rust', target, 'schema.graphql');
const sourcePaths = [
  'rust/capacity.rs', 'rust/authorization/src/lib.rs',
  'rust/authorization/src/whole.rs', 'rust/policy/projection.rs',
  'rust/transform/src/main.rs', 'rust/validation/src/main.rs',
  'rust/transform/src/cart_transform_run.graphql',
  'rust/validation/src/cart_validations_generate_run.graphql',
  'rust/transform/schema.graphql', 'rust/validation/schema.graphql',
  'rust/transform/shopify.extension.toml', 'rust/validation/shopify.extension.toml',
  'scripts/build-current-wasm.sh',
];
const rows = [];

function run(target, name, input, expected, binary = wasm(target)) {
  const bytes = Buffer.from(JSON.stringify(input));
  const result = spawnSync(runner, ['-f', binary, '--export', target === 'transform'
    ? 'cart_transform_run' : 'cart_validations_generate_run', '--query-path', query(target),
    '--schema-path', schema(target), '--json'],
  { input: bytes, encoding: 'utf8', maxBuffer: 5_000_000 });
  assert.equal(result.status, 0, `${target}/${name}: runner ${result.stderr}`);
  const actual = JSON.parse(result.stdout);
  if (expected === 'accept') assert.deepEqual(actual.output, { operations: [] }, `${target}/${name}`);
  else if (expected === 'reject') {
    assert.ok(actual.output?.operations?.some(op => op.validationAdd?.errors?.length),
      `${target}/${name} must fail closed`);
  } else if (typeof expected === 'function') expected(actual.output);
  else assert.deepEqual(actual.output, expected, `${target}/${name} output changed`);
  const output = Buffer.from(JSON.stringify(actual.output));
  if (['valid-10-mixed-200', 'valid-32-mixed-200',
    'zero-based-10-mixed-200', 'zero-based-32-mixed-200'].includes(name)) {
    assert.ok(actual.instructions <= 8_800_000, `${target}/${name} instruction ceiling`);
    assert.ok(output.length <= 16_000, `${target}/${name} output ceiling`);
  }
  rows.push({ target, name, binarySha256: sha(read(binary)), inputSha256: sha(bytes),
    outputSha256: sha(output), inputBytes: bytes.length, outputBytes: output.length,
    instructions: actual.instructions, linearMemoryKiB: actual.memory_usage });
  return actual;
}

for (const target of ['transform', 'validation']) {
  for (const row of historical.rows.filter(row => row.target === target)) {
    const prefix = path.join(prior, 'evidence/measurements/candidate', `${target}-${row.caseName}`);
    const input = json(`${prefix}.input.json`);
    assert.equal(sha(read(`${prefix}.input.json`)), row.inputSha256);
    run(target, row.caseName, input, json(`${prefix}.expected.json`));
  }
}
assert.equal(rows.length, 88, 'historical candidate matrix must stay complete');

const captured = json(path.join(local, 'captured-validation.json'));
const provenance = json(path.join(local, 'captured-validation-provenance.json'));
assert.equal(sha(read(path.join(local, 'captured-validation.json'))),
  provenance.fixtures.find(item => item.path === 'captured-validation.json').sha256);
assert.equal(provenance.source.reportedBuyerJourney, 'CART_INTERACTION');
assert.deepEqual(captured.cart.lines.map(line => line.id),
  ['gid://shopify/CartLine/0', 'gid://shopify/CartLine/1', 'gid://shopify/CartLine/2']);

// The captured step was not enforcement. Both checkout steps are derived by
// changing only buyerJourney.step; quote/member/config values remain exact.
for (const step of ['CHECKOUT_INTERACTION', 'CHECKOUT_COMPLETION']) {
  const name = `captured-${step.toLowerCase().replaceAll('_', '-')}`;
  const input = json(path.join(local, `${name.replace('captured-', 'captured-validation-')}.json`));
  const expected = clone(captured);
  expected.buyerJourney.step = step;
  assert.deepEqual(input, expected, `${name}: only journey may differ from capture`);
  run('validation', name, input, 'accept');
}

const completion = clone(captured);
completion.buyerJourney.step = 'CHECKOUT_COMPLETION';
const old = path.join(root, 'artifacts/validation.wasm');
assert.equal(sha(read(old)), '93148de17900a68732712ce687393ec920f903e55649115f23b9aa3b667a4ebd');
run('validation', 'historical-zero-rejection', completion, 'reject', old);

const positives = [
  ['reordered-target-local-lines', input => input.cart.lines.reverse()],
  ['positive-numeric-ids', input => input.cart.lines.forEach((line, i) => {
    line.id = `gid://shopify/CartLine/${i + 3}`;
  })],
  ['uuid-ids', input => input.cart.lines.forEach((line, i) => {
    line.id = `gid://shopify/CartLine/00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  })],
];
for (const [name, mutate] of positives) {
  const input = clone(completion); mutate(input);
  run('validation', name, input, 'accept');
}

const negatives = [
  ['wrong-price', input => { input.cart.lines[0].cost.subtotalAmount.amount = '30.35'; }],
  ['wrong-quantity', input => { input.cart.lines[0].quantity = 2; }],
  ['wrong-variant', input => {
    input.cart.lines[0].merchandise.id = 'gid://shopify/ProductVariant/54061591265563';
  }],
  ['missing-member', input => { input.cart.lines[0].member = null; }],
  ['duplicate-member', input => { input.cart.lines[2].member = clone(input.cart.lines[0].member); }],
  ['invalid-line-id', input => { input.cart.lines[0].id = 'gid://shopify/CartLine/00'; }],
  ['wrong-market', input => { input.localization.market.id = 'gid://shopify/Market/999'; }],
  ['bad-public-key-context', input => { input.shop.publicConfig.value = 'invalid'; }],
];
for (const [name, mutate] of negatives) {
  const input = clone(completion); mutate(input);
  run('validation', name, input, 'reject');
}

for (const [short, oldName, operations] of [
  ['10', 'valid-10-mixed-200', 10], ['32', 'valid-32-mixed-200', 32],
]) {
  for (const target of ['transform', 'validation']) {
    const input = json(path.join(prior, 'evidence/measurements/candidate',
      `${target}-${oldName}.input.json`));
    assert.equal(input.cart.lines.length, 200);
    input.cart.lines[0].id = 'gid://shopify/CartLine/0';
    run(target, `zero-based-${short}-mixed-200`, input, target === 'validation'
      ? 'accept' : output => {
        assert.equal(output.operations.length, operations);
        assert.equal(output.operations[0].lineExpand.cartLineId, 'gid://shopify/CartLine/0');
      });
  }
}

const report = {
  classification: 'PINNED_LOCAL_FUNCTION_REPLAY; NOT_LIVE_CHECKOUT',
  runnerSha256: sha(read(runner)),
  trampolineSha256: sha(read(path.join(path.dirname(runner),
    'shopify-function-trampoline-2.0.1'))),
  sourceSha256: Object.fromEntries(sourcePaths.map(p => [p, sha(read(path.join(root, p)))])),
  artifacts: Object.fromEntries(['transform', 'validation'].map(target => [target, {
    rawSha256: sha(read(path.join(root, 'artifacts/m0-014r', `${target}.raw.wasm`))),
    finalSha256: sha(read(wasm(target))),
    rawBytes: read(path.join(root, 'artifacts/m0-014r', `${target}.raw.wasm`)).length,
    finalBytes: read(wasm(target)).length,
  }])),
  stackTelemetry: 'UNKNOWN: runner does not expose stack high-water mark',
  rows,
};
const reportPath = path.join(local, 'current-artifact-matrix.json');
if (record) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
else assert.deepEqual(report, json(reportPath), 'current replay differs from retained artifact-bound matrix');
console.log(JSON.stringify({ status: 'PASS', mode: record ? 'record' : 'verify',
  rows: rows.length, artifactSha256: report.artifacts,
  capturedSourceEventSha256: provenance.source.rawSourceEventSha256 }));
