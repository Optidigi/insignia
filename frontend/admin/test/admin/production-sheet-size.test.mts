import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatProductionMillimetres } from '../../src/shared/production-sheet.ts';

test('the production sheet shows configured millimetres as locale-formatted whole millimetres', () => {
  assert.equal(formatProductionMillimetres(107.221, 'nl'), '107');
  assert.equal(formatProductionMillimetres(107.5, 'en'), '108');
  assert.equal(formatProductionMillimetres(1234.4, 'de'), '1.234');
  assert.equal(formatProductionMillimetres(1234.4, 'en'), '1,234');
  assert.equal(formatProductionMillimetres(90, 'fr'), '90');
});
