import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import { required } from './support/fixtures.mts';
import { draft, fixture, imageUrl } from './support/selected-browser.mts';

// Scope: real built merchant UI/Polaris in an isolated browser with synthetic provider HTTP (issue #443).
// These are not native Shopify observations.

/** Front is uncalibrated (the publish checklist asks for it); Back is complete and is the selected view. */
function twoViewDraft() {
  const value = structuredClone(draft);
  const setup = required(value.selectedSetup);
  const front = required(setup.product.views[0]);
  const { calibration, ...uncalibratedFront } = front;
  assert.ok(calibration);
  setup.product.views = [
    uncalibratedFront,
    { id: 'back', name: 'Back', imageUrl, imageWidth: 1000, imageHeight: 1000, calibration, placements: [] },
  ];
  const geometry = value.geometry as { views: unknown[] };
  value.geometry = {
    ...geometry,
    views: [
      ...geometry.views,
      {
        id: 'back',
        image: { revisionId: 'product_111', width: 1000, height: 1000 },
        variantImages: [],
        placements: [],
      },
    ],
  };
  value.labels = { ...required(value.labels), views: { front: 'Front', back: 'Back' } };
  return MerchantDraftSchema.parse(value);
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function clickPublish(f: Fixture) {
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
}

async function setField(f: Fixture, name: string, value: string) {
  await f.page.locator(`s-number-field[name="${name}"]`).evaluate((field: HTMLInputElement, next) => {
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function drawAndApply(f: Fixture) {
  await f.page.getByText('Enter point coordinates').first().click();
  await setField(f, 'measurement-a-x', '10');
  await setField(f, 'measurement-a-y', '10');
  await setField(f, 'measurement-b-x', '60');
  await setField(f, 'measurement-b-y', '10');
  await setField(f, 'reference-length', '40');
  await f.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await f.page.locator('.placement-measure-controls').waitFor({ state: 'detached' });
}

async function checklistListsCalibration(f: Fixture) {
  await clickPublish(f);
  const checklist = f.page.locator('s-modal').filter({ hasText: 'Finish setup' });
  await checklist.waitFor({ state: 'visible' });
  return checklist.getByRole('button', { name: 'Calibrate image', exact: true });
}

test('calibrating another view from the publish checklist applies to that view', {
  timeout: 40000,
}, async (t) => {
  const f = await fixture(t, { initialDraft: twoViewDraft() });
  await f.open();
  await f.page.locator('#placement-outline').getByText('Back', { exact: true }).first().click();
  assert.equal(await f.page.getByRole('textbox', { name: /^View name/ }).inputValue(), 'Back');
  const calibrate = await checklistListsCalibration(f);
  assert.equal(await calibrate.count(), 1, 'Only the uncalibrated Front view is listed');
  await calibrate.click();
  assert.equal(await f.page.getByRole('textbox', { name: /^View name/ }).inputValue(), 'Front');
  await drawAndApply(f);
  assert.equal(await (await checklistListsCalibration(f)).count(), 0, 'Front is calibrated after Apply');
});

test('calibration started from the canvas still applies to the selected view', {
  timeout: 40000,
}, async (t) => {
  const f = await fixture(t, { initialDraft: twoViewDraft() });
  await f.open();
  await f.page.getByRole('button', { name: 'Measure image', exact: true }).click();
  await drawAndApply(f);
  assert.equal(await (await checklistListsCalibration(f)).count(), 0, 'Front is calibrated after Apply');
});
