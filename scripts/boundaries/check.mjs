import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const entries = ['apps', 'packages', 'extensions'].flatMap((parent) =>
  existsSync(resolve(root, parent))
    ? readdirSync(resolve(root, parent))
        .map((name) => `${parent}/${name}/src`)
        .filter((path) => existsSync(resolve(root, path)))
    : [],
);
assert.ok(
  entries.includes('apps/web/src') &&
    entries.includes('apps/storefront/src') &&
    entries.includes('packages/domain/src'),
);
const depcruise = ['pnpm', 'exec', 'depcruise', '--config', '.dependency-cruiser.cjs'];

function run(command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function cruise(paths = entries, type = 'err', expected = 0) {
  return run('corepack', [...depcruise, '--output-type', type, ...paths], expected);
}

const green = cruise();
assert.match(green, /no dependency violations found/);
const graph = JSON.parse(cruise(entries, 'json'));
assert.ok(graph.modules.length >= 8, 'real source graph must be nonempty');

const bySource = new Map(graph.modules.map((module) => [module.source, module]));
for (const module of graph.modules) {
  for (const edge of module.dependencies) {
    if (edge.module === '@shopify/shopify-api' || edge.module.startsWith('@shopify/shopify-api/')) {
      assert.ok(module.source.startsWith('packages/shopify/'), `${module.source} imports Shopify SDK outside adapter`);
    }
    const fromAdapter = module.source.match(/^packages\/(shopify|artwork|database)\//)?.[1];
    const toAdapter = edge.resolved.match(/^packages\/(shopify|artwork|database)\//)?.[1];
    assert.ok(
      !fromAdapter || !toAdapter || fromAdapter === toAdapter,
      `${module.source} imports another adapter ${edge.resolved}`,
    );
  }
}
const browser = [...bySource.keys()].filter(
  (path) => path.startsWith('apps/storefront/src/') || path.startsWith('apps/web/src/islands/'),
);
assert.ok(browser.length >= 3, 'browser entry graph must be nonempty');
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const banned =
  /^(?:apps\/worker|packages\/(?:shopify|artwork|database|observability|signer))\/|(?:^|\/)@shopify\/shopify-api(?:\/|$)|^spikes\//;
for (const entry of browser) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length) {
    const source = todo.pop();
    if (seen.has(source)) continue;
    seen.add(source);
    for (const edge of bySource.get(source)?.dependencies ?? []) {
      const bare = edge.module.replace(/^node:/, '');
      const core = edge.coreModule || builtins.has(bare) || builtins.has(bare.split('/')[0]);
      assert.ok(!core && !banned.test(edge.resolved) && !banned.test(edge.module), `${entry} reaches ${edge.module}`);
      if (bySource.has(edge.resolved)) todo.push(edge.resolved);
    }
  }
}

const manifests = [
  'package.json',
  'apps/web/package.json',
  'apps/storefront/package.json',
  'apps/worker/package.json',
  'packages/domain/package.json',
  'packages/application/package.json',
  'packages/database/package.json',
];
for (const manifest of manifests) {
  const parsed = JSON.parse(readFileSync(resolve(root, manifest), 'utf8'));
  for (const name of Object.keys(parsed.dependencies ?? {})) {
    assert.ok(
      !['react', 'react-dom', 'react-konva', '@shopify/shopify-api'].includes(name),
      `${manifest} has forbidden runtime dependency ${name}`,
    );
  }
}

const probes = [
  [
    'packages/domain/src/__boundary_probe.ts',
    "import {readFileSync} from 'node:fs'; export {readFileSync};",
    'domain-is-pure',
  ],
  [
    'packages/domain/src/__boundary_probe.ts',
    "import type {Shopify} from '@shopify/shopify-api'; export type Probe = Shopify;",
    'shopify-sdk-only-in-adapter',
    2,
  ],
  [
    'packages/domain/src/__boundary_probe.ts',
    "import type {AstroGlobal} from 'astro'; export type Probe = AstroGlobal;",
    'domain-is-pure',
  ],
  [
    'packages/domain/src/__boundary_probe.ts',
    "import type {JSX} from 'preact'; export type Probe = JSX;",
    'domain-is-pure',
  ],
  [
    'packages/domain/src/__boundary_probe.ts',
    "import type {Stage} from 'konva/lib/Stage'; export type Probe = Stage;",
    'domain-is-pure',
  ],
  [
    'packages/domain/src/__boundary_probe.ts',
    "import type {Pool} from 'pg'; export type Probe = Pool;",
    'domain-is-pure',
  ],
  [
    'apps/storefront/src/__boundary_probe.ts',
    "import {syntheticDerivative} from '../../worker/src/diagnostic.js'; export {syntheticDerivative};",
    'browser-does-not-import-server',
  ],
  [
    'apps/storefront/src/__boundary_probe.ts',
    "import type {IncomingMessage} from 'node:http'; export type Probe = IncomingMessage;",
    'browser-no-node-builtins',
  ],
  [
    'apps/storefront/src/__boundary_probe.ts',
    "import {Buffer} from 'node:buffer'; export {Buffer};",
    'browser-no-node-builtins',
  ],
  [
    'apps/web/src/islands/__boundary_probe.ts',
    "import {join} from 'node:path'; export {join};",
    'browser-no-node-builtins',
  ],
  [
    'packages/application/src/__boundary_probe.ts',
    "import {createDatabase} from '../../database/src/client/database.js'; export {createDatabase};",
    'database-internals-stay-in-adapter',
  ],
  [
    'packages/application/src/__boundary_probe.ts',
    "import {createDatabase} from '../../database/dist/client/database.js'; export {createDatabase};",
    'database-internals-stay-in-adapter',
  ],
  [
    'apps/worker/src/__boundary_probe.ts',
    "import {createDurableCore} from '../../../packages/database/src/index.js'; export {createDurableCore};",
    'database-root-must-use-package',
  ],
  [
    'apps/worker/src/__boundary_probe.ts',
    "import {createDurableCore} from '../../../packages/database/dist/index.js'; export {createDurableCore};",
    'database-root-must-use-package',
  ],
];
// A real server composition package may use only the database package root.
const serverProbe = resolve(root, 'apps/worker/src/__boundary_probe.ts');
assert.ok(!existsSync(serverProbe), 'refusing to overwrite server boundary fixture');
try {
  writeFileSync(serverProbe, "import {createDurableCore} from '@insignia/database'; export {createDurableCore};");
  const result = JSON.parse(cruise([serverProbe], 'json'));
  const edge = result.modules.find((module) => module.source === 'apps/worker/src/__boundary_probe.ts')
    ?.dependencies[0];
  assert.equal(edge?.module, '@insignia/database');
  assert.equal(edge?.couldNotResolve, false, 'server root import must resolve, not pass as an unknown package');
  assert.match(edge.resolved, /^packages\/database\/(src|dist)\/index\.(?:ts|js|d\.ts)$/);
  assert.equal(result.summary.error, 0, 'safe database root import must pass the normal boundary rules');
  run('corepack', ['pnpm', '--filter', '@insignia/worker', 'exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']);
  const runtime = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {createDurableCore} from '@insignia/database'; if(typeof createDurableCore !== 'function') process.exit(1)",
    ],
    { cwd: resolve(root, 'apps/worker'), encoding: 'utf8' },
  );
  assert.equal(runtime.status, 0, `server runtime root import failed: ${runtime.stderr}`);
} finally {
  rmSync(serverProbe, { force: true });
}
for (const [path, source, rule, status = 1] of probes) {
  const file = resolve(root, path);
  assert.ok(!existsSync(file), `refusing to overwrite ${path}`);
  try {
    writeFileSync(file, source);
    assert.match(cruise([file], 'err', status), new RegExp(rule));
  } finally {
    rmSync(file, { force: true });
  }
}

// A re-export must be rejected by the dependency graph and by a real browser bundle.
const probe = resolve(root, 'apps/storefront/src/__boundary_probe.ts');
const bridge = resolve(root, 'apps/storefront/src/__boundary_bridge.ts');
assert.ok(!existsSync(probe) && !existsSync(bridge));
try {
  writeFileSync(bridge, "export {readFileSync} from 'node:fs';");
  writeFileSync(probe, "import {readFileSync} from './__boundary_bridge.js'; console.log(readFileSync);");
  assert.match(cruise([probe], 'err', 1), /browser-no-node-builtins/);
  const bundle = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'esbuild', probe, '--bundle', '--platform=browser', '--outfile=.m1-artifacts/invalid-browser.js'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(bundle.status, 0, 'browser bundler must reject transitive Node import');
  assert.match(bundle.stderr, /Could not resolve "node:fs"/);
} finally {
  rmSync(probe, { force: true });
  rmSync(bridge, { force: true });
}

const webProbe = resolve(root, 'apps/web/src/islands/__boundary_probe.ts');
assert.ok(!existsSync(webProbe));
try {
  writeFileSync(webProbe, "import {createRequire} from 'node:module'; console.log(createRequire);");
  assert.match(cruise([webProbe], 'err', 1), /browser-no-node-builtins/);
  const bundle = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'esbuild', webProbe, '--bundle', '--platform=browser', '--outfile=.m1-artifacts/invalid-web.js'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(bundle.status, 0, 'web-island bundler must reject Node import');
  assert.match(bundle.stderr, /Could not resolve "node:module"/);
} finally {
  rmSync(webProbe, { force: true });
}

run('corepack', [
  'pnpm',
  'exec',
  'esbuild',
  'apps/storefront/src/main.ts',
  '--bundle',
  '--platform=browser',
  '--format=esm',
  '--outfile=.m1-artifacts/valid-browser.js',
]);
run('corepack', [
  'pnpm',
  '--filter',
  '@insignia/domain',
  'exec',
  'node',
  '--input-type=module',
  '-e',
  "import {parseMinor} from '@insignia/domain'; if(parseMinor('91.00',2)!==9100n) process.exit(1)",
]);
const deepImport = spawnSync(
  'corepack',
  [
    'pnpm',
    '--filter',
    '@insignia/domain',
    'exec',
    'node',
    '--input-type=module',
    '-e',
    "import '@insignia/domain/src/money.ts'",
  ],
  { cwd: root, encoding: 'utf8' },
);
assert.notEqual(deepImport.status, 0, 'private package source import must fail');
assert.match(deepImport.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);

console.log(
  `Boundary checks passed: ${graph.modules.length} real modules, ${browser.length} browser modules, ${probes.length + 2} negative source fixtures, 2 rejected browser bundles and exports.`,
);
