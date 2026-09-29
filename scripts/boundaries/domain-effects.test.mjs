import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compiledDomainFiles, inspectDomainSource } from './domain-effects.mjs';

const rejected = [
  ['Date.now', 'export function helper() { return Date.now(); }', 'domain-no-implicit-clock'],
  ['new Date', 'export function helper() { return new Date(); }', 'domain-no-implicit-clock'],
  ['Math.random', 'export function helper() { return Math.random(); }', 'domain-no-implicit-random'],
  ['globalThis.Date.now', 'export function helper() { return globalThis.Date.now(); }', 'domain-no-implicit-clock'],
  ['fetch', 'export function helper(input: string) { return fetch(input); }', 'domain-no-ambient-api'],
  ['globalThis.crypto', 'export function helper() { return globalThis.crypto.randomUUID(); }', 'domain-no-ambient-api'],
  ['computed random', 'export function helper() { return Math["random"](); }', 'domain-no-implicit-random'],
  ['template random', 'export function helper() { return Math[`random`](); }', 'domain-no-implicit-random'],
  [
    'dynamic Math member',
    "export function helper() { const key = 'random' as const; return Math[key](); }",
    'domain-no-dynamic-math',
  ],
  ['spread Date', 'export function helper() { return new Date(...([] as const)); }', 'domain-no-implicit-clock'],
  [
    'random destructuring',
    'export function helper() { const {random} = Math; return random(); }',
    'domain-no-implicit-random',
  ],
  ['date alias', 'export function helper() { const clock = Date; return clock.now(); }', 'domain-no-date-alias'],
  ['math alias', 'export function helper() { const random = Math; return random.random(); }', 'domain-no-math-alias'],
  ['import meta', 'export function helper() { return import.meta.env; }', 'domain-no-ambient-api'],
  ['process environment', 'export function helper() { return process.env.NODE_ENV; }', 'domain-no-ambient-api'],
];

for (const [name, source, rule] of rejected) {
  test(`${name} is rejected in a production domain helper`, () => {
    assert.ok(inspectDomainSource(source).some((diagnostic) => diagnostic.rule === rule));
  });
}

test('deterministic numeric and explicit-value operations stay allowed', () => {
  const source = `
    export function deterministic(input: string, instant: string) {
      const rounded = Math.floor(Number(input));
      return [BigInt(rounded), Date.parse(instant), new Date(instant).getTime()];
    }
    export const mentioned = 'Date.now() and Math.random() are inert text';
  `;
  assert.deepEqual(inspectDomainSource(source), []);
});

test('type-only properties are not ambient API references', () => {
  assert.deepEqual(inspectDomainSource('export type Shape = { fetch: string; Date: string; Math: number };'), []);
});

test('compiled graph includes an imported module with an excluded test-like filename', () => {
  const directory = mkdtempSync(join(tmpdir(), 'insignia-domain-graph-'));
  try {
    const source = join(directory, 'src');
    mkdirSync(source);
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022' },
        include: ['src/main.ts'],
        exclude: ['src/**/*.test.ts'],
      }),
    );
    writeFileSync(join(source, 'main.ts'), "import { clock } from './helper.test.js'; export const value = clock();");
    writeFileSync(join(source, 'helper.test.ts'), 'export function clock() { return Date.now(); }');
    const files = compiledDomainFiles(join(directory, 'tsconfig.json'), source);
    const imported = files.find((file) => file.fileName.endsWith('helper.test.ts'));
    assert.ok(imported, 'imported test-like module must be scanned');
    assert.ok(inspectDomainSource(imported.text).some(({ rule }) => rule === 'domain-no-implicit-clock'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
