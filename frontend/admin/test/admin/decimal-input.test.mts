import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalDecimalText,
  parseDecimalNumber,
} from '../../examples/admin/support/decimal-input.mts';
import { canonicalPriceText, parsePrice } from '../../examples/admin/support/method-workflow-prices.mts';

const minor = (text: string) => {
  const result = parsePrice(text);
  return result.kind === 'valid' ? result.minor : null;
};

test('a comma or a dot is the same decimal separator for prices, exactly in minor units', () => {
  assert.equal(minor('7,5'), 750n);
  assert.equal(minor('7.5'), 750n);
  assert.equal(minor('12,50'), 1250n);
  assert.equal(minor(' 12.05 '), 1205n);
  assert.equal(minor('0'), 0n);
  assert.equal(minor('99999,99'), 9_999_999n);
});

test('ambiguous or unreadable prices are rejected instead of becoming another amount', () => {
  for (const text of ['1.234,5', '1,234.50', '7,5,0', '7..5', '7,', ',5', '.5', '7a', 'abc', '1e3', '-1', '+1', '', ' ', '7,505', '100000'])
    assert.equal(minor(text), null, text);
});

test('canonical price text is exact two-decimal dot text, and invalid text is left for the error to show', () => {
  assert.equal(canonicalPriceText('7,5'), '7.50');
  assert.equal(canonicalPriceText('7.5'), '7.50');
  assert.equal(canonicalPriceText('12,50'), '12.50');
  assert.equal(canonicalPriceText('0'), '0.00');
  assert.equal(canonicalPriceText('1.234,5'), '1.234,5');
  assert.equal(canonicalPriceText(''), '');
});

test('general decimals share the separator rule and keep their exact value', () => {
  assert.equal(parseDecimalNumber('62,5'), 62.5);
  assert.equal(parseDecimalNumber('62.5'), 62.5);
  assert.equal(parseDecimalNumber('40'), 40);
  assert.equal(parseDecimalNumber('0,05'), 0.05);
  for (const text of ['1.234,5', '7,5,0', '1e3', 'abc', '-1', '', '.5', '5,'])
    assert.equal(parseDecimalNumber(text), null, text);
  assert.equal(canonicalDecimalText('62,5'), '62.5');
  assert.equal(canonicalDecimalText('62.5'), '62.5');
  assert.equal(canonicalDecimalText('1.234,5'), '1.234,5');
});
