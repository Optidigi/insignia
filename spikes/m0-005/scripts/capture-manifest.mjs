import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionInfo } from '@shopify/shopify-function-test-helpers';

const spike = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(spike, '../..');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const run = (bin, args) => execFileSync(bin, args, { cwd: spike, encoding: 'utf8' }).trim();
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['target', 'node_modules', '.shopify', 'evidence'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const sourceFiles = walk(spike).filter(p => !p.includes(`${path.sep}fixtures${path.sep}targets${path.sep}`));
const sourceHashes = Object.fromEntries(sourceFiles.sort().map(p => [path.relative(repo, p), sha(p)]));
const artifacts = {};
let runner = null;
for (const name of ['transform', 'validation']) {
  const info = await getFunctionInfo(path.join(spike, 'extensions', name));
  artifacts[name] = { path: path.relative(repo, info.wasmPath), bytes: statSync(info.wasmPath).size,
    sha256: sha(info.wasmPath) };
  const actualRunner = { path: info.functionRunnerPath, bytes: statSync(info.functionRunnerPath).size,
    sha256: sha(info.functionRunnerPath) };
  if (runner !== null && runner.sha256 !== actualRunner.sha256) throw new Error('two runner binaries differ');
  runner = actualRunner;
}
const resultFiles = Object.fromEntries(['smoke', 'bench'].map(mode => {
  const p = path.join(spike, 'evidence', `${mode}.json`);
  const result = JSON.parse(readFileSync(p));
  return [mode, { rows: result.rows.length, bytes: statSync(p).size, sha256: sha(p) }];
}));
const cli = JSON.parse(readFileSync(path.join(spike, 'node_modules/@shopify/cli/package.json')));
const helpers = JSON.parse(readFileSync(path.join(spike, 'node_modules/@shopify/shopify-function-test-helpers/package.json')));
console.log(JSON.stringify({
  sourceRevisionAtMeasurement: run('git', ['rev-parse', 'HEAD']),
  sourceHashes, artifacts, runner, resultFiles,
  toolchain: { node: process.version, pnpm: run('corepack', ['pnpm', '--version']),
    rustc: run('rustc', ['--version']), cargo: run('cargo', ['--version']),
    shopifyCliPackage: cli.version, testHelpersPackage: helpers.version },
  provenance: 'cold local Shopify CLI build; synthetic schema-validated Function runner inputs',
}, null, 2));
