import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultNewSizeScale } from '../../examples/admin/support/placement-workflow-model.mts';

const sizes = (...scales: string[]) => scales.map((widthPercent) => ({ widthPercent }));

test('#442: a new size starts at half the smallest scale, as a whole percent', () => {
  assert.equal(defaultNewSizeScale(sizes('100')), '50');
  assert.equal(defaultNewSizeScale(sizes('100', '50')), '25');
  assert.equal(defaultNewSizeScale(sizes('100', '25')), '12');
  assert.equal(defaultNewSizeScale(sizes('12.5', '80')), '6');
});

test('#442: a new size never repeats a scale that is already in use', () => {
  assert.equal(defaultNewSizeScale(sizes('1')), '2');
  assert.equal(defaultNewSizeScale(sizes('1', '2', '3')), '4');
  assert.equal(defaultNewSizeScale(sizes('3', '1')), '2');
});

test('#442: without a readable scale the default is half of the artwork area', () => {
  assert.equal(defaultNewSizeScale([]), '50');
  assert.equal(defaultNewSizeScale(sizes('', 'abc')), '50');
});
