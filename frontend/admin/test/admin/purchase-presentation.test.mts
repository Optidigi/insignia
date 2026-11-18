import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  artworkDeletionWarning,
  formatShopDateTime,
  PurchaseListViewSchema,
  PurchaseOriginalDownloadSchema,
  purchasedVariantLabel,
} from '../../src/shared/purchase-presentation.ts';

test('order times show in the shop time zone with its label, or labelled UTC when the zone is unknown', () => {
  const created = '2026-11-16T21:46:00.000Z';
  const utc = (date: string) => `${date} UTC`;
  // ICU versions differ in which space they put before AM/PM.
  const shown = (...args: Parameters<typeof formatShopDateTime>) => formatShopDateTime(...args).replace(/\s/g, ' ');
  // The Orders list and the order detail share this one format, so one order shows one time.
  assert.equal(shown('en-US', created, 'America/New_York', utc), 'Nov 16, 2026, 04:46 PM EST');
  assert.equal(shown('en-GB', created, 'Europe/Amsterdam', utc), '16 Nov 2026, 22:46 CET');
  assert.equal(shown('en-US', created, undefined, utc), 'Nov 16, 2026, 9:46 PM UTC');
});

test('deletion warnings start 30 days before an order’s artwork is deleted and turn urgent at 7 (spec §10.4)', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const inDays = (days: number) => new Date(now + days * 86400000).toISOString();
  assert.equal(artworkDeletionWarning(inDays(180), now), null);
  assert.equal(artworkDeletionWarning(inDays(30.01), now), null);
  assert.equal(artworkDeletionWarning(inDays(30), now), 'warning');
  assert.equal(artworkDeletionWarning(inDays(7.01), now), 'warning');
  assert.equal(artworkDeletionWarning(inDays(7), now), 'critical');
  assert.equal(artworkDeletionWarning(inDays(0.5), now), 'critical');
  assert.equal(artworkDeletionWarning(inDays(0), now), null);
});

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

test('a resolved single-variant line shows no variant label; only a failed lookup says unavailable', () => {
  const unavailable = 'Variant name unavailable';
  assert.equal(purchasedVariantLabel({ title: 'Shirt', variantTitle: 'Blue / M' }, unavailable), 'Blue / M');
  // Shopify gives no variant title for a product's only ("Default Title") variant.
  assert.equal(purchasedVariantLabel({ title: 'Shirt', variantTitle: null }, unavailable), null);
  assert.equal(purchasedVariantLabel({ title: 'Shirt' }, unavailable), null);
  assert.equal(purchasedVariantLabel({ title: null, variantTitle: null }, unavailable), unavailable);
  assert.equal(purchasedVariantLabel(undefined, unavailable), unavailable);
});
