import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getFunctionInfo, loadInputQuery, loadSchema, runFunction, validateTestAssets,
} from '@shopify/shopify-function-test-helpers';

const spike = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(path.join(spike, 'fixtures/vectors.json')));
const extensionRoot = process.env.M0_005_EXTENSION_ROOT || path.join(spike, 'extensions');
const seed = Buffer.from(fixture.seedHex, 'hex'); // RFC 8032 public test seed; never a merchant key.
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der', type: 'pkcs8',
});
const domain = Buffer.from(fixture.domainUtf8Hex, 'hex');
const LIMIT = {
  binaryBytes: 256_000, linearMemoryBytes: 10_000_000, stackBytes: 512_000,
  instructions: 11_000_000, inputBytes: 128_000, outputBytes: 20_000,
  queryBytes: 3_000, queryCost: 30,
};

function jsonFixture(target) {
  return JSON.parse(readFileSync(path.join(spike, 'fixtures/targets', `${target}-valid.json`)));
}
function decimal(minor, exponent = 2) {
  const value = BigInt(minor);
  const base = 10n ** BigInt(exponent);
  return `${value / base}.${String(value % base).padStart(exponent, '0')}`;
}
function record(index, variant, quantity, unitMinor) {
  const raw = Buffer.alloc(22);
  raw.writeUInt16BE(index, 0);
  raw.writeBigUInt64BE(BigInt(variant), 2);
  raw.writeUInt32BE(quantity, 10);
  raw.writeBigUInt64BE(BigInt(unitMinor), 14);
  return raw;
}
function signedSet(specs, { expiry = 20802, quoteHex = '22'.repeat(16), setHex = '33'.repeat(16) } = {}) {
  assert.ok(specs.length > 0 && specs.length <= 64);
  const header = Buffer.from(fixture.headerHex, 'hex');
  header.set(Buffer.from(quoteHex, 'hex'), 28);
  header.set(Buffer.from(setHex, 'hex'), 44);
  header.writeUInt16BE(specs.length, 60);
  header.writeUInt32BE(expiry, 76);
  let quantity = 0;
  let total = 0n;
  const records = specs.map((s, i) => {
    quantity += s.quantity;
    total += BigInt(s.quantity) * BigInt(s.unitMinor);
    return record(i, s.variant, s.quantity, s.unitMinor);
  });
  assert.ok(quantity <= 0xffffffff && total <= 0xffffffffffffffffn);
  header.writeUInt32BE(quantity, 80);
  header.writeBigUInt64BE(total, 84);
  const signature = sign(null, Buffer.concat([domain, header, ...records]), privateKey);
  return { envelope: Buffer.concat([header, signature]).toString('base64url'),
    members: records.map(r => r.toString('base64url')), records };
}
function cartLineId(index) {
  return `gid://shopify/CartLine/00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}
function defaultSpecs(count, quantity = 1) {
  return Array.from({ length: count }, () => ({
    variant: '9007199254740993', quantity, unitMinor: '3000',
  }));
}
function signedInput(target, specs, ordinaryCount = 0, setOptions) {
  assert.ok(specs.length + ordinaryCount <= 200);
  const input = jsonFixture(target);
  const template = input.cart.lines[0];
  const signed = signedSet(specs, setOptions);
  input.cart.quote = { value: signed.envelope };
  input.cart.lines = specs.map((spec, i) => {
    const line = structuredClone(template);
    line.id = cartLineId(i);
    line.quantity = spec.quantity;
    line.member = { value: signed.members[i] };
    line.merchandise.id = `gid://shopify/ProductVariant/${spec.variant}`;
    if (target === 'validation') {
      line.cost.subtotalAmount.amount = decimal(BigInt(spec.quantity) * BigInt(spec.unitMinor));
    }
    return line;
  });
  for (let i = 0; i < ordinaryCount; i++) {
    const line = structuredClone(template);
    line.id = cartLineId(specs.length + i);
    line.member = null;
    line.quantity = 1;
    line.merchandise.id = `gid://shopify/ProductVariant/${9007199254741000n + BigInt(i)}`;
    line.merchandise.product.policy = { value: 'optional' };
    if (target === 'validation') line.cost.subtotalAmount.amount = '10.00';
    input.cart.lines.push(line);
  }
  return input;
}
function ordinaryInput(target, count = 200) {
  const input = signedInput(target, defaultSpecs(1), count - 1);
  input.cart.quote = null;
  input.cart.lines[0].member = null;
  input.cart.lines[0].merchandise.product.policy = { value: 'optional' };
  return input;
}
const golden = signedSet(fixture.expected.members.map(m => ({
  variant: m.variantId, quantity: m.quantity, unitMinor: m.unitMinor,
})));
assert.equal(golden.envelope, fixture.envelope, 'runner issuer differs from independent Python vector');
assert.deepEqual(golden.members, fixture.memberTokens);
function configChange(input, changes) {
  const config = JSON.parse(input.shop.publicConfig.value);
  input.shop.publicConfig.value = JSON.stringify({ ...config, ...changes });
  return input;
}
function expectedTransform(input) {
  return { operations: input.cart.lines.filter(line => line.member).map(line => {
    const raw = Buffer.from(line.member.value, 'base64url');
    return { lineExpand: {
      cartLineId: line.id,
      expandedCartItems: [{
        merchandiseId: line.merchandise.id, quantity: 1,
        attributes: [{ key: '_insignia_member_v2', value: line.member.value }],
        price: { adjustment: { fixedPricePerUnit: { amount: decimal(raw.readBigUInt64BE(14)) } } },
      }],
    } };
  }) };
}
const empty = { operations: [] };
const reject = { operations: [{ validationAdd: { errors: [{
  message: 'Review your Insignia customization before checkout.', target: '$.cart',
}] } }] };

async function prepare(target) {
  const info = await getFunctionInfo(path.join(extensionRoot, target));
  const name = target === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
  const run = info.targeting[name];
  assert.ok(run, `${target} target unavailable`);
  return { target, info, name, run,
    schema: await loadSchema(info.schemaPath), query: await loadInputQuery(run.inputQueryPath) };
}
async function execute(prepared, input, expectedOutput, caseName, knownLimitation = null) {
  const f = { target: prepared.name, export: prepared.run.export, input, expectedOutput };
  const validation = await validateTestAssets({ schema: prepared.schema, fixture: f,
    inputQueryAST: prepared.query });
  assert.deepEqual(validation.inputQuery.errors, [], `${caseName}: schema-invalid query`);
  assert.deepEqual(validation.inputFixture.errors, [], `${caseName}: schema-invalid input`);
  assert.deepEqual(validation.outputFixture.errors, [], `${caseName}: schema-invalid expected output`);
  const actual = await runFunction(f, prepared.info.functionRunnerPath, prepared.info.wasmPath,
    prepared.run.inputQueryPath, prepared.info.schemaPath);
  assert.equal(actual.error, null, `${caseName}: ${actual.error}`);
  assert.deepEqual(actual.result.output, expectedOutput, `${caseName}: wrong output`);
  const wasm = readFileSync(prepared.info.wasmPath);
  const queryBytes = readFileSync(prepared.run.inputQueryPath).length;
  const inputBytes = Buffer.byteLength(JSON.stringify(input));
  const outputBytes = Buffer.byteLength(JSON.stringify(actual.result.output));
  const instructions = actual.metadata?.instructionCount ?? null;
  const memoryUsageKiB = actual.metadata?.memoryUsageKiB ?? null;
  const signed = input.cart.lines.filter(line => line.member);
  return {
    target: prepared.target, caseName, signedBuckets: signed.length,
    ordinaryLines: input.cart.lines.length - signed.length,
    physicalQuantity: signed.reduce((sum, line) => sum + line.quantity, 0),
    provenance: 'schema-valid synthetic projection; live carrier and child price semantics unverified',
    wasmSha256: createHash('sha256').update(wasm).digest('hex'),
    binaryBytes: statSync(prepared.info.wasmPath).size,
    inputBytes, outputBytes, queryBytes, instructions, memoryUsageKiB,
    stackPeak: null, queryCost: null, runnerError: actual.error, knownLimitation,
    withinMeasuredReferenceLimits: instructions !== null && memoryUsageKiB !== null &&
      wasm.length <= LIMIT.binaryBytes && inputBytes <= LIMIT.inputBytes &&
      outputBytes <= LIMIT.outputBytes && instructions <= LIMIT.instructions &&
      memoryUsageKiB * 1024 <= LIMIT.linearMemoryBytes && queryBytes <= LIMIT.queryBytes,
    withinEngineeringHeadroom: instructions !== null && instructions <= 8_800_000 &&
      outputBytes <= 16_000,
  };
}

const mode = process.argv[2] || 'smoke';
assert.ok(mode === 'smoke' || mode === 'bench');
const targets = [await prepare('transform'), await prepare('validation')];
const rows = [];
async function both(name, make, expect = 'positive', knownLimitation = null) {
  for (const target of targets) {
    const input = make(target.target);
    const output = expect === 'positive' ? (target.target === 'transform' ? expectedTransform(input) : empty)
      : expect === 'ordinary' ? empty : target.target === 'transform' ? empty : reject;
    rows.push(await execute(target, input, output, name, knownLimitation));
  }
}
if (mode === 'smoke') {
  await both('EUR91 exact allocated quote', target => jsonFixture(target));
  await both('cart enumeration reversed, signed order reconstructed', target => {
    const x = jsonFixture(target); x.cart.lines.reverse(); return x;
  });
  await both('last member changed; whole statement fails', target => {
    const x = jsonFixture(target); const last = x.cart.lines.at(-1);
    const raw = Buffer.from(last.member.value, 'base64url'); raw[21] ^= 1;
    last.member.value = raw.toString('base64url'); return x;
  }, 'reject');
  await both('observed Validation price differs', target => {
    const x = jsonFixture(target);
    if (target === 'validation') x.cart.lines[0].cost.subtotalAmount.amount = '60.67';
    else { const raw = Buffer.from(x.cart.lines[0].member.value, 'base64url'); raw[21] ^= 1;
      x.cart.lines[0].member.value = raw.toString('base64url'); }
    return x;
  }, 'reject');
  await both('missing signed member', target => {
    const x = jsonFixture(target); x.cart.lines.pop(); return x;
  }, 'reject');
  await both('duplicate signed index', target => {
    const x = jsonFixture(target); x.cart.lines[1].member.value = x.cart.lines[0].member.value;
    return x;
  }, 'reject');
  await both('header with no members', target => {
    const x = jsonFixture(target); x.cart.lines = []; return x;
  }, 'reject');
  await both('members with no header', target => {
    const x = jsonFixture(target); x.cart.quote = null; return x;
  }, 'reject');
  await both('known required unsigned line', target => {
    const x = jsonFixture(target); x.cart.quote = null;
    for (const line of x.cart.lines) line.member = null;
    return x;
  }, 'reject');
  await both('optional unsigned ordinary control', target => {
    const x = ordinaryInput(target, 2); return x;
  }, 'ordinary');
  await both('KNOWN_LIMIT missing policy unsigned allows', target => {
    const x = jsonFixture(target); x.cart.quote = null;
    for (const line of x.cart.lines) { line.member = null; line.merchandise.product.policy = null; }
    return x;
  }, 'ordinary', 'Missing independent required-product policy can allow unsigned required goods');
} else {
  await both('0 signed + 200 ordinary', target => ordinaryInput(target), 'ordinary');
  for (const n of [1, 3, 4, 10, 32, 64]) {
    await both(`${n} signed + ${200 - n} ordinary`, target => signedInput(target, defaultSpecs(n), 200 - n));
  }
  for (const n of [10, 32, 64]) {
    await both(`${n} isolated signed`, target => signedInput(target, defaultSpecs(n)));
  }
  await both('500-unit two-group tier', target => signedInput(target, [
    { variant: '9007199254740993', quantity: 250, unitMinor: '2314' },
    { variant: '9007199254740994', quantity: 250, unitMinor: '3520' },
  ]));
  await both('10000 physical units in five 2000-unit buckets', target =>
    signedInput(target, defaultSpecs(5, 2000)));
  await both('EUR91 exact allocation', target => jsonFixture(target));
  for (const position of ['first', 'last']) {
    await both(`${position} malformed member`, target => {
      const x = signedInput(target, defaultSpecs(10));
      const line = position === 'first' ? x.cart.lines[0] : x.cart.lines.at(-1);
      line.member.value = `+${line.member.value.slice(1)}`; return x;
    }, 'reject');
    await both(`${position} tampered member`, target => {
      const x = signedInput(target, defaultSpecs(10));
      const line = position === 'first' ? x.cart.lines[0] : x.cart.lines.at(-1);
      const raw = Buffer.from(line.member.value, 'base64url'); raw[21] ^= 1;
      line.member.value = raw.toString('base64url'); return x;
    }, 'reject');
  }
  await both('duplicate member', target => {
    const x = signedInput(target, defaultSpecs(10));
    x.cart.lines[1].member.value = x.cart.lines[0].member.value; return x;
  }, 'reject');
  await both('missing member', target => {
    const x = signedInput(target, defaultSpecs(10)); x.cart.lines.pop(); return x;
  }, 'reject');
  await both('over trusted bucket capacity', target =>
    configChange(signedInput(target, defaultSpecs(10)), { maxBuckets: 4 }), 'reject');
  await both('over trusted physical quantity', target =>
    configChange(signedInput(target, defaultSpecs(5, 2000)), { maxPhysicalQuantity: 9999 }), 'reject');
}
console.log(JSON.stringify({ mode, limits: LIMIT, rows }, null, 2));
