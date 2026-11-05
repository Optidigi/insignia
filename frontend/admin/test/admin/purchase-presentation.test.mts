import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PurchaseListViewSchema, PurchaseOriginalDownloadSchema } from '../../src/shared/purchase-presentation.ts';

const list = { version: 'm8-purchase-list-v1', items: [], nextCursor: null };
const link = { url: 'https://assets.example.test/original', expiresAt: '2031-01-01T00:00:00.000Z' };

test('the UI accepts upstream lists without inventing a store time zone', () => {
  assert.equal(PurchaseListViewSchema.parse(list).timeZone, undefined);
  assert.equal(PurchaseListViewSchema.parse({ ...list, timeZone: 'Europe/Amsterdam' }).timeZone, 'Europe/Amsterdam');
  assert.throws(() => PurchaseListViewSchema.parse({ ...list, timeZone: 'not-a-zone' }));
});

test('archive preparation requires verified metadata instead of treating an ordinary URL as a file manifest', () => {
  assert.throws(() => PurchaseOriginalDownloadSchema.parse(link));
  const original = { ...link, sha256: 'a'.repeat(64), byteLength: 1024, contentType: 'image/png' };
  assert.equal(PurchaseOriginalDownloadSchema.parse(original).byteLength, 1024);
  assert.throws(() => PurchaseOriginalDownloadSchema.parse({ ...original, byteLength: -1 }));
  assert.throws(() => PurchaseOriginalDownloadSchema.parse({ ...original, contentType: 'text/html' }));
});
