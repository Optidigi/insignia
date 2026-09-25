import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionInfo } from '@shopify/shopify-function-test-helpers';

const spike = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(spike, '../..');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const sha256Json = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const run = (bin, args) => execFileSync(bin, args, { cwd: spike, encoding: 'utf8' }).trim();
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['target', 'node_modules', '.shopify', 'evidence'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const sourceFiles = walk(spike);
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
  const cases = path.join(spike, 'evidence', `cases-${mode}.jsonl`);
  const result = JSON.parse(readFileSync(p));
  const fixtures = readFileSync(cases, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  if (fixtures.length !== result.rows.length) throw new Error(`${mode}: case count mismatch`);
  for (let i = 0; i < fixtures.length; i++) {
    const row = result.rows[i];
    if (sha256Json(fixtures[i]) !== row.caseFixtureSha256 ||
      sha256Json(fixtures[i].input) !== row.inputSha256 ||
      sha256Json(fixtures[i].expectedOutput) !== row.expectedOutputSha256) {
      throw new Error(`${mode}: case hash mismatch at row ${i}`);
    }
  }
  return [mode, { rows: result.rows.length, bytes: statSync(p).size, sha256: sha(p),
    casesPath: path.relative(repo, cases), casesBytes: statSync(cases).size,
    casesSha256: sha(cases) }];
}));
const cli = JSON.parse(readFileSync(path.join(spike, 'node_modules/@shopify/cli/package.json')));
const helpers = JSON.parse(readFileSync(path.join(spike, 'node_modules/@shopify/shopify-function-test-helpers/package.json')));
const rustcPath = run('rustup', ['which', 'rustc']);
const cargoPath = run('rustup', ['which', 'cargo']);
const cliEntry = path.join(spike, 'node_modules/@shopify/cli/bin/run.js');
const linker = process.env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER;
const zig = '/home/serveradmin/insignia-pf002-tools/zig/zig-x86_64-linux-0.16.0/zig';
console.log(JSON.stringify({
  sourceRevisionAtMeasurement: run('git', ['rev-parse', 'HEAD']),
  sourceHashes, artifacts, runner, resultFiles,
  toolchain: { node: process.version, pnpm: run('corepack', ['pnpm', '--version']),
    rustc: run('rustc', ['--version']), cargo: run('cargo', ['--version']),
    shopifyCliPackage: cli.version, testHelpersPackage: helpers.version },
  toolHashes: {
    node: { path: process.execPath, sha256: sha(process.execPath) },
    rustc: { path: rustcPath, sha256: sha(rustcPath) },
    cargo: { path: cargoPath, sha256: sha(cargoPath) },
    shopifyCliEntry: { path: cliEntry, sha256: sha(cliEntry) },
    shopifyCliPackage: { sha256: sha(path.join(spike, 'node_modules/@shopify/cli/package.json')) },
    ...(linker ? { linker: { path: linker, sha256: sha(linker) }, zig: { path: zig, sha256: sha(zig) } } : {}),
  },
  provenance: 'cold local Shopify CLI build; synthetic schema-validated Function runner inputs',
}, null, 2));
