import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export interface SourcePolicy {
  projects: string[];
  migration: { untyped: string[]; uncheckedTypeScript: string[] };
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

/** Inspect actual repository files and effective compiler inputs, including inherited excludes. */
export function inspectMaintainedSources(root: string, policy: SourcePolicy) {
  const files = sources(root);
  const covered = new Set(
    policy.projects.flatMap((path) => project(root, path).fileNames.map((file) => normalized(relative(root, file)))),
  );
  const untyped = files.filter((path) => /\.(?:jsx?|mjs|cjs|py)$/.test(path));
  const uncheckedTypeScript = files.filter((path) => /\.(?:tsx?|mts|cts|astro)$/.test(path) && !covered.has(path));
  for (const path of untyped) assert(policy.migration.untyped.includes(path), `UNAPPROVED_UNTYPED_SOURCE ${path}`);
  for (const path of uncheckedTypeScript)
    assert(policy.migration.uncheckedTypeScript.includes(path), `UNCHECKED_TYPESCRIPT ${path}`);
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
  assert(input && typeof input === 'object' && 'projects' in input && 'migration' in input, 'INVALID_SOURCE_POLICY');
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
  const migration = input.migration;
  assert(
    strings(input.projects) &&
      migration &&
      typeof migration === 'object' &&
      'untyped' in migration &&
      'uncheckedTypeScript' in migration &&
      strings(migration.untyped) &&
      strings(migration.uncheckedTypeScript),
    'INVALID_SOURCE_POLICY',
  );
  return {
    projects: input.projects,
    migration: { untyped: migration.untyped, uncheckedTypeScript: migration.uncheckedTypeScript },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../..');
  const policy = readSourcePolicy(resolve(root, 'scripts/boundaries/source-policy.json'));
  const migration = inspectMaintainedSources(root, policy);
  if (process.argv.includes('--check-types')) checkTypeProjects(root, policy);
  if (process.argv.includes('--require-complete'))
    assert.equal(migration.untyped.length + migration.uncheckedTypeScript.length, 0, 'SOURCE_MIGRATION_UNFINISHED');
  const remaining = migration.untyped.length + migration.uncheckedTypeScript.length;
  console.log(
    JSON.stringify({
      sourceContract: 'PASS',
      migrationStatus: remaining ? 'IN_PROGRESS' : 'COMPLETE',
      untypedSourceFiles: migration.untyped.length,
      uncheckedTypeScriptFiles: migration.uncheckedTypeScript.length,
      checkedProjects: process.argv.includes('--check-types') ? policy.projects.length : undefined,
      ...(process.argv.includes('--inventory') ? migration : {}),
    }),
  );
}
