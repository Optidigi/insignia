import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

// The German brief addresses merchants and buyers formally (Sie) in every catalog.
const germanCatalogs = new URL('../src/catalogs/de/', import.meta.url);
const informal = /\b(du|dich|dir|dein(e|en|em|er|es)?)\b/i;

function messages(value: unknown, prefix: string): [string, string][] {
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`;
    return typeof child === 'string' ? [[path, child] as [string, string]] : messages(child, path);
  });
}

test('every German catalog addresses the reader formally (Sie)', async () => {
  const files = (await readdir(germanCatalogs)).filter((file) => file.endsWith('.json'));
  assert.ok(files.length > 0, 'no German catalogs found');
  const offending = [];
  for (const file of files) {
    const catalog: unknown = JSON.parse(await readFile(new URL(file, germanCatalogs), 'utf8'));
    offending.push(...messages(catalog, file.replace(/\.json$/, '')).filter(([, text]) => informal.test(text)));
  }
  assert.deepEqual(offending, []);
});
