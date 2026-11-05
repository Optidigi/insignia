import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalog } from './catalog-source.mts';

test('catalog parsing rejects repeated keys instead of silently replacing a message', () => {
  assert.throws(() => parseCatalog('{"guide":{"hide":"Hide guide","hide":"Hide"}}'), /duplicate.*guide.hide/i);
  assert.deepEqual(parseCatalog('{"guide":{"hide":"Hide guide"},"dialog":{"hide":"Hide"}}'), {
    guide: { hide: 'Hide guide' },
    dialog: { hide: 'Hide' },
  });
});

test('catalog parsing rejects obsolete plural suffixes that i18next would treat as ordinary keys', () => {
  assert.throws(
    () => parseCatalog('{"items":"{{count}} item","items_plural":"{{count}} items"}'),
    /legacy plural.*items_plural/i,
  );
  assert.deepEqual(parseCatalog('{"items_one":"{{count}} item","items_other":"{{count}} items"}'), {
    items_one: '{{count}} item',
    items_other: '{{count}} items',
  });
});
