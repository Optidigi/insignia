#!/usr/bin/env node
// Fixed-target operator bridge. Inputs are fresh, owner-only Function captures.
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { bindCurrentFixture } from '../ts/live-context.ts';
import { issueFixtureQuote } from '../ts/fixture.ts';

const [kind, idsPath, transformPath, validationPath, keyDir, outputPath] = process.argv.slice(2);
if (!['small', 'stress10', 'stress32', 'stress33'].includes(kind) ||
    !idsPath || !transformPath || !validationPath || !keyDir || !outputPath) {
  throw new Error('usage: issue-current <case> <ids.json> <transform-input.json> <validation-input.json> <key-dir> <new-output.json>');
}
process.umask(0o077);
const repository = realpathSync(path.resolve(import.meta.dirname, '../../..'));
const out = path.resolve(outputPath), keys = path.resolve(keyDir);
const actualOut = path.join(realpathSync(path.dirname(out)), path.basename(out));
if (lstatSync(keys).isSymbolicLink()) throw new Error('symlinked key directory forbidden');
const actualKeys = realpathSync(keys);
if (!statSync(actualKeys).isDirectory() || statSync(actualKeys).uid !== process.getuid() ||
    (statSync(actualKeys).mode & 0o077) !== 0) throw new Error('private key directory not owner-only');
if ([actualOut, actualKeys].some(p => p === repository || p.startsWith(`${repository}/`))) {
  throw new Error('private key and quote output must remain outside Git');
}
function ownerFile(file, fresh = false) {
  const st = statSync(file);
  if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0 ||
      (fresh && (Date.now() - st.mtimeMs < 0 || Date.now() - st.mtimeMs > 300_000))) {
    throw new Error('operator readback/key file ownership, mode or freshness failed');
  }
  return readFileSync(file);
}
const ids = JSON.parse(ownerFile(idsPath).toString());
const transformBytes = ownerFile(transformPath, true);
const validationBytes = ownerFile(validationPath, true);
const keyState = JSON.parse(ownerFile(path.join(keys, 'key-state.json')).toString());
const privateKey = createPrivateKey(ownerFile(path.join(keys, 'private-key.pem')));
const publicHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
if (publicHex !== keyState.publicHex || keyState.appGid !== 'gid://shopify/App/429028933633' ||
    keyState.shopGid !== 'gid://shopify/Shop/105501393179') {
  throw new Error('private key does not match new-app key state');
}
const scratch = mkdtempSync(path.join(os.tmpdir(), 'insignia-m0-014-read-'));
try {
  const variables = path.join(scratch, 'variables.json');
  const response = path.join(scratch, 'response.json');
  writeFileSync(variables, JSON.stringify({ productIds: [ids.productA, ids.productB] }), { mode: 0o600 });
  const cli = path.resolve(repository, 'spikes/m0-005/node_modules/.bin/shopify');
  const query = path.resolve(import.meta.dirname, 'read-fixture.graphql');
  const call = spawnSync(cli, ['app', 'execute', '--path', path.join(repository, 'spikes/m0-014/rust'),
    '--config', 'm0-014-public', '--store', 'insignia-rewrite-dev.myshopify.com',
    '--version', '2026-07', '--query-file', query, '--variable-file', variables,
    '--output-file', response], { env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: '1' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 });
  if (call.status !== 0) throw new Error('fixed-target authenticated Admin read failed');
  const readback = JSON.parse(readFileSync(response, 'utf8'));
  if (readback.errors) throw new Error('fixed-target Admin GraphQL returned errors');
  const bound = bindCurrentFixture(kind, ids, { admin: readback,
    transform: JSON.parse(transformBytes.toString()), validation: JSON.parse(validationBytes.toString()),
    transformInputBytes: transformBytes.length, validationInputBytes: validationBytes.length },
  keyState.keyId, publicHex, randomUUID().replaceAll('-', ''), randomUUID().replaceAll('-', ''));
  if (bound.context.generationHex !== keyState.generationHex ||
      bound.context.shopLocalDate !== keyState.shopLocalDate) {
    throw new Error('key generation/day differs from fresh Function/Admin readback');
  }
  const outcome = issueFixtureQuote(kind, bound.context, bound.projection, privateKey);
  const payload = { case: kind, observedAtUtc: new Date().toISOString(),
    readDigest: bound.readDigest, context: bound.context, projection: bound.projection,
    assignments: bound.assignments, outcome };
  const bytes = Buffer.from(JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(out, bytes, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: outcome.status, reason: outcome.status === 'REJECT' ? outcome.reason : undefined,
    outputSha256: createHash('sha256').update(bytes).digest('hex'),
    totalCartLines: outcome.status === 'ADMIT' ? outcome.bounds.totalCartLines : undefined }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
