import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingMoney, billingPercentage } from '../../src/shared/billing-display.ts';

const plain = (value: string) => value.replace(/\s/g, ' ');

test('billing money always shows the currency minor digits, exactly', () => {
  // Shopify returns development test terms as "0.0".
  assert.equal(plain(billingMoney('0.0', 'USD', 'en')), 'USD 0.00');
  assert.equal(plain(billingMoney('0', 'USD', 'en')), 'USD 0.00');
  assert.equal(plain(billingMoney('49.99', 'USD', 'en')), 'USD 49.99');
  assert.equal(plain(billingMoney('49.9', 'EUR', 'en')), 'EUR 49.90');
  assert.equal(plain(billingMoney('0.125', 'USD', 'en')), 'USD 0.125', 'extra provider digits stay exact');
  assert.equal(plain(billingMoney('0.0', 'EUR', 'nl')), 'EUR 0,00');
});

test('billing percentages keep the provider digits', () => {
  assert.equal(plain(billingPercentage('20', 'en')), '20%');
  assert.equal(plain(billingPercentage('12.5', 'en')), '12.5%');
});
