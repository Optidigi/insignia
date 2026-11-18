import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  const eagerBytes = [...eager].reduce((sum, fileName) => sum + (chunks.get(fileName)?.code.length ?? 0), 0);
  console.log(`eager theme embed chunks: ${[...eager].sort().join(', ')} (${eagerBytes} bytes)`);
});
