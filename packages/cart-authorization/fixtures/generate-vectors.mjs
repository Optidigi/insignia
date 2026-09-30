/** Reproducible synthetic public vectors from the production TypeScript issuer. */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CURRENCY_EXPONENTS, CURRENCY_MATRIX_VERSION } from '../src/currency.ts';
import { issueWholeQuote } from '../src/whole-quote.ts';

const label = 'Insignia M4-002 synthetic deterministic fixture only';
const syntheticSeed = createHash('sha256').update(label).digest();
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), syntheticSeed]),
  format: 'der',
  type: 'pkcs8',
});
const publicHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const signer = {
  signWholeQuote: async (input) => ({
    keyId: 7,
    publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicHex, 'hex')).digest('hex'),
    firstValidDay: 20800,
    lastValidDay: 20802,
    signature: sign(null, input.message, privateKey),
  }),
};
const specs = [
  {
    name: 'one_bucket',
    ordinaryLines: 0,
    members: [{ variantId: '101', quantity: 1, unitMinor: '1999', group: 'shirt', revision: 'r1' }],
  },
  {
    name: 'ten_plus_190',
    ordinaryLines: 190,
    members: Array.from({ length: 10 }, (_, i) => ({
      variantId: String(100 + i),
      quantity: 1,
      unitMinor: String(1000 + i),
      group: 'shirt',
      revision: 'r1',
    })),
  },
  {
    name: 'thirty_two_plus_168',
    ordinaryLines: 168,
    members: Array.from({ length: 32 }, (_, i) => ({
      variantId: String(200 + i),
      quantity: 1,
      unitMinor: String(2000 + i),
      group: i < 16 ? 'shirt' : 'hoodie',
      revision: i < 16 ? 'r1' : 'r2',
    })),
  },
  {
    name: 'ten_thousand_five_buckets',
    ordinaryLines: 0,
    members: Array.from({ length: 5 }, (_, i) => ({
      variantId: String(300 + i),
      quantity: 2000,
      unitMinor: '100',
      group: `group-${i}`,
      revision: 'r3',
    })),
  },
  {
    name: 'multi_product_revision',
    ordinaryLines: 3,
    members: [
      { variantId: '401', quantity: 2, unitMinor: '2500', group: 'shirt-red', revision: 'r5' },
      { variantId: '402', quantity: 3, unitMinor: '2700', group: 'shirt-blue', revision: 'r5' },
      { variantId: '501', quantity: 1, unitMinor: '3200', group: 'hoodie', revision: 'r9' },
      { variantId: '601', quantity: 4, unitMinor: '1000', group: 'hat', revision: 'r2' },
    ],
  },
  {
    name: 'setup_remainder',
    ordinaryLines: 0,
    members: [
      { variantId: '9007199254740993', quantity: 1, unitMinor: '3034', group: 'design', revision: 'r1' },
      { variantId: '9007199254740993', quantity: 2, unitMinor: '3033', group: 'design', revision: 'r1' },
    ],
  },
];
const cases = [];
for (const [i, spec] of specs.entries()) {
  const members = spec.members.map((m, index) => ({
    index,
    variantId: m.variantId,
    quantity: m.quantity,
    unitMinor: m.unitMinor,
  }));
  const header = {
    keyId: 7,
    generationHex: '11111111111141118111111111111111',
    epoch: 4,
    quoteHex: `${(i + 1).toString(16).padStart(8, '0')}000040008000000000000001`,
    setHex: `${(i + 1).toString(16).padStart(8, '0')}000040008000000000000002`,
    count: members.length,
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: 20802,
    totalQuantity: members.reduce((sum, m) => sum + m.quantity, 0),
    totalMinor: members.reduce((sum, m) => sum + BigInt(m.quantity) * BigInt(m.unitMinor), 0n).toString(),
  };
  const issued = await issueWholeQuote(header, members, 20800, signer);
  cases.push({
    name: spec.name,
    ordinaryLines: spec.ordinaryLines,
    header,
    members,
    groupRevisionAssociation: spec.members.map(({ group, revision }) => ({ group, revision })),
    envelope: issued.envelope,
    memberCarriers: issued.members,
  });
}
const rejectedMembers = Array.from({ length: 33 }, (_, index) => ({
  index,
  variantId: String(700 + index),
  quantity: 1,
  unitMinor: '100',
}));
const rejections = [
  {
    name: 'thirty_three_presign',
    reason: 'BUCKET_COUNT',
    ordinaryLines: 0,
    header: { ...cases[0].header, count: 33, totalQuantity: 33, totalMinor: '3300' },
    members: rejectedMembers,
  },
];
const vector = {
  rejections,
  version: 'whole-quote-v2-candidate-v1',
  provenance: 'Derived synthetic fixture; deterministic key material is constructed only in generator memory',
  publicHex,
  cases,
  adversarial: [
    '33 buckets rejected before signing',
    'changed country or market',
    'changed currency or exponent',
    'changed generation or epoch',
    'revoked or out-of-window key',
    'missing, duplicate, misindexed member',
    'wrong variant, quantity or pre-discount unit price',
    'selling-plan conflict',
  ],
};
const matrix = {
  version: CURRENCY_MATRIX_VERSION,
  exponents: Object.fromEntries(Object.entries(CURRENCY_EXPONENTS).sort(([a], [b]) => a.localeCompare(b))),
};
for (const [filename, data] of [
  ['whole-quote-v2.json', vector],
  ['currency-matrix-v1.json', matrix],
]) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const target = new URL(filename, import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== serialized) throw Error(`${filename} differs from production TypeScript`);
  } else writeFileSync(target, serialized);
}
