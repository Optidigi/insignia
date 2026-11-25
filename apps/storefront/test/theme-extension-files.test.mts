import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { build } from 'vite';
import { copyThemeAssets } from '../scripts/copy-theme-asset.mts';
import config from '../vite.config.ts';

/**
 * Shopify CLI's pre-deploy validation of a theme app extension, as it stands in @shopify/cli 5.1.0
 * (`dist/chunk-HMPRWNGG.js`: the `theme` extension specification's `preDeployValidation`; identical in 4.8.2 and 4.9.4).
 * `app deploy` refuses the whole release on any violation ("Invalid filename in your theme app extension"), and
 * Theme Check does not catch it, so the built extension is checked here. Directory → allowed file endings:
 */
const CLI_RULES: Record<string, readonly string[]> = {
  assets: ['.jpg', '.jpeg', '.json', '.js', '.css', '.png', '.svg', '.wasm'],
  blocks: ['.liquid'],
  locales: ['.json'],
  snippets: ['.liquid'],
};
const TOTAL_LIMIT_BYTES = 10 * 1024 * 1024;
const LIQUID_LIMIT_BYTES = 500 * 1024;

test('the built theme app extension passes the Shopify CLI deploy file rules', { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-extension-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const extension = join(directory, 'insignia-theme');
  const output = join(directory, 'dist');
  // The committed extension plus exactly this build's assets: no stale local files.
  await cp(new URL('../../../extensions/insignia-theme/', import.meta.url), extension, {
    recursive: true,
    filter: (source) => !source.includes('/assets/'),
  });
  await build({
    ...config,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { ...config.build, outDir: output },
  });
  const copied = await copyThemeAssets({ from: output, to: join(extension, 'assets') });
  assert.ok(copied.includes('insignia-designer.css'), 'the Designer stylesheet is part of the extension');
  let total = 0;
  let liquid = 0;
  // The CLI bundles every `*/*` file except its ignore list (dotfiles such as .gitkeep, *.toml, config.yml).
  for (const entry of await readdir(extension, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    assert.ok(entry.name in CLI_RULES, `the CLI refuses files in ${entry.name}/`);
    for (const file of await readdir(join(extension, entry.name))) {
      if (file.startsWith('.')) continue;
      assert.ok(
        CLI_RULES[entry.name]?.includes(extname(file)),
        `${entry.name}/${file}: the CLI only deploys ${CLI_RULES[entry.name]?.join(' ')} there`,
      );
      const { size } = await stat(join(extension, entry.name, file));
      total += size;
      if (entry.name === 'blocks' || entry.name === 'snippets') liquid += size;
    }
  }
  t.diagnostic(`extension: ${copied.length} assets, ${total} bytes in total, ${liquid} bytes of Liquid`);
  assert.ok(total <= TOTAL_LIMIT_BYTES, `the extension is ${total} bytes; the CLI limit is 10 MB`);
  assert.ok(liquid <= LIQUID_LIMIT_BYTES, `Liquid is ${liquid} bytes; the CLI limit is 500 KB`);
});
