import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { consumerCases } from './consumer-cases.ts';

test('publisher remote states match the source-bound Rust consumer fixture', async () => {
  const fixture = await readFile(new URL('../fixtures/consumer-projection.tsv', import.meta.url), 'utf8');
  assert.equal(await consumerCases(), fixture);
});
