import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSupportedLanguages, validateTargetCatalogs } from './validate-target-catalogs.mts';

test('reads advertised catalog locales from the exported runtime registry', () => {
  assert.deepEqual(
    parseSupportedLanguages("export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'nl', 'fr'] as const);"),
    ['en', 'nl', 'fr'],
  );
});

test('accepts locale-required plural forms using the matching English form contract', () => {
  const sourceCatalogs = new Map([
    [
      'common',
      {
        greeting: 'Hello {{name}}',
        items_one: 'One item',
        items_other: '{{count}} items',
      },
    ],
  ]);
  const targetCatalogs = new Map([
    [
      'common',
      {
        greeting: 'Bonjour {{name}}',
        items_one: 'Un article',
        items_many: '{{count}} articles',
        items_other: '{{count}} articles',
      },
    ],
  ]);

  assert.deepEqual(validateTargetCatalogs({ locale: 'fr', sourceCatalogs, targetCatalogs }), []);
});

test('checks every target plural form against its matching English form or English other fallback', () => {
  const sourceCatalogs = new Map([
    [
      'common',
      {
        items_one: 'One item',
        items_other: '{{count}} items',
      },
    ],
  ]);
  const targetCatalogs = new Map([
    [
      'common',
      {
        items_one: '{{count}} article',
        items_many: '{{wrong}} articles',
        items_other: '{{count}} articles',
      },
    ],
  ]);

  assert.deepEqual(
    validateTargetCatalogs({ locale: 'fr', sourceCatalogs, targetCatalogs }).map(({ key, code }) => [key, code]),
    [
      ['items_many', 'parameter-mismatch'],
      ['items_one', 'parameter-mismatch'],
    ],
  );
});

test('reports incomplete coverage and unsafe target message content', () => {
  const sourceCatalogs = new Map([
    [
      'common',
      {
        greeting: 'Hello {{name}}',
        items_one: 'One item',
        items_other: '{{count}} items',
        save: 'Save',
      },
    ],
    ['customer', { start: 'Start' }],
  ]);
  const targetCatalogs = new Map([
    [
      'common',
      {
        greeting: '  ',
        items_one: '<b>Un article</b>',
        items_other: 'Articles {{ count, plural }}',
        extra: 'Extra',
      },
    ],
    ['unknown', { extra: 'Unknown namespace' }],
  ]);

  const issues = validateTargetCatalogs({ locale: 'nl', sourceCatalogs, targetCatalogs });
  assert.deepEqual(
    issues.map(({ namespace, key, code }) => [namespace, key, code]),
    [
      ['common', 'extra', 'unknown-message'],
      ['common', 'greeting', 'blank-message'],
      ['common', 'items_one', 'markup'],
      ['common', 'items_other', 'invalid-placeholder'],
      ['common', 'save', 'missing-message'],
      ['customer', '<namespace>', 'missing-namespace'],
      ['unknown', '<namespace>', 'unknown-namespace'],
    ],
  );
});

test('requires Intl plural categories while allowing the i18next zero override', () => {
  const sourceCatalogs = new Map([['common', { items_one: 'One item', items_other: '{{count}} items' }]]);
  const targetCatalogs = new Map([
    [
      'common',
      {
        items_one: 'Un article',
        items_other: '{{count}} articles',
        items_zero: '{{count}} aucun article',
      },
    ],
  ]);

  assert.deepEqual(
    validateTargetCatalogs({ locale: 'fr', sourceCatalogs, targetCatalogs }).map(({ key, code }) => [key, code]),
    [['items', 'missing-plural-form']],
  );
});

test('keeps placeholder occurrences compatible with editable customer wording defaults', () => {
  const sourceCatalogs = new Map([['common', { named: '{{name}}: {{amount}}' }]]);
  const reordered = new Map([['common', { named: '{{amount}} für {{name}}' }]]);
  const duplicated = new Map([['common', { named: '{{amount}} für {{name}} ({{name}})' }]]);
  assert.deepEqual(validateTargetCatalogs({ locale: 'de', sourceCatalogs, targetCatalogs: reordered }), []);
  assert.deepEqual(
    validateTargetCatalogs({ locale: 'de', sourceCatalogs, targetCatalogs: duplicated }).map(({ code }) => code),
    ['parameter-mismatch'],
  );
});

test('preserves source grouping placeholders without accepting missing messages or unknown empty groups', () => {
  const sourceCatalogs = new Map([['common', { unusedGroup: {}, active: { save: 'Save' } }]]);
  assert.deepEqual(
    validateTargetCatalogs({
      locale: 'de',
      sourceCatalogs,
      targetCatalogs: new Map([['common', { unusedGroup: {}, active: { save: 'Speichern' } }]]),
    }),
    [],
  );
  const issues = validateTargetCatalogs({
    locale: 'de',
    sourceCatalogs,
    targetCatalogs: new Map([['common', { unusedGroup: {}, active: {}, inventedGroup: {} }]]),
  });
  assert.deepEqual(
    issues.map(({ key, code }) => [key, code]),
    [
      ['active.save', 'missing-message'],
      ['inventedGroup', 'unknown-message'],
    ],
  );
});
