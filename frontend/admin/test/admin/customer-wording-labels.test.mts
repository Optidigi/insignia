import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CUSTOMER_WORDING_MANIFEST } from '@insignia/ui-localization/customer';
import { customerWordingLabels } from '../../src/shared/customer-wording-labels.ts';

const labels: Readonly<Record<string, string>> = customerWordingLabels;

test('every editable customer message has a merchant field and section label in every shipped admin language', async () => {
  for (const locale of ['en', 'nl', 'de', 'fr', 'es', 'it']) {
    const settings = JSON.parse(
      await readFile(new URL(`../../../localization/src/catalogs/${locale}/settings.json`, import.meta.url), 'utf8'),
    );
    for (const entry of CUSTOMER_WORDING_MANIFEST) {
      const key = labels[entry.key];
      assert.ok(key, `${locale}: missing merchant field mapping for ${entry.key}`);
      assert.ok(key.startsWith('settings:translations.fields.'), `unexpected field namespace for ${entry.key}`);
      const field = key.slice('settings:translations.fields.'.length);
      assert.ok(
        typeof settings.translations.fields[field] === 'string' &&
          settings.translations.fields[field].trim().length > 0,
        `${locale}: missing field label ${field}`,
      );
      const section = entry.group.id.startsWith('common.') ? 'common' : entry.group.id.split('.')[1];
      assert.ok(
        section &&
          typeof settings.translations.groups[section] === 'string' &&
          settings.translations.groups[section].trim().length > 0,
        `${locale}: missing section label ${section}`,
      );
    }
  }
});
