import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDomainSource } from './domain-effects.mjs';

const rejected = [
  ['Date.now', 'export function helper() { return Date.now(); }', 'domain-no-implicit-clock'],
  ['new Date', 'export function helper() { return new Date(); }', 'domain-no-implicit-clock'],
  ['Math.random', 'export function helper() { return Math.random(); }', 'domain-no-implicit-random'],
  ['globalThis.Date.now', 'export function helper() { return globalThis.Date.now(); }', 'domain-no-implicit-clock'],
  ['fetch', 'export function helper(input: string) { return fetch(input); }', 'domain-no-ambient-api'],
  ['globalThis.crypto', 'export function helper() { return globalThis.crypto.randomUUID(); }', 'domain-no-ambient-api'],
  ['computed random', 'export function helper() { return Math["random"](); }', 'domain-no-implicit-random'],
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
