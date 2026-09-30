import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { issueAdmittedQuote } from '../src/admission.ts';
import { CURRENCY_EXPONENTS, CURRENCY_MATRIX_VERSION, currencyExponent } from '../src/currency.ts';
import { DOMAIN, decodeEnvelope, decodeMemberCarrier, encodeHeader, encodeMember } from '../src/whole-quote.ts';

const vector = JSON.parse(readFileSync(new URL('../fixtures/whole-quote-v2.json', import.meta.url), 'utf8'));
const matrix = JSON.parse(readFileSync(new URL('../fixtures/currency-matrix-v1.json', import.meta.url), 'utf8'));
test('every admitted code matches the versioned matrix and unknown/digital values reject', () => {
  assert.equal(matrix.version, CURRENCY_MATRIX_VERSION);
  assert.deepEqual(
    Object.fromEntries(Object.entries(CURRENCY_EXPONENTS).sort(([a], [b]) => a.localeCompare(b))),
    matrix.exponents,
  );
  for (const code of ['XXX', 'BTC', 'USX', 'BGN', 'MGA', 'MRU', 'usd']) assert.equal(currencyExponent(code), undefined);
});
test('production-generated carriers decode, conserve and verify for every complete set', () => {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(vector.publicHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  for (const entry of vector.cases) {
    const decoded = decodeEnvelope(entry.envelope);
    assert.deepEqual(decoded.header, entry.header);
    assert.deepEqual(entry.memberCarriers.map(decodeMemberCarrier), entry.members);
    assert.equal(entry.memberCarriers.length, entry.header.count);
    assert.equal(entry.groupRevisionAssociation.length, entry.header.count);
    const message = Buffer.concat([DOMAIN, encodeHeader(entry.header), ...entry.members.map(encodeMember)]);
    assert.equal(verify(null, message, key, decoded.signature), true, entry.name);
    const mutated = Buffer.from(message);
    mutated[mutated.length - 1] ^= 1;
    assert.equal(verify(null, mutated, key, decoded.signature), false, entry.name);
  }
});

test('versioned 33-bucket vector rejects before any signing call', async () => {
  const rejected = vector.rejections.find((entry: { name: string }) => entry.name === 'thirty_three_presign');
  assert.ok(rejected);
  let calls = 0;
  const result = await issueAdmittedQuote(
    rejected.header,
    rejected.members,
    20800,
    {
      signWholeQuote: async () => {
        calls++;
        throw Error('signer must not run');
      },
    },
    { ordinaryLineHint: rejected.ordinaryLines },
  );
  assert.deepEqual(result, { status: 'REJECT', reason: rejected.reason });
  assert.equal(calls, 0);
});
