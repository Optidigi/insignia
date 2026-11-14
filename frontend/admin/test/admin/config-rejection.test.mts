import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminTranslator } from '@insignia/ui-localization/admin';
import { CONFIG_REJECTION_CODES } from '../../../../apps/web/src/shared/config-rejection.ts';
import {
  configRejectionFrom,
  configRejectionNeedsReload,
  configRejectionText,
} from '../../src/shared/config-rejection.ts';

const languages = ['en', 'nl', 'de', 'fr', 'es', 'it'] as const;
const rejected = (extra: object) => Object.assign(new Error('Review the configuration validation errors.'), { status: 422, ...extra });

test('only a 422 is a rejection; lost, throttled, unavailable and conflicting writes are not', () => {
  for (const status of [400, 401, 403, 409, 429, 500, 503])
    assert.equal(configRejectionFrom(Object.assign(new Error('x'), { status, code: 'SETUP_SIZE_INVALID' })), null);
  for (const lost of [new Error('Admin request timed out'), new TypeError('Failed to fetch'), null, undefined, 'x'])
    assert.equal(configRejectionFrom(lost), null);
});

test('a rejection carries the server code, the first field issue and its path', () => {
  assert.deepEqual(
    configRejectionFrom(
      rejected({
        code: 'DRAFT_SCHEMA_INVALID',
        validationIssues: [
          { path: 'selectedSetup.product.views.0.name', message: 'Too short' },
          { path: 'other', message: 'Ignored' },
        ],
      }),
    ),
    { code: 'DRAFT_SCHEMA_INVALID', reason: 'Too short', path: 'selectedSetup.product.views.0.name' },
  );
  assert.deepEqual(configRejectionFrom(rejected({ code: 'SETUP_SIZE_INVALID' })), {
    code: 'SETUP_SIZE_INVALID',
    reason: 'Review the configuration validation errors.',
    path: null,
  });
});

test('a code this page does not know is still a rejection, without a code', () => {
  assert.deepEqual(configRejectionFrom(rejected({ code: 'FROM_A_NEWER_SERVER' })), {
    code: null,
    reason: 'Review the configuration validation errors.',
    path: null,
  });
  assert.equal(configRejectionFrom(rejected({ code: 42, validationIssues: 'x' }))?.code, null);
});

test('only rejections caused by state that moved after the draft was made ask for a reload', () => {
  const reloading = CONFIG_REJECTION_CODES.filter((code) => configRejectionNeedsReload({ code, reason: '', path: null }));
  assert.deepEqual(
    [...reloading].sort(),
    ['MEDIA_URL_NOT_CANONICAL', 'METHOD_LINKS_CHANGED', 'PRODUCT_IDENTITY_CHANGED', 'SHOP_CURRENCY_CHANGED'],
  );
  assert.equal(configRejectionNeedsReload({ code: null, reason: '', path: null }), false);
});

for (const language of languages)
  test(`${language}: every code the server can send reads as a rejection, never as a lost request`, () => {
    const { t } = createAdminTranslator(language);
    const lost = t('editor:placementWorkflowPreview.realSaveFailed');
    for (const code of [...CONFIG_REJECTION_CODES, null]) {
      const text = configRejectionText({ code, reason: 'Server reason', path: 'selectedSetup.field' }, t);
      assert.ok(text.length > 20, `${code}: ${text}`);
      assert.notEqual(text, lost, `${code} must not claim the write is unconfirmed`);
      assert.doesNotMatch(text, /\{\{|\}\}/, `${code} leaves a placeholder unfilled`);
    }
  });

test('en: merchant-actionable codes name what to fix and the generic fallback shows the server reason', () => {
  const { t } = createAdminTranslator('en');
  const say = (code: (typeof CONFIG_REJECTION_CODES)[number] | null, path: string | null = null) =>
    configRejectionText({ code, reason: 'The server reason', path }, t);
  assert.equal(
    say('DRAFT_SCHEMA_INVALID', 'selectedSetup.product.title'),
    'A value in this setup isn’t valid (selectedSetup.product.title). Correct it, then save again.',
  );
  assert.equal(say('DRAFT_SCHEMA_INVALID'), 'This change can’t be saved: The server reason', 'No path, no field claim');
  assert.equal(say('PUBLICATION_INCOMPLETE'), 'This setup isn’t ready to publish: The server reason');
  assert.equal(say('CONFIG_POLICY_INVALID'), 'This change can’t be saved: The server reason');
  assert.equal(say(null), 'This change can’t be saved: The server reason');
  for (const code of ['SHOP_CURRENCY_CHANGED', 'METHOD_LINKS_CHANGED', 'PRODUCT_IDENTITY_CHANGED', 'MEDIA_URL_NOT_CANONICAL'] as const)
    assert.match(say(code), /Reloading discards the changes you have not saved\.$/);
  const specific = new Set(
    (
      [
        'DRAFT_SCHEMA_INVALID',
        'SETUP_CAPACITY_EXCEEDED',
        'SETUP_MEDIA_NOT_OWNED',
        'SETUP_SIZE_INVALID',
        'PRICE_AMOUNT_INVALID',
        'LEAN_PRICING_INVALID',
        'GEOMETRY_INVALID',
        'SHOP_CURRENCY_CHANGED',
        'METHOD_LINKS_CHANGED',
        'PRODUCT_IDENTITY_CHANGED',
        'MEDIA_URL_NOT_CANONICAL',
        'PUBLICATION_INCOMPLETE',
      ] as const
    ).map((code) => say(code, 'selectedSetup.field')),
  );
  assert.equal(specific.size, 12, 'Each actionable code has its own wording');
});
