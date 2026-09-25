import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getFunctionInfo, loadInputQuery, loadSchema, runFunction, validateTestAssets,
} from '@shopify/shopify-function-test-helpers';
import { issueToken, privateKeyFromSeed } from '../ts/authorization.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const spike = path.resolve(here, '..');
const extensionRoot = process.env.M0_004_EXTENSION_ROOT || path.join(spike, 'extensions');
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const signingKey = privateKeyFromSeed(seed); // RFC 8032 test seed, never a merchant key.
const fixtureFor = (target) => JSON.parse(readFileSync(path.join(spike, 'fixtures', 'targets', `${target}-valid.json`), 'utf8'));
const LIMIT = {
  binaryBytes: 256_000, linearMemoryBytes: 10_000_000, stackBytes: 512_000,
  instructions: 11_000_000, inputBytes: 128_000, outputBytes: 20_000,
  queryBytes: 3_000, queryCost: 30,
};

function signedInput(target, n, ordinaryCount = 0, quantityPerBucket = 1) {
  assert.ok(Number.isInteger(n) && n > 0 && n <= 64);
  assert.ok(Number.isInteger(quantityPerBucket) && quantityPerBucket > 0 && quantityPerBucket <= 2000);
  const input = fixtureFor(target);
  const source = input.cart.lines[0];
  const base = {
    keyId: 7, generationHex: '11'.repeat(16), epoch: 4,
    quoteHex: '22'.repeat(16), setHex: '33'.repeat(16), lineIndex: 0,
    lineCount: n, variantId: '9007199254740993', quantity: quantityPerBucket, unitMinor: '3000',
    currency: 'EUR', exponent: 2, country: 'DE', marketId: '42',
    validThroughDay: 20802, totalQuantity: n * quantityPerBucket,
    totalMinor: String(n * quantityPerBucket * 3000),
  };
  input.cart.lines = Array.from({ length: n }, (_, i) => {
    const line = structuredClone(source);
    line.id = `gid://shopify/CartLine/${i + 1}`;
    line.quantity = quantityPerBucket;
    line.auth = { value: issueToken({ ...base, lineIndex: i }, signingKey, 20800) };
    if (target === 'validation') line.cost.subtotalAmount.amount = `${quantityPerBucket * 30}.00`;
    return line;
  });
  for (let i = 0; i < ordinaryCount; i++) {
    const line = structuredClone(source);
    line.id = `gid://shopify/CartLine/${n + i + 1}`;
    line.auth = null;
    line.quantity = 1;
    line.merchandise.id = `gid://shopify/ProductVariant/${100 + i}`;
    line.merchandise.product.policy = { value: 'optional' };
    if (target === 'validation') line.cost.subtotalAmount.amount = '10.00';
    input.cart.lines.push(line);
  }
  return input;
}

function expectedTransform(input) {
  return { operations: input.cart.lines.filter(line => line.auth).map(line => ({
    lineExpand: {
      cartLineId: line.id,
      expandedCartItems: [{
        merchandiseId: line.merchandise.id, quantity: 1,
        attributes: [{ key: '_insignia_auth', value: line.auth.value }],
        price: { adjustment: { fixedPricePerUnit: { amount: '30.00' } } },
      }],
    },
  })) };
}

async function prepare(target) {
  const dir = path.join(extensionRoot, target);
  const info = await getFunctionInfo(dir);
  const targetName = target === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
  const run = info.targeting[targetName];
  assert.ok(run, `${target} target unavailable`);
  return {
    target, info, targetName, run,
    schema: await loadSchema(info.schemaPath),
    query: await loadInputQuery(run.inputQueryPath),
  };
}

async function execute(prepared, input, expectedOutput, { assertOutput = true, caseName = 'complete' } = {}) {
  const fixture = { target: prepared.targetName, export: prepared.run.export, input, expectedOutput };
  const validation = await validateTestAssets({ schema: prepared.schema, fixture, inputQueryAST: prepared.query });
  assert.deepEqual(validation.inputQuery.errors, [], 'schema-invalid input query');
  assert.deepEqual(validation.inputFixture.errors, [], 'schema-invalid synthetic input');
  assert.deepEqual(validation.outputFixture.errors, [], 'schema-invalid expected output');
  const actual = await runFunction(fixture, prepared.info.functionRunnerPath, prepared.info.wasmPath,
    prepared.run.inputQueryPath, prepared.info.schemaPath);
  if (assertOutput) {
    assert.equal(actual.error, null, actual.error || 'runner error');
    assert.deepEqual(actual.result.output, expectedOutput);
  }
  const outputBytes = actual.result ? Buffer.byteLength(JSON.stringify(actual.result.output)) : null;
  const inputBytes = Buffer.byteLength(JSON.stringify(input));
  const binaryBytes = statSync(prepared.info.wasmPath).size;
  const instructions = actual.metadata?.instructionCount ?? null;
  const queryBytes = readFileSync(prepared.run.inputQueryPath).length;
  const memoryUsageKiB = actual.metadata?.memoryUsageKiB ?? null;
  return {
    target: prepared.target, caseName,
    bucketCount: input.cart.lines.filter(line => line.auth).length,
    ordinaryCount: input.cart.lines.filter(line => !line.auth).length,
    physicalQuantity: input.cart.lines.filter(line => line.auth).reduce((sum, line) => sum + line.quantity, 0),
    provenance: 'schema-valid synthetic projection; not captured platform input',
    queryBytes,
    binaryBytes, inputBytes, outputBytes, instructions,
    memoryUsageKiB,
    stackPeak: null, queryCost: null,
    runnerError: actual.error,
    withinMeasuredReferenceLimits: instructions !== null && outputBytes !== null && memoryUsageKiB !== null &&
      binaryBytes <= LIMIT.binaryBytes && inputBytes <= LIMIT.inputBytes &&
      outputBytes <= LIMIT.outputBytes && instructions <= LIMIT.instructions &&
      memoryUsageKiB * 1024 <= LIMIT.linearMemoryBytes && queryBytes <= LIMIT.queryBytes,
  };
}

function rejectOutput() {
  return { operations: [{ validationAdd: { errors: [{
    message: 'Review your Insignia customization before checkout.', target: '$.cart',
  }] } }] };
}

const mode = process.argv[2] || 'smoke';
assert.ok(mode === 'smoke' || mode === 'bench');
const transform = await prepare('transform');
const validation = await prepare('validation');
const rows = [];

if (mode === 'smoke') {
  // Positive full-path and negative economic/security decisions, not a signature-only microbench.
  const baseT = fixtureFor('transform');
  const expectedT = { operations: baseT.cart.lines.map(line => ({ lineExpand: {
    cartLineId: line.id, expandedCartItems: [{ merchandiseId: line.merchandise.id,
      quantity: 1, attributes: [{ key: '_insignia_auth', value: line.auth.value }],
      price: { adjustment: { fixedPricePerUnit: { amount: line.quantity === 2 ? '30.33' : '30.34' } } },
    }],
  } })) };
  rows.push(await execute(transform, baseT, expectedT));
  const baseV = fixtureFor('validation');
  rows.push(await execute(validation, baseV, { operations: [] }));
  const wrongPrice = structuredClone(baseV);
  wrongPrice.cart.lines[0].cost.subtotalAmount.amount = '60.67';
  rows.push(await execute(validation, wrongPrice, rejectOutput()));
  const missing = structuredClone(baseV);
  missing.cart.lines.pop();
  rows.push(await execute(validation, missing, rejectOutput(), { caseName: 'missing member' }));
  const duplicate = structuredClone(baseV);
  duplicate.cart.lines[1].auth.value = duplicate.cart.lines[0].auth.value;
  duplicate.cart.lines[1].quantity = 2;
  duplicate.cart.lines[1].cost.subtotalAmount.amount = '60.66';
  rows.push(await execute(validation, duplicate, rejectOutput(), { caseName: 'duplicate index' }));
  const badSignature = structuredClone(baseV);
  const bytes = Buffer.from(badSignature.cart.lines.at(-1).auth.value, 'base64url');
  bytes[114] ^= 1;
  badSignature.cart.lines.at(-1).auth.value = bytes.toString('base64url');
  rows.push(await execute(validation, badSignature, rejectOutput(), { caseName: 'invalid signature at last member' }));
  const transformBad = structuredClone(baseT);
  transformBad.cart.lines.at(-1).auth.value = badSignature.cart.lines.at(-1).auth.value;
  rows.push(await execute(transform, transformBad, { operations: [] }, { caseName: 'invalid signature at last member' }));
} else {
  for (const n of [1, 2, 3, 4, 10, 32, 64]) {
    const t = signedInput('transform', n);
    const v = signedInput('validation', n);
    rows.push(await execute(transform, t, expectedTransform(t)));
    rows.push(await execute(validation, v, { operations: [] }));
  }
  for (const target of [transform, validation]) {
    const input = signedInput(target.target, 10, 180);
    rows.push(await execute(target, input, target.target === 'transform' ? expectedTransform(input) : { operations: [] }));
  }
  for (const target of [transform, validation]) {
    const input = signedInput(target.target, 1, 199);
    rows.push(await execute(target, input, target.target === 'transform' ? expectedTransform(input) : { operations: [] }, { caseName: 'near-200-line ordinary coexistence' }));
  }
  for (const n of [2, 3]) {
    for (const target of [transform, validation]) {
      const input = signedInput(target.target, n, 200 - n);
      rows.push(await execute(target, input, target.target === 'transform' ? expectedTransform(input) : { operations: [] }, { caseName: 'near-200-line ordinary coexistence' }));
    }
  }
  for (const target of [transform, validation]) {
    const input = signedInput(target.target, 4, 196);
    rows.push(await execute(target, input, target.target === 'transform' ? expectedTransform(input) : { operations: [] }, { caseName: 'four buckets with near-200-line ordinary cart' }));
  }
  for (const target of [transform, validation]) {
    const input = signedInput(target.target, 10);
    const bytes = Buffer.from(input.cart.lines.at(-1).auth.value, 'base64url');
    bytes[114] ^= 1;
    input.cart.lines.at(-1).auth.value = bytes.toString('base64url');
    rows.push(await execute(target, input, target.target === 'transform' ? { operations: [] } : rejectOutput(), { caseName: 'invalid signature at tenth member' }));
  }
  for (const target of [transform, validation]) {
    const input = signedInput(target.target, 5, 0, 2000);
    rows.push(await execute(target, input, target.target === 'transform' ? expectedTransform(input) : { operations: [] }, { caseName: '10000 physical units in five schema-legal 2000-quantity buckets' }));
  }
}
console.log(JSON.stringify({ mode, limits: LIMIT, rows }, null, 2));
