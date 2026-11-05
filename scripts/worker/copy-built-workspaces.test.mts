import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyBuiltWorkspaces } from './copy-built-workspaces.mts';

function file(path: string, value: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, value);
}

test('portable copy includes frontend exported runtime outputs and excludes Designer demo/source trees', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'insignia-workspace-copy-'));
  try {
    const source = join(scratch, 'checkout');
    const destination = join(scratch, 'package');
    const web = { name: '@insignia/web', type: 'module' };
    const localization = { name: '@insignia/ui-localization', type: 'module', exports: { './core': './dist/core.js' } };
    const designer = {
      name: '@insignia/designer',
      type: 'module',
      exports: { '.': './dist-library/designer.js', './style.css': './dist-library/designer.css' },
    };
    file(join(source, 'apps/web/package.json'), JSON.stringify(web));
    file(join(source, 'apps/web/dist/server/entry.mjs'), 'export const app = true;');
    file(join(destination, 'package.json'), JSON.stringify(web));
    mkdirSync(join(destination, 'node_modules/.pnpm'), { recursive: true });
    for (const [directory, manifest, output, bytes] of [
      ['localization', localization, 'dist/core.js', 'export const translated = "Nederlands";'],
      ['designer', designer, 'dist-library/designer.js', 'export const Designer = "selected";'],
    ] as const) {
      const sourcePackage = join(source, 'frontend', directory);
      const targetPackage = join(destination, 'node_modules/.pnpm', directory, 'node_modules/@insignia', directory);
      file(join(sourcePackage, 'package.json'), JSON.stringify(manifest));
      file(join(sourcePackage, output), bytes);
      file(join(targetPackage, 'package.json'), JSON.stringify(manifest));
      file(join(targetPackage, 'src/example.ts'), 'must not ship');
      file(join(targetPackage, 'examples/preview.mts'), 'must not ship');
      file(join(targetPackage, 'dist/demo.html'), 'demo host must not ship');
      if (directory === 'designer')
        file(join(sourcePackage, 'dist-library/designer.css'), '.designer { color: black; }');
    }
    copyBuiltWorkspaces(source, destination);
    rmSync(source, { recursive: true });
    const designerPackage = join(destination, 'node_modules/.pnpm/designer/node_modules/@insignia/designer');
    assert.deepEqual(readdirSync(designerPackage).sort(), ['dist-library', 'package.json']);
    assert.equal(
      readFileSync(join(designerPackage, 'dist-library/designer.css'), 'utf8'),
      '.designer { color: black; }',
    );
    const localizationEntry = join(
      destination,
      'node_modules/.pnpm/localization/node_modules/@insignia/localization/dist/core.js',
    );
    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const m = await import(process.argv[1]); if(m.translated !== "Nederlands") process.exit(1)',
        localizationEntry,
      ],
      { cwd: destination, encoding: 'utf8', env: { PATH: process.env.PATH } },
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.ok(existsSync(join(destination, 'dist/server/entry.mjs')));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('missing compiled exports and source/demo export roots fail closed', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'insignia-workspace-copy-invalid-'));
  try {
    for (const exported of ['./src/index.ts', './dist/../src/index.js', './dist/missing.js']) {
      const root = join(scratch, exported.replaceAll('/', '_'));
      const source = join(root, 'checkout');
      const destination = join(root, 'package');
      const manifest = { name: '@insignia/worker', type: 'module', exports: { '.': exported } };
      file(join(source, 'apps/worker/package.json'), JSON.stringify(manifest));
      file(join(source, 'apps/worker/dist/main.js'), 'export const worker = true;');
      file(join(destination, 'package.json'), JSON.stringify(manifest));
      mkdirSync(join(destination, 'node_modules/.pnpm'), { recursive: true });
      assert.throws(() => copyBuiltWorkspaces(source, destination), /reviewed compiled|export missing/);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('workspace copy rejects dependency links escaping the portable package without touching foreign files', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'insignia-workspace-copy-escape-'));
  try {
    const source = join(scratch, 'checkout');
    const destination = join(scratch, 'package');
    const foreign = join(scratch, 'foreign');
    const manifest = { name: '@insignia/web', type: 'module' };
    file(join(source, 'apps/web/package.json'), JSON.stringify(manifest));
    file(join(source, 'apps/web/dist/server/entry.mjs'), 'export const app = true;');
    file(join(destination, 'package.json'), JSON.stringify(manifest));
    file(join(foreign, 'sentinel'), 'untouched');
    const scope = join(destination, 'node_modules/.pnpm/dependency/node_modules/@insignia');
    mkdirSync(scope, { recursive: true });
    symlinkSync(foreign, join(scope, 'foreign'));
    assert.throws(() => copyBuiltWorkspaces(source, destination), /escaped destination/);
    assert.equal(readFileSync(join(foreign, 'sentinel'), 'utf8'), 'untouched');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
