/** Read/hash only. Never import worker/provider modules or open a transport. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function packageRoot(requireFrom, name) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error('Invalid dependency name');
  for (const directory of requireFrom.resolve.paths(name) ?? []) {
    try {
      const root = realpathSync(join(directory, name));
      if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === name) return root;
    } catch { /* An absent lookup path is not a dependency. */ }
  }
  return null;
}

function files(root, owned) {
  const result = {};
  let bytes = 0;
  const directories = new Set();
  function record(path) {
    const data = readFileSync(path); bytes += data.length;
    if (bytes > 256 * 1024 * 1024 || Object.keys(result).length > 50000) throw new Error('Executable inventory bound exceeded');
    return { sha256:createHash('sha256').update(data).digest('hex'), resolved:relative(root,realpathSync(path)) };
  }
  function walk(directory) {
    const identity = realpathSync(directory);
    if (directories.has(identity)) throw new Error('Executable directory cycle');
    directories.add(identity);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const resolved = realpathSync(path);
      if (relative(root, resolved).startsWith('..')) throw new Error('Executable inventory link escape');
      if (statSync(path).isDirectory()) walk(path);
      else {
        result[relative(root,path)] = record(path);
      }
    }
    directories.delete(identity);
  }
  if (owned) {
    result['package.json'] = record(join(root,'package.json'));
    walk(join(root,'dist'));
  } else walk(root);
  return result;
}

export function collectWorkerInventory(entry) {
  const workerRoot = dirname(dirname(realpathSync(resolve(entry))));
  const initial = JSON.parse(readFileSync(join(workerRoot,'package.json'),'utf8'));
  if (initial.name !== '@insignia/worker' || dirname(realpathSync(resolve(entry))) !== join(workerRoot,'dist'))
    throw new Error('Worker entry identity invalid');
  const visited = new Set();
  const packages = [];
  function collect(root, chain) {
    if (visited.has(root)) return;
    visited.add(root);
    if (visited.size > 2000) throw new Error('Dependency inventory bound exceeded');
    const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    packages.push({ chain, name: manifest.name, version: manifest.version, files: files(root,manifest.name.startsWith('@insignia/')) });
    const required = manifest.dependencies ?? {};
    const optional = { ...manifest.optionalDependencies, ...manifest.peerDependencies };
    const requireFrom = createRequire(join(root,'package.json'));
    for (const name of Object.keys({ ...optional, ...required }).sort()) {
      const dependency = packageRoot(requireFrom,name);
      if (!dependency && Object.hasOwn(required,name) && !Object.hasOwn(manifest.optionalDependencies ?? {},name))
        throw new Error('Required executable dependency absent');
      if (dependency) collect(dependency,[...chain,name]);
    }
  }
  collect(workerRoot,[]);
  return { version:'m5-uninstall-executable-inventory-v1', node:process.version, platform:process.platform, arch:process.arch, packages };
}

export function workerInventoryMatches(entry, expected) {
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) return false;
  return JSON.stringify(collectWorkerInventory(entry)) === JSON.stringify(expected);
}

export function inspectWorkerFromStdin() {
  try {
    const text = readFileSync(0,'utf8');
    if (text.length > 8 * 1024 * 1024) throw new Error('Inspector input exceeds bound');
    const input = JSON.parse(text);
    console.log(JSON.stringify({ exact:workerInventoryMatches(input.entry,input.inventory), node:process.version,
      providerRequests:0, databaseWrites:0, dependencyCodeExecuted:false }));
  } catch {
    console.log(JSON.stringify({ exact:false, providerRequests:0, databaseWrites:0, dependencyCodeExecuted:false }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--collect') console.log(JSON.stringify(collectWorkerInventory(process.argv[3])));
  else inspectWorkerFromStdin();
}
