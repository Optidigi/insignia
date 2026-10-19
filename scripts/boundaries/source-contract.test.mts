import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkTypeProjects, inspectMaintainedSources, type SourcePolicy } from './source-contract.mts';

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
  const policy: SourcePolicy = { projects: ['tsconfig.json'], migration: { untyped: [], uncheckedTypeScript: [] } };
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

test('migration entries admit only the exact existing file and cannot excuse a new source', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'insignia-source-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, 'existing.mjs'), 'export const existing = true;\n');
  const policy: SourcePolicy = {
    projects: [],
    migration: { untyped: ['existing.mjs'], uncheckedTypeScript: [] },
  };
  assert.deepEqual(inspectMaintainedSources(root, policy), { untyped: ['existing.mjs'], uncheckedTypeScript: [] });
  writeFileSync(join(root, 'new.mjs'), 'export const introduced = true;\n');
  assert.throws(() => inspectMaintainedSources(root, policy), /UNAPPROVED_UNTYPED_SOURCE.*new\.mjs/);
});
