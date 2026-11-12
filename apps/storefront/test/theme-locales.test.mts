import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Buyer-facing storefront copy shipped with the theme app extension.
const localesDirectory = new URL('../../../extensions/insignia-theme/locales/', import.meta.url);

function messages(value: unknown, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') leaves.set(path, child);
    else for (const [leafPath, leaf] of messages(child, path)) leaves.set(leafPath, leaf);
  }
  return leaves;
}

async function catalog(file: string): Promise<Map<string, string>> {
  return messages(JSON.parse(await readFile(new URL(file, localesDirectory), 'utf8')));
}

test('every theme storefront locale has exactly the English keys', async () => {
  const source = [...(await catalog('en.default.json')).keys()].sort();
  const files = (await readdir(localesDirectory)).filter((file) => file.endsWith('.json') && !file.includes('schema'));
  for (const file of files) assert.deepEqual([...(await catalog(file)).keys()].sort(), source, file);
});

test('German theme storefront copy addresses the buyer formally (Sie)', async () => {
  const informal = /\b(du|dich|dir|dein(e|en|em|er|es)?)\b/i;
  const offending = [...(await catalog('de.json'))].filter(([, text]) => informal.test(text));
  assert.deepEqual(offending, []);
});
