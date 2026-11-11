import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { test } from 'node:test';
import vector from '../fixtures/cart-line-v3.json' with { type: 'json' };
import {
  carrierChars,
  DOMAIN_V3,
  decodeLineCarrierV3,
  decodePrefixV3,
  depthForCount,
  EMPTY_SLOT_V3,
  encodeHeaderV3,
  issueLineSetV3,
  LEAF_LABEL_V3,
  leafHashV3,
  linearLineRecordsV3,
  lineCarrierIncludedV3,
  lineRefV3,
  merkleProofV3,
  merkleRootV3,
  nodeHashV3,
  PREFIX_V3_CHARS,
  proofRootV3,
  verifyLineSetV3,
} from '../src/line-v3.ts';
import { InjectedEd25519Signer } from '../src/whole-quote.ts';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}
const publicKey = Buffer.from(vector.publicHex, 'hex');

test('committed vectors are exactly what the production TypeScript issuer generates', () => {
  execFileSync(process.execPath, [
    new URL('../fixtures/generate-line-v3-vectors.mts', import.meta.url).pathname,
    '--check',
  ]);
  assert.equal(DOMAIN_V3.toString('hex'), vector.domainHex);
  assert.equal(LEAF_LABEL_V3.toString('hex'), vector.leafLabelHex);
  assert.equal(EMPTY_SLOT_V3.toString('hex'), vector.emptySlotHex);
});

test('every line decodes, is included and verifies alone, in any subset and order', () => {
  for (const entry of vector.cases) {
    const n = entry.records.length;
    assert.equal(entry.header.count, n);
    assert.equal(encodeHeaderV3(entry.header).toString('hex'), entry.headerHex, entry.name);
    assert.equal(merkleRootV3(entry.records).toString('hex'), entry.header.rootHex, entry.name);
    for (const [i, carrier] of entry.carriers.entries()) {
      assert.equal(carrier.length, carrierChars(depthForCount(n)));
      assert.equal(carrier.slice(0, PREFIX_V3_CHARS), entry.prefix);
      const decoded = decodeLineCarrierV3(carrier);
      assert.deepEqual(decoded.header, entry.header);
      assert.deepEqual(decoded.record, entry.records[i]);
      assert.deepEqual(
        decoded.proof.map((p) => p.toString('hex')),
        entry.proofHex[i],
      );
      assert.equal(leafHashV3(decoded.record).toString('hex'), entry.leafHex[i]);
      assert.equal(lineCarrierIncludedV3(decoded), true);
      assert.equal(lineRefV3(entry.header.setHex, i), entry.refs[i]);
      assert.deepEqual(verifyLineSetV3([carrier], publicKey).records, [entry.records[i]]);
    }
    assert.equal(verifyLineSetV3(entry.carriers, publicKey).records.length, n);
    const subset = entry.carriers.filter((_, i) => i % 2 === 1).reverse();
    if (subset.length) assert.equal(verifyLineSetV3(subset, publicKey).records.length, subset.length);
    assert.deepEqual(decodePrefixV3(entry.prefix).header, entry.header);
  }
});

test('every shared negative vector is rejected by the TypeScript set verifier', () => {
  assert.ok(vector.negatives.length >= 40);
  for (const negative of vector.negatives) {
    const carriers = negative.lines.map((line) => line.carrier);
    // Context, day and observed price are caller checks; every vector also fails structure, inclusion or signature.
    assert.throws(() => verifyLineSetV3(carriers, publicKey), negative.name);
  }
});

test('proofs are bound to the signed line count, index path and hash domains', () => {
  const entry = must(vector.cases.find((c) => c.name === 'five_lines'));
  const records = entry.records;
  const proof = merkleProofV3(records, 3);
  assert.equal(proofRootV3(must(records[3]), proof, 5).toString('hex'), entry.header.rootHex);
  assert.throws(() => proofRootV3(must(records[3]), proof.slice(1), 5), /proof length/);
  assert.throws(() => proofRootV3(must(records[3]), [...proof, must(proof[0])], 5), /proof length/);
  assert.throws(() => proofRootV3({ ...must(records[3]), index: 5 }, proof, 5), /index outside/);
  assert.notEqual(proofRootV3({ ...must(records[3]), index: 2 }, proof, 5).toString('hex'), entry.header.rootHex);
  // Tags separate leaves, nodes and padding: the same bytes never collide across roles.
  const leaf = leafHashV3(must(records[0]));
  assert.notDeepEqual(leaf, EMPTY_SLOT_V3);
  assert.notDeepEqual(nodeHashV3(leaf, leaf), leaf);
  assert.notDeepEqual(nodeHashV3(leaf, EMPTY_SLOT_V3), nodeHashV3(EMPTY_SLOT_V3, leaf));
  assert.deepEqual(
    leaf,
    createHash('sha512-256')
      .update(Buffer.concat([Buffer.of(0), LEAF_LABEL_V3, Buffer.from(must(entry.recordHex[0]), 'hex')]))
      .digest(),
  );
  for (const [count, depth] of [
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [16, 4],
    [17, 5],
    [32, 5],
  ] as const)
    assert.equal(depthForCount(count), depth);
  for (const count of [0, 33, 1.5, -1]) assert.throws(() => depthForCount(count));
});

test('issuer signs domain-separated header bytes once and refuses incomplete or unbounded sets', async () => {
  const seed = createHash('sha256').update('Insignia cart-line v3 issuer test').digest();
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const raw = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  const messages: Buffer[] = [];
  const signer = new InjectedEd25519Signer({
    getSigningKey: async (input) => {
      messages.push(input.message);
      return {
        key,
        keyId: 7,
        publicKeyFingerprint: 'synthetic',
        revoked: false,
        firstValidDay: 20800,
        lastValidDay: 20802,
      };
    },
  });
  const claims = {
    keyId: 7,
    generationHex: '11'.repeat(16),
    epoch: 4,
    quoteHex: '22'.repeat(16),
    setHex: '33'.repeat(16),
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: 20802,
  };
  const records = [
    { index: 0, variantId: '1', unitMinor: '100' },
    { index: 1, variantId: '1', unitMinor: '150' },
    { index: 2, variantId: '2', unitMinor: '0' },
  ];
  const issued = await issueLineSetV3(claims, records, 20800, signer);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], Buffer.concat([DOMAIN_V3, encodeHeaderV3(issued.header)]));
  assert.equal(verifyLineSetV3(issued.carriers, raw).records.length, 3);
  await assert.rejects(issueLineSetV3(claims, records, 20799, signer), /D\+2/);
  await assert.rejects(issueLineSetV3(claims, [], 20800, signer));
  await assert.rejects(issueLineSetV3(claims, [must(records[1]), must(records[0])], 20800, signer), /index-ordered/);
  await assert.rejects(
    issueLineSetV3(claims, [{ ...must(records[0]), variantId: '0' }], 20800, signer),
    /zero variant/,
  );
  await assert.rejects(issueLineSetV3(claims, [{ ...must(records[0]), unitMinor: '-1' }], 20800, signer));
  await assert.rejects(issueLineSetV3({ ...claims, currency: 'XXX' }, records, 20800, signer));
  assert.equal(messages.length, 1, 'no rejected set reached the signer');
});

test('v3 issuance refuses quantity-dependent economics', () => {
  const group = { setupMinor: '0', setupComponents: [], unitComponents: [{ selectedMinQuantity: null }] };
  const line = (index: number, extra: Record<string, unknown> = {}) => ({
    lineIndex: index,
    variantId: String(700 + index),
    quantity: 3,
    unitPriceMinor: '250',
    setupPerUnitMinor: '0',
    lineTotalMinor: '750',
    canonicalIdentitySha256: 'a'.repeat(64),
    productId: '1',
    ...extra,
  });
  assert.deepEqual(linearLineRecordsV3({ groups: [group], lines: [line(0), line(1)] }), [
    { index: 0, variantId: '700', unitMinor: '250' },
    { index: 1, variantId: '701', unitMinor: '250' },
  ]);
  for (const bad of [
    { groups: [{ ...group, setupMinor: '1' }], lines: [line(0)] },
    { groups: [{ ...group, setupComponents: [{}] }], lines: [line(0)] },
    { groups: [{ ...group, unitComponents: [{ selectedMinQuantity: 10 }] }], lines: [line(0)] },
    { groups: [group], lines: [line(0, { setupPerUnitMinor: '1' })] },
    { groups: [group], lines: [line(0, { lineTotalMinor: '751' })] },
    { groups: [group], lines: [line(0), line(1, { variantId: '700' })] },
    { groups: [group], lines: [line(1)] },
  ])
    assert.throws(() => linearLineRecordsV3(bad as never), /linear|ordered/);
});
