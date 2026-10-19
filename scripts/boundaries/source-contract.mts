import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export interface SourcePolicy {
  projects: string[];
}

const normalized = (path: string) => path.split(sep).join('/');

function sources(root: string): string[] {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      }).split('\0'),
    ),
  ]
    .filter((path) => path && existsSync(resolve(root, path)))
    .sort();
}

function project(root: string, path: string): ts.ParsedCommandLine {
  const file = resolve(root, path);
  const config = ts.readConfigFile(file, ts.sys.readFile);
  assert(!config.error, `INVALID_COMPILER_PROJECT ${path}`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(file), undefined, file, undefined, [
    { extension: '.astro', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
  ]);
  assert.equal(parsed.errors.length, 0, `INVALID_COMPILER_PROJECT ${path}`);
  assert.equal(parsed.options.strict, true, `STRICT_COMPILER_REQUIRED ${path}`);
  return parsed;
}

// Explicit retired roots from the cleanup inventory, grouped by their current job.
// This does not ban future milestone names or rewrite preserved resource identities.
const retiredRoots = [
  ...['m1-functions', 'm4-002', 'm4-003'].map((name) => [`scripts/${name}/`, 'scripts/functions/']),
  ...['m5-003', 'm6-artwork', 'm7-storefront', 'm8-purchase'].map((name) => [
    `scripts/${name}/`,
    'scripts/database/ and scripts/runtime/',
  ]),
  ...['m5-017', 'm5-024', 'm5-runtime'].map((name) => [
    `scripts/${name}/`,
    'scripts/runtime/, scripts/worker/ and scripts/release/',
  ]),
  ...['m5-callback-qualification', 'm5-owner-lifecycle'].map((name) => [`scripts/${name}/`, 'scripts/lifecycle/']),
  ...[
    'm5-002',
    'm5-004',
    'm5-005',
    'm5-009',
    'm5-010',
    'm5-011',
    'm5-012',
    'm5-013',
    'm5-015',
    'm5-015r',
    'm5-016',
    'm5-host-inventory',
    'm5-inventory-phase',
    'm5-native-inventory',
  ].map((name) => [`scripts/${name}/`, 'retired development experiment']),
  ['spikes/', 'retired experiments; retained evidence is inert'],
];
const retiredExecutable = new RegExp(
  `(?:${retiredRoots.map(([path]) => path).join('|')})${/[^\s"'`<>]*?\.(?:[cm]?[jt]sx?|py|sh|ya?ml|sql)(?=$|[^a-zA-Z0-9])/.source}`,
);
const currentDocuments = new Set([
  'README.md',
  'AGENTS.md',
  'HANDOFF.md',
  'docs/delivery/tooling-register.md',
  'docs/delivery/agent-roles.md',
  '.agents/skills/PROJECT-ADAPTATIONS.md',
  'docs/architecture/implementation-plan.md',
  'docs/architecture/decision-ledger.md',
  'docs/delivery/operating-model.md',
  'docs/delivery/state.md',
  'docs/delivery/evidence/m8-context-runtime/WORKLIST.md',
]);
function inspectCommandTargets(root: string, path: string, text: string): void {
  for (const command of text.matchAll(
    /\b(?:node(?: --[A-Za-z-]+(?:=[A-Za-z0-9_.:-]+)?)*|bash|python3(?: -[A-Za-z]+)?)\s+((?:scripts|deployment)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py|sh|go))\b/g,
  ))
    assert(existsSync(resolve(root, command[1] ?? '')), `MISSING_CURRENT_COMMAND_TARGET ${path}: ${command[1]}`);
}

function inspectCurrentReferences(root: string, files: string[]): void {
  for (const path of files) {
    if (/^shopify\.app(?:\.[^/]+)?\.toml$/.test(path)) {
      const text = readFileSync(resolve(root, path), 'utf8');
      for (const list of text.matchAll(/^\s*web_directories\s*=\s*\[([^\]]*)\]/gm))
        for (const entry of (list[1] ?? '').matchAll(/["']([^"']+)["']/g))
          assert(
            existsSync(resolve(root, entry[1] ?? '')) && statSync(resolve(root, entry[1] ?? '')).isDirectory(),
            `MISSING_CLI_DIRECTORY ${path}: ${entry[1]}`,
          );
    }
    assert(
      !(/\.(?:[cm]?[jt]sx?|py|sh)$/.test(path) && retiredExecutable.test(path)),
      `RETIRED_EXECUTABLE_PATH ${path}`,
    );
    // The lifecycle proposal and frozen schema manifests are immutable provenance,
    // not current command authority. Applied migration identity/bytes are preserved.
    if (
      /^(?:apps|packages|scripts|deployment|\.github)\//.test(path) &&
      !path.startsWith('packages/database/migrations/') &&
      path !== 'scripts/lifecycle/SERVICE-PROPOSAL.json' &&
      /\.(?:[cm]?[jt]sx?|astro|json|ya?ml|toml|sh|sql|service|in)$/.test(path)
    ) {
      assert(
        !retiredExecutable.test(readFileSync(resolve(root, path), 'utf8')),
        `RETIRED_EXECUTABLE_REFERENCE ${path}`,
      );
    } else if (path === 'package.json') {
      assert(
        !retiredExecutable.test(readFileSync(resolve(root, path), 'utf8')),
        `RETIRED_EXECUTABLE_REFERENCE ${path}`,
      );
    }
    if (path === 'package.json' || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
      inspectCommandTargets(root, path, readFileSync(resolve(root, path), 'utf8'));
    if (
      !currentDocuments.has(path) &&
      !/^\.agents\/skills\/.*\.md$/.test(path) &&
      !/^(?:scripts|deployment)\/[^/]+\/README\.md$/.test(path)
    )
      continue;
    const text = readFileSync(resolve(root, path), 'utf8');
    inspectCommandTargets(root, path, text);
    for (const match of text.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const target = (match[1] ?? match[2] ?? '').split('#')[0]?.split('?')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
      assert(
        existsSync(resolve(dirname(resolve(root, path)), decodeURIComponent(target))),
        `BROKEN_CURRENT_LINK ${path}: ${target}`,
      );
    }
  }
}

/** Inspect actual repository files and effective compiler inputs, including inherited excludes. */
export function inspectMaintainedSources(root: string, policy: SourcePolicy) {
  const files = sources(root);
  const covered = new Set(
    policy.projects.flatMap((path) => project(root, path).fileNames.map((file) => normalized(relative(root, file)))),
  );
  const untyped = files.filter((path) => /\.(?:jsx?|mjs|cjs|py|go)$/.test(path));
  const uncheckedTypeScript = files.filter((path) => /\.(?:tsx?|mts|cts|astro)$/.test(path) && !covered.has(path));
  assert.equal(untyped.length, 0, `UNAPPROVED_UNTYPED_SOURCE ${untyped[0]}`);
  assert.equal(uncheckedTypeScript.length, 0, `UNCHECKED_TYPESCRIPT ${uncheckedTypeScript[0]}`);
  inspectCurrentReferences(root, files);
  return { untyped, uncheckedTypeScript };
}

/** Node type stripping is execution only; these are real compiler diagnostics. */
export function checkTypeProjects(root: string, policy: SourcePolicy): void {
  for (const path of policy.projects) {
    const config = project(root, path);
    if (config.fileNames.some((file) => file.endsWith('.astro'))) {
      execFileSync(
        'corepack',
        ['pnpm', '--dir', dirname(resolve(root, path)), 'exec', 'astro', 'check', '--tsconfig', basename(path)],
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      continue;
    }
    const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
  }
}

export function readSourcePolicy(file: string): SourcePolicy {
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  assert(input && typeof input === 'object' && !Array.isArray(input) && 'projects' in input, 'INVALID_SOURCE_POLICY');
  assert(
    Object.keys(input).every((key) => ['projects', 'note'].includes(key)),
    'INVALID_SOURCE_POLICY',
  );
  assert(
    Array.isArray(input.projects) && input.projects.every((item: unknown) => typeof item === 'string'),
    'INVALID_SOURCE_POLICY',
  );
  const projects: string[] = [];
  for (const item of input.projects) {
    assert(typeof item === 'string');
    projects.push(item);
  }
  assert.equal(new Set(projects).size, projects.length, 'DUPLICATE_COMPILER_PROJECT');
  return { projects };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../..');
  const policy = readSourcePolicy(resolve(root, 'scripts/boundaries/source-policy.json'));
  for (const arg of process.argv.slice(2))
    assert(['--check-types', '--inventory'].includes(arg), 'UNKNOWN_SOURCE_CHECK_ARGUMENT');
  const inventory = inspectMaintainedSources(root, policy);
  if (process.argv.includes('--check-types')) checkTypeProjects(root, policy);
  console.log(
    JSON.stringify({
      sourceContract: 'PASS',
      untypedSourceFiles: inventory.untyped.length,
      uncheckedTypeScriptFiles: inventory.uncheckedTypeScript.length,
      checkedProjects: process.argv.includes('--check-types') ? policy.projects.length : undefined,
      ...(process.argv.includes('--inventory') ? inventory : {}),
    }),
  );
}
