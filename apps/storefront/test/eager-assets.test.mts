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
    assert.ok(!/insignia-designer(?:-frame\.js|\.css)/.test(chunk?.code ?? ''), `${fileName} names no Designer asset`);
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

test('the Designer stylesheet references its Inter faces as separate files beside it instead of inlining them', async () => {
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
      .map((asset) => [asset.fileName, asset.source] as const),
  );
  const css = String(assets.get('insignia-designer.css') ?? '');
  assert.ok(css.length > 0, 'the stylesheet is built');
  assert.doesNotMatch(css, /url\(\s*['"]?data:/, 'no asset is inlined into the stylesheet');
  const fonts = [...css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)/g)].map((match) => match[1] ?? '');
  assert.equal(fonts.length, 7, 'every Inter subset face is referenced');
  for (const url of fonts) {
    // Relative to the stylesheet on the extension CDN: never the shop origin or the Designer's about:srcdoc.
    assert.match(url, /^\.\/insignia-font-inter-[a-z-]+-wght-normal\.woff2$/);
    assert.ok(assets.has(url.slice(2)), `${url} is emitted`);
  }
  assert.ok(assets.has('insignia-font-inter-latin-wght-normal.woff2'), 'the preloaded Latin face keeps its name');
  const gzip = gzipSync(css, { level: 9 }).length;
  console.log(`insignia-designer.css: ${css.length} raw / ${gzip} gzip bytes`);
  assert.ok(gzip <= 20 * 1024, `the Designer stylesheet is ${gzip} gzip bytes`);
});
