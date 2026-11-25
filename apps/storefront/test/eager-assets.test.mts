import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { build, type Rollup } from 'vite';
import config from '../vite.config.ts';

/** Every product page loads insignia-element.js and its static imports before the buyer opens anything. */
test('the theme embed entry statically loads no Designer modal, theme preference, localization or Preact code', async () => {
  const result = await build({
    ...config,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { ...config.build, write: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = new Map(
    outputs
      .flatMap((output) => output.output)
      .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const eager = new Set<string>();
  const visit = (fileName: string) => {
    if (eager.has(fileName)) return;
    eager.add(fileName);
    for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
  };
  visit('insignia-element.js');
  const modules = [...eager].flatMap((fileName) => chunks.get(fileName)?.moduleIds ?? []);
  assert.ok(
    modules.some((id) => id.endsWith('/src/element.tsx')),
    'the entry chunk itself is inspected',
  );
  for (const forbidden of [
    /\/storefront\/src\/designer\/modal\.ts$/,
    /\/frontend\/designer\/src\/theme-preference\.ts$/,
    /\/frontend\/localization\//,
    /\/i18next\//,
    /\/preact\//,
  ])
    assert.deepEqual(
      modules.filter((id) => forbidden.test(id)),
      [],
      `${forbidden} must load only when the Designer is opened or prepared`,
    );
  for (const fileName of eager) {
    const chunk = chunks.get(fileName);
    assert.deepEqual([...(chunk?.viteMetadata?.importedCss ?? [])], [], `${fileName} must not import a stylesheet`);
    // The open-path preload list (file names only, fetched on intent or click) is the one permitted mention.
    const lists = (chunk?.code ?? '').match(/"\[(?:\\"insignia-[^\\"]+\\",?)+\]"/g) ?? [];
    assert.ok(lists.length <= 1 && (lists[0]?.length ?? 0) <= 1024, `${fileName} carries at most one small chunk list`);
    const code = lists.reduce((rest, list) => rest.replace(list, ''), chunk?.code ?? '');
    assert.ok(!/insignia-designer(?:-frame\.js|\.css)/.test(code), `${fileName} imports no Designer asset`);
  }
  // #653 budget: at most 15 KB of Insignia JavaScript transferred before any buyer interaction. The theme loads
  // the classic bootstrap, which imports insignia-element.js and its static imports.
  const bootstrap = outputs
    .flatMap((output) => output.output)
    .find((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName === 'insignia-storefront.js');
  const files = [
    ['insignia-storefront.js', String(bootstrap?.source ?? '')] as const,
    ...[...eager].sort().map((fileName) => [fileName, chunks.get(fileName)?.code ?? ''] as const),
  ];
  const sizes = files.map(([fileName, code]) => ({
    fileName,
    raw: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
  }));
  const gzip = sizes.reduce((sum, size) => sum + size.gzip, 0);
  console.log(
    `eager theme embed files (raw/gzip bytes): ${sizes.map((s) => `${s.fileName} ${s.raw}/${s.gzip}`).join(', ')}; total gzip ${gzip}`,
  );
  assert.ok(gzip <= 15 * 1024, `eager Insignia JavaScript is ${gzip} gzip bytes, over the 15 KB budget`);
});

test('the main Designer stylesheet carries no fonts; two font stylesheets carry every Inter face', async () => {
  const result = await build({
    ...config,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { ...config.build, write: false },
  });
  const assets = new Map(
    (Array.isArray(result) ? result : [result])
      .flatMap((output) => (output as Rollup.RollupOutput).output)
      .filter((item): item is Rollup.OutputAsset => item.type === 'asset')
      .map((asset) => [asset.fileName, String(asset.source)] as const),
  );
  const sizes: string[] = [];
  const measure = (fileName: string) => {
    const css = assets.get(fileName) ?? '';
    assert.ok(css.length > 0, `${fileName} is built`);
    const gzip = gzipSync(css, { level: 9 }).length;
    sizes.push(`${fileName} ${css.length}/${gzip}`);
    return { css, gzip };
  };
  const main = measure('insignia-designer.css');
  assert.doesNotMatch(main.css, /@font-face|url\(\s*['"]?data:/, 'the main stylesheet inlines nothing');
  assert.ok(main.gzip <= 20 * 1024, `the main Designer stylesheet is ${main.gzip} gzip bytes`);
  const subsets = (css: string) =>
    [...css.matchAll(/@font-face\s*\{[^}]*unicode-range:([^;]+);[^}]*\}/g)].map((match) => match[1]?.trim());
  const latin = measure('insignia-designer-font-latin.css');
  const other = measure('insignia-designer-font-other.css');
  console.log(`Designer stylesheets (raw/gzip bytes): ${sizes.join(', ')}`);
  for (const { css } of [latin, other]) {
    assert.doesNotMatch(css, /url\((?!data:font\/woff2;base64,)/, 'faces are inlined, never separate font files');
    assert.match(css, /font-display:\s*swap/);
  }
  // Latin (U+0000-00FF) and Latin Extended (U+0100-024F…) with the Designer; the rest separately.
  assert.equal(subsets(latin.css).length, 2);
  assert.ok(subsets(latin.css).some((range) => range?.startsWith('U+0000-00FF')));
  assert.equal(subsets(other.css).length, 5, 'Greek, Greek Extended, Cyrillic, Cyrillic Extended, Vietnamese');
});
