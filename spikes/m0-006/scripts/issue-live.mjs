// Offline fixture issuer. Input context must be copied from an independent live
// shop/Function read; this script does not infer market, country, or shop day.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { issueAllocatedQuote } from '../../m0-005/ts/whole-quote.ts';

const [contextPath, outputDir] = process.argv.slice(2);
if (!contextPath || !outputDir || existsSync(outputDir)) {
  throw new Error('Usage: node scripts/issue-live.mjs <live-context.json> <new-private-output-dir>');
}
const input = JSON.parse(readFileSync(contextPath, 'utf8'));
if (input.shop !== 'insignia-staging.myshopify.com' ||
    input.smallVariantId !== '50529053343902' ||
    !/^[A-Z]{2}$/.test(input.country) ||
    !/^[1-9][0-9]*$/.test(input.marketId) ||
    !/^20\d\d-\d\d-\d\d$/.test(input.shopLocalDate)) {
  throw new Error('Independent live fixture context is missing or mismatched');
}
const day = Math.floor(Date.parse(`${input.shopLocalDate}T00:00:00Z`) / 86_400_000);
if (!Number.isSafeInteger(day) || day <= 0) throw new Error('Invalid shop-local day');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const generationHex = randomUUID().replaceAll('-', '');
const epoch = 1;
const keyId = 60006;
const publicHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const config = {
  generationHex, epoch, maxBuckets: 10, maxPhysicalQuantity: 10,
  allowNoMarket: false,
  keys: [{ id: keyId, publicHex, revoked: false, firstDay: day, lastDay: day + 2 }],
};
const groups = [{ groupId: 'fixture-quote', setupMinor: '100', variants: [{
  variantId: input.smallVariantId, quantity: 3, acceptedBaseUnitMinor: '3000',
}] }];
function quote(label) {
  const result = issueAllocatedQuote(groups, {
    keyId, generationHex, epoch, quoteHex: randomUUID().replaceAll('-', ''),
    setHex: randomUUID().replaceAll('-', ''), currency: 'USD', exponent: 2,
    country: input.country, marketId: input.marketId, validThroughDay: day + 2,
  }, privateKey, day);
  if (result.header.totalMinor !== '9100' || result.header.totalQuantity !== 3 ||
      result.envelope.length !== 208 || result.carriers.some(x => x.length !== 30)) {
    throw new Error('Unexpected quote allocation or carrier length');
  }
  return { label, ...result };
}
const orderA = quote('A');
const orderB = quote('B');
mkdirSync(outputDir, { mode: 0o700 });
writeFileSync(join(outputDir, 'private-key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
writeFileSync(join(outputDir, 'public-config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
writeFileSync(join(outputDir, 'issued-quotes.json'), JSON.stringify({ input, orderA, orderB }, null, 2) + '\n', { mode: 0o600 });
// The private key remains only in the new output directory, never on stdout.
process.stdout.write(JSON.stringify({ outputDir, publicHex, generationHex, keyId,
  allocation: orderA.members, totalMinor: orderA.header.totalMinor,
  carrierLengths: [orderA.envelope.length, ...orderA.carriers.map(x => x.length)] }) + '\n');
