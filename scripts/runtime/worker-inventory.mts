/** Read/hash only. Never import worker/provider modules or open a transport. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid inventory record');
  return Object.fromEntries(Object.entries(value));
}
function dependencies(value: unknown): Record<string, unknown> {
  return value === undefined ? {} : object(value);
}

function packageRoot(requireFrom: NodeJS.Require, name: string): string | null {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error('Invalid dependency name');
  function present(path: string): boolean {
    try {
      lstatSync(path);
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
        return false;
      throw new Error('Unqualified dependency candidate');
    }
  }
  for (const directory of requireFrom.resolve.paths(name) ?? []) {
    const candidate = join(directory, name);
    // CJS also tests legacy files before package directories. Existing nearer
    // candidates never fall through to an unrelated outer reviewed package.
    if (['.js', '.json', '.node'].some((extension) => present(candidate + extension)))
      throw new Error('Unqualified dependency candidate');
    if (!present(candidate)) continue;
    let root: string;
    let manifest: Record<string, unknown>;
    try {
      root = realpathSync(candidate);
      manifest = object(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as unknown);
    } catch {
      throw new Error('Unqualified dependency candidate');
    }
    if (manifest.name !== name) throw new Error('Unqualified dependency candidate');
    return root;
  }
  return null;
}

function files(root: string, owned: boolean) {
  const result: Record<string, { sha256: string; resolved: string }> = {};
  let bytes = 0;
  const directories = new Set<string>();
  function record(path: string) {
    const data = readFileSync(path);
    bytes += data.length;
    if (bytes > 256 * 1024 * 1024 || Object.keys(result).length > 50000)
      throw new Error('Executable inventory bound exceeded');
    return { sha256: createHash('sha256').update(data).digest('hex'), resolved: relative(root, realpathSync(path)) };
  }
  function walk(directory: string) {
    const identity = realpathSync(directory);
    if (directories.has(identity)) throw new Error('Executable directory cycle');
    directories.add(identity);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      // Root dependencies are resolved through their complete package graph.
      // Nearer nested lookup trees must also be byte/path-bound, never skipped.
      if (entry.name === 'node_modules' && directory === root) continue;
      const path = join(directory, entry.name);
      const resolved = realpathSync(path);
      if (relative(root, resolved).startsWith('..')) throw new Error('Executable inventory link escape');
      if (statSync(path).isDirectory()) walk(path);
      else {
        result[relative(root, path)] = record(path);
      }
    }
    directories.delete(identity);
  }
  if (owned) {
    result['package.json'] = record(join(root, 'package.json'));
    walk(join(root, 'dist'));
  } else walk(root);
  return result;
}

export function collectWorkerInventory(entry: string, writablePaths: readonly string[] = []) {
  const workerRoot = dirname(dirname(realpathSync(resolve(entry))));
  const initial = object(JSON.parse(readFileSync(join(workerRoot, 'package.json'), 'utf8')) as unknown);
  if (initial.name !== '@insignia/worker' || dirname(realpathSync(resolve(entry))) !== join(workerRoot, 'dist'))
    throw new Error('Worker entry identity invalid');
  const visited = new Set<string>();
  const packages: { chain: string[]; name: string; version: string; files: ReturnType<typeof files> }[] = [];
  function collect(root: string, chain: string[]) {
    if (visited.has(root)) return;
    visited.add(root);
    for (const writable of writablePaths) {
      if (typeof writable !== 'string' || !writable.startsWith('/')) throw new Error('Writable topology invalid');
      const path = resolve(writable);
      if (root === path || root.startsWith(`${path}/`) || path.startsWith(`${root}/`))
        throw new Error('Writable executable overlap');
    }
    if (visited.size > 2000) throw new Error('Dependency inventory bound exceeded');
    const manifest = object(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as unknown);
    assert(typeof manifest.name === 'string' && typeof manifest.version === 'string', 'Invalid package identity');
    packages.push({
      chain,
      name: manifest.name,
      version: manifest.version,
      files: files(root, manifest.name.startsWith('@insignia/')),
    });
    const required = dependencies(manifest.dependencies);
    const optional = { ...dependencies(manifest.optionalDependencies), ...dependencies(manifest.peerDependencies) };
    const requireFrom = createRequire(join(root, 'package.json'));
    for (const name of Object.keys({ ...optional, ...required }).sort()) {
      const dependency = packageRoot(requireFrom, name);
      if (
        !dependency &&
        Object.hasOwn(required, name) &&
        !Object.hasOwn(dependencies(manifest.optionalDependencies), name)
      )
        throw new Error('Required executable dependency absent');
      if (dependency) collect(dependency, [...chain, name]);
    }
  }
  collect(workerRoot, []);
  return {
    version: 'm5-uninstall-executable-inventory-v1',
    node: process.version,
    nodeExecutableSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    platform: process.platform,
    arch: process.arch,
    packages,
  };
}

export function workerInventoryMatches(entry: string, expected: unknown, writablePaths: readonly string[] = []) {
  if (Object.keys(process.env).some((key) => /^(NODE_(OPTIONS|PATH)|LD_.+|DYLD_.+)$/.test(key) && process.env[key]))
    return false;
  return JSON.stringify(collectWorkerInventory(entry, writablePaths)) === JSON.stringify(expected);
}

export function workerProcessMatches(actual: unknown, command: unknown) {
  if (
    !actual ||
    typeof actual !== 'object' ||
    !('nodeMatches' in actual) ||
    !('preloadAbsent' in actual) ||
    !('argv' in actual)
  )
    return false;
  return (
    Array.isArray(command) &&
    command.every((item: unknown) => typeof item === 'string') &&
    command.length >= 2 &&
    basename(command[0] ?? '') === 'node' &&
    actual.nodeMatches === true &&
    actual.preloadAbsent === true &&
    Array.isArray(actual.argv) &&
    actual.argv.length === command.length &&
    typeof actual.argv[0] === 'string' &&
    basename(actual.argv[0]) === 'node' &&
    actual.argv.slice(1).every((value, index) => value === command[index + 1])
  );
}

export function inspectWorkerFromStdin() {
  try {
    const text = readFileSync(0, 'utf8');
    if (text.length > 8 * 1024 * 1024) throw new Error('Inspector input exceeds bound');
    const input = object(JSON.parse(text) as unknown);
    assert(
      typeof input.entry === 'string' &&
        Array.isArray(input.writablePaths) &&
        input.writablePaths.every((value: unknown) => typeof value === 'string'),
      'Invalid inspector input',
    );
    const inventory = object(input.inventory);
    const argv = readFileSync('/proc/1/cmdline', 'utf8').split('\0').filter(Boolean);
    if (!workerProcessMatches({ argv, nodeMatches: true, preloadAbsent: true }, input.command)) {
      console.log(
        JSON.stringify({ exact: false, providerRequests: 0, databaseWrites: 0, dependencyCodeExecuted: false }),
      );
      return;
    }
    const environment = readFileSync('/proc/1/environ', 'utf8').split('\0');
    const actual = {
      argv,
      nodeMatches:
        createHash('sha256').update(readFileSync('/proc/1/exe')).digest('hex') === inventory.nodeExecutableSha256,
      preloadAbsent: !environment.some((value) => /^(NODE_(OPTIONS|PATH)|LD_.+|DYLD_.+)=.+/.test(value)),
    };
    const exact =
      workerProcessMatches(actual, input.command) &&
      Array.isArray(input.writablePaths) &&
      workerInventoryMatches(input.entry, input.inventory, input.writablePaths);
    console.log(
      JSON.stringify({
        exact,
        node: process.version,
        providerRequests: 0,
        databaseWrites: 0,
        dependencyCodeExecuted: false,
      }),
    );
  } catch {
    console.log(
      JSON.stringify({ exact: false, providerRequests: 0, databaseWrites: 0, dependencyCodeExecuted: false }),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--collect') {
    assert(process.argv[3], 'Worker entry required');
    console.log(JSON.stringify(collectWorkerInventory(process.argv[3])));
  } else inspectWorkerFromStdin();
}
