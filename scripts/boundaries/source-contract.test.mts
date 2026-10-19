import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  checkTypeProjects,
  inspectMaintainedSources,
  readSourcePolicy,
  type SourcePolicy,
} from './source-contract.mts';

test('maintained source rejects unapproved JavaScript and compiler coverage gaps', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-source-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src/price.ts'), 'export const price: bigint = 290n;\n');
  const project = {
    compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', noEmit: true, types: [] },
    include: ['src/**/*.ts'],
  };
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(project));
  const policy: SourcePolicy = { projects: ['tsconfig.json'] };
  assert.deepEqual(inspectMaintainedSources(root, policy), { untyped: [], uncheckedTypeScript: [] });
  writeFileSync(join(root, 'src/unchecked.mjs'), 'export const price = 0;\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /UNAPPROVED_UNTYPED_SOURCE.*unchecked\.mjs/);
  rmSync(join(root, 'src/unchecked.mjs'));
  writeFileSync(join(root, 'test/price.test.mts'), 'export const price: number = "incorrect";\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /UNCHECKED_TYPESCRIPT.*price\.test\.mts/);
  project.include.push('test/**/*.mts');
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(project));
  assert.deepEqual(inspectMaintainedSources(root, policy), { untyped: [], uncheckedTypeScript: [] });
  assert.throws(() => checkTypeProjects(root, policy), /TS2322/);
  writeFileSync(join(root, 'test/price.test.mts'), 'export const price: number = 290;\n');
  assert.doesNotThrow(() => checkTypeProjects(root, policy));
});

test('permanent source policy cannot reintroduce migration exemptions', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-source-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const file = join(root, 'policy.json');
  writeFileSync(
    file,
    JSON.stringify({ projects: [], migration: { untyped: ['existing.mjs'], uncheckedTypeScript: [] } }),
  );
  assert.throws(() => readSourcePolicy(file), /INVALID_SOURCE_POLICY/);
  writeFileSync(file, JSON.stringify({ projects: [] }));
  const policy = readSourcePolicy(file);
  writeFileSync(join(root, 'existing.mjs'), 'export const existing = true;');
  assert.throws(() => inspectMaintainedSources(root, policy), /UNAPPROVED_UNTYPED_SOURCE.*existing\.mjs/);
});

test('current entrypoints reject retired source commands while preserving inert identities and generated artifacts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-current-references-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const policy: SourcePolicy = { projects: [] };
  const retired = ['scripts', 'm5-runtime', 'package-web.mts'].join('/');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { package: `node ${retired}` } }));
  assert.throws(() => inspectMaintainedSources(root, policy), /RETIRED_EXECUTABLE_REFERENCE/);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node dist/server/entry.mjs' } }));
  mkdirSync(join(root, 'deployment'));
  writeFileSync(join(root, 'deployment/compose.yaml'), 'name: insignia-uninstall-m5-024\n');
  mkdirSync(join(root, 'docs/history'), { recursive: true });
  writeFileSync(join(root, 'docs/history/frozen-schema18-manifest.json'), JSON.stringify({ original: retired }));
  assert.doesNotThrow(() => inspectMaintainedSources(root, policy));
  mkdirSync(join(root, 'scripts/m5-runtime'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'm5-runtime', 'revived.sh'), '#!/bin/sh\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /RETIRED_EXECUTABLE_PATH/);
});

test('current routing documents reject broken local links without scanning historical archives', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-current-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const policy: SourcePolicy = { projects: [] };
  writeFileSync(join(root, 'README.md'), '[plan](docs/missing.md)\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /BROKEN_CURRENT_LINK/);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/plan.md'), '# Plan\n');
  writeFileSync(join(root, 'README.md'), '[plan](docs/plan.md#acceptance) [external](https://example.com/missing)\n');
  mkdirSync(join(root, 'docs/archive'));
  writeFileSync(join(root, 'docs/archive/old.md'), '[historical](missing.md)\n');
  assert.doesNotThrow(() => inspectMaintainedSources(root, policy));
});

test('CLI discovery rejects deleted web directories and maintained docs reject missing command targets', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-command-targets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const policy: SourcePolicy = { projects: [] };
  writeFileSync(join(root, 'shopify.app.preview.toml'), 'web_directories = ["scripts/deleted-preview"]\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /MISSING_CLI_DIRECTORY/);
  mkdirSync(join(root, 'scripts/deleted-preview'), { recursive: true });
  assert.doesNotThrow(() => inspectMaintainedSources(root, policy));
  rmSync(join(root, 'shopify.app.preview.toml'));
  writeFileSync(join(root, 'README.md'), 'Run `node --test scripts/operations/deleted.mts` to recover.\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /MISSING_CURRENT_COMMAND_TARGET/);
  writeFileSync(join(root, 'README.md'), 'Runtime output is `dist/server/entry.mjs`.\n');
  assert.doesNotThrow(() => inspectMaintainedSources(root, policy));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { qualify: 'node scripts/ci/absent.mts' } }));
  assert.throws(() => inspectMaintainedSources(root, policy), /MISSING_CURRENT_COMMAND_TARGET/);
  rmSync(join(root, 'package.json'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/orphan.go'), 'package main\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /UNAPPROVED_UNTYPED_SOURCE/);
});

test('the real local admin preview command cannot reference a deleted app entrypoint', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-preview-command-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.scripts['dev:admin'], 'node apps/web/test/admin/preview.mts');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { 'dev:admin': manifest.scripts['dev:admin'] } }),
  );
  assert.throws(() => inspectMaintainedSources(root, { projects: [] }), /MISSING_CURRENT_COMMAND_TARGET.*preview\.mts/);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { qualify: 'node packages/domain/test/removed.mts' } }),
  );
  assert.throws(() => inspectMaintainedSources(root, { projects: [] }), /MISSING_CURRENT_COMMAND_TARGET.*removed\.mts/);
});
