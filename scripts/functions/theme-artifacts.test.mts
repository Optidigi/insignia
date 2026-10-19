import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectThemeArtifacts } from './theme-artifacts.mts';

function fixture(root: string) {
  const build = join(root, 'apps/storefront/dist'),
    theme = join(root, 'extensions/insignia-theme/assets');
  mkdirSync(build, { recursive: true });
  mkdirSync(theme, { recursive: true });
  for (const [name, value] of [
    ['insignia-storefront.js', 'import("./insignia-element.js")'],
    ['insignia-element.js', 'import("./insignia-customizer-hash.js")'],
    ['insignia-customizer-hash.js', 'export const actualCustomizer = true'],
  ]) {
    assert(name && value);
    writeFileSync(join(build, name), value);
    writeFileSync(join(theme, name), value);
  }
  return { build, theme };
}
test('lazy chunks and retained CDN assets are all bound', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-inventory-'));
  try {
    const { theme } = fixture(root);
    writeFileSync(join(theme, 'insignia-retained-hash.js'), 'cached entry dependency');
    const paths = collectThemeArtifacts(root);
    assert(paths.includes('apps/storefront/dist/insignia-customizer-hash.js'));
    assert(paths.includes('extensions/insignia-theme/assets/insignia-customizer-hash.js'));
    assert(paths.includes('extensions/insignia-theme/assets/insignia-retained-hash.js'));
    assert.equal(paths.length, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('missing or different copied chunks reject', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-inventory-'));
  try {
    const { theme } = fixture(root),
      chunk = join(theme, 'insignia-customizer-hash.js');
    unlinkSync(chunk);
    assert.throws(() => collectThemeArtifacts(root), /current build/);
    writeFileSync(chunk, 'different');
    assert.throws(() => collectThemeArtifacts(root), /current build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('asset symlinks reject', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-inventory-'));
  try {
    const { theme } = fixture(root);
    symlinkSync('insignia-element.js', join(theme, 'insignia-alias.js'));
    assert.throws(() => collectThemeArtifacts(root), /regular/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
