#!/usr/bin/env node
// One package-only Ed25519 key. Run after verifying the exact app/store and date.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [output, identityPath] = process.argv.slice(2);
if (!output || !identityPath || existsSync(output)) {
  throw new Error('usage: generate-ephemeral <new-private-dir> <fresh-admin-identity-readback.json>');
}
const resolved = path.resolve(output);
const repository = realpathSync(path.resolve(import.meta.dirname, '../../..'));
const parent = realpathSync(path.dirname(resolved));
const actualOutput = path.join(parent, path.basename(resolved));
if (actualOutput === repository || actualOutput.startsWith(`${repository}/`)) {
  throw new Error('key output must remain outside Git');
}
process.umask(0o077);
const stat = statSync(identityPath);
if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
    Date.now() - stat.mtimeMs > 300_000) throw new Error('fresh owner-only Admin readback required');
const readback = JSON.parse(readFileSync(identityPath, 'utf8'));
const currentShop = readback.shop, currentInstallation = readback.currentAppInstallation;
if (readback.errors || currentShop?.id !== 'gid://shopify/Shop/105501393179' ||
    currentShop.myshopifyDomain !== 'insignia-rewrite-dev.myshopify.com' ||
    currentShop.currencyCode !== 'USD' || currentShop.ianaTimezone !== 'America/New_York' ||
    currentShop.publicConfig !== null ||
    currentInstallation?.id !== 'gid://shopify/AppInstallation/1054356963611' ||
    currentInstallation.app?.id !== 'gid://shopify/App/429028933633' ||
    currentInstallation.app?.apiKey !== '1443cf6d03d39edae7c101a943c5c684') {
  throw new Error('new-app identity/config absence or shop context mismatch');
}
const timezone = currentShop.ianaTimezone;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const generationHex = randomUUID().replaceAll('-', '');
const state = { appGid: 'gid://shopify/App/429028933633',
  shopGid: 'gid://shopify/Shop/105501393179',
  installationGid: 'gid://shopify/AppInstallation/1054356963611',
  storeDomain: 'insignia-rewrite-dev.myshopify.com', keyId: 60014, epoch: 1,
  generationHex, publicHex, firstDay: day, lastDay: day + 2, shopLocalDate: date };
const publicConfig = { generationHex, epoch: 1, maxBuckets: 32,
  maxPhysicalQuantity: 10_000, allowNoMarket: false,
  keys: [{ id: 60014, publicHex, revoked: false, firstDay: day, lastDay: day + 2 }] };
mkdirSync(resolved, { mode: 0o700 });
writeFileSync(path.join(resolved, 'private-key.pem'),
  privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
writeFileSync(path.join(resolved, 'key-state.json'), JSON.stringify(state, null, 2) + '\n',
  { mode: 0o600, flag: 'wx' });
writeFileSync(path.join(resolved, 'public-config.json'), JSON.stringify(publicConfig, null, 2) + '\n',
  { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ status: 'KEY_CREATED_OUTSIDE_GIT',
  publicHex, generationHex, keyId: 60014, firstDay: day, lastDay: day + 2 }));
