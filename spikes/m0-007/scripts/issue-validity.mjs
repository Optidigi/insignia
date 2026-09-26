// Fresh staging-only Ed25519 offers for actual current, expired and future windows.
// The independent live context is a required input; private keys stay in the caller's
// new 0700 temporary directory and are never printed or committed.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { issueAllocatedQuote } from '../../m0-005/ts/whole-quote.ts';

const [contextPath, outputDir] = process.argv.slice(2);
if (!contextPath || !outputDir || existsSync(outputDir)) {
  throw new Error('Usage: node scripts/issue-validity.mjs <independent-live-context.json> <new-private-output-dir>');
}
const input = JSON.parse(readFileSync(contextPath, 'utf8'));
if (input.shop !== 'insignia-staging.myshopify.com' ||
    input.smallVariantId !== '50529053343902' ||
    !/^[A-Z]{2}$/.test(input.country) ||
    !/^[1-9][0-9]*$/.test(input.marketId) ||
    !/^20\d\d-\d\d-\d\d$/.test(input.shopLocalDate)) {
  throw new Error('Independent current staging context is missing or mismatched');
}
const day = Math.floor(Date.parse(`${input.shopLocalDate}T00:00:00Z`) / 86_400_000);
if (!Number.isSafeInteger(day) || day < 10) throw new Error('Invalid shop-local day');
const generationHex = randomUUID().replaceAll('-', '');
const epoch = 1;
const cases = [
  {label: 'expired', keyId: 7001, issueDay: day - 3, firstDay: day - 5, lastDay: day + 2},
  {label: 'future', keyId: 7002, issueDay: day + 1, firstDay: day + 1, lastDay: day + 5},
  {label: 'current', keyId: 7003, issueDay: day, firstDay: day, lastDay: day + 2},
];
const groups = [{groupId: 'fixture-quote', setupMinor: '100', variants: [{
  variantId: input.smallVariantId, quantity: 3, acceptedBaseUnitMinor: '3000',
}]}];
const keys = [];
const issued = {};
mkdirSync(outputDir, {mode: 0o700});
for (const spec of cases) {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const publicHex = publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('hex');
  const quote = issueAllocatedQuote(groups, {
    keyId: spec.keyId, generationHex, epoch,
    quoteHex: randomUUID().replaceAll('-', ''), setHex: randomUUID().replaceAll('-', ''),
    currency: 'USD', exponent: 2, country: input.country, marketId: input.marketId,
    validThroughDay: spec.issueDay + 2,
  }, privateKey, spec.issueDay);
  if (quote.header.totalMinor !== '9100' || quote.header.totalQuantity !== 3 ||
      quote.envelope.length !== 208 || quote.carriers.some(x => x.length !== 30)) {
    throw new Error(`Unexpected allocation/carrier for ${spec.label}`);
  }
  keys.push({id: spec.keyId, publicHex, revoked: false,
    firstDay: spec.firstDay, lastDay: spec.lastDay});
  issued[spec.label] = {issueDay: spec.issueDay, keyId: spec.keyId, ...quote};
  writeFileSync(join(outputDir, `${spec.label}-private-key.pem`),
    privateKey.export({format: 'pem', type: 'pkcs8'}), {mode: 0o600});
}
const config = {generationHex, epoch, maxBuckets: 10, maxPhysicalQuantity: 10,
  allowNoMarket: false, keys};
writeFileSync(join(outputDir, 'public-config.json'), JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
writeFileSync(join(outputDir, 'issued-offers.json'), JSON.stringify({context: input, issued}, null, 2) + '\n', {mode: 0o600});
process.stdout.write(JSON.stringify({outputDir, generationHex, shopLocalDay: day,
  keyIds: keys.map(k => k.id), publicKeys: keys.map(k => k.publicHex),
  expiryDays: Object.fromEntries(Object.entries(issued).map(([k, v]) => [k, v.header.validThroughDay]))}) + '\n');
