import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { MerchantDraftSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { required } from './support/fixtures.mts';
import { draft, fixture, hostSave, imageUrl } from './support/selected-browser.mts';

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
  await f.page
    .locator(`:is(s-number-field, s-text-field)[name="${name}"]`)
    .evaluate((field: HTMLInputElement, next) => {
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

const redImageUrl = 'https://cdn.shopify.com/synthetic-selected/hoodie-red-front.jpg';
const navyKey = JSON.stringify([['colour', 'Navy']]);
const redKey = JSON.stringify([['colour', 'Red']]);
const redImage = { id: 'image_2', url: redImageUrl, width: 1000, height: 1000, alt: 'Red hoodie' };

/** Front is uncalibrated and has a Red appearance whose own photo differs from the base view image (#454). */
function appearanceDraft() {
  const value = structuredClone(draft);
  const setup = required(value.selectedSetup);
  const { calibration, ...uncalibratedFront } = required(setup.product.views[0]);
  assert.ok(calibration);
  setup.product.views = [uncalibratedFront];
  setup.product.images = [...setup.product.images, redImage];
  setup.product.variantPhotos = {
    options: [{ id: 'colour', name: 'Colour', values: ['Navy', 'Red'].map((label) => ({ id: label, label })) }],
    variants: ['Navy', 'Red'].map((colour, index) => ({
      id: `gid://shopify/ProductVariant/${index + 1}`,
      label: colour,
      optionValues: { colour },
    })),
    groupingOptionIds: ['colour'],
    assignments: [
      { groupKey: navyKey, viewId: 'front', useShared: true },
      { groupKey: redKey, viewId: 'front', imageId: redImage.id },
    ],
  };
  return MerchantDraftSchema.parse(value);
}

/** A solid red PNG: unmistakable next to the base hoodie photograph. */
function redPng() {
  const width = 8;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 4).map((_, index) => (index % 4 === 0 || index % 4 === 3 ? 255 : 0)),
  ]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: width }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Share of clearly red pixels on the painted canvas: the appearance photo is red, the base photo is not. */
async function redShare(page: Page) {
  const shot = await page.locator('.placement-canvas canvas').first().screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let red = 0;
    for (let index = 0; index < data.length; index += 4)
      if ((data[index] ?? 0) > 180 && (data[index + 1] ?? 255) < 70 && (data[index + 2] ?? 255) < 70) red++;
    return red / (data.length / 4);
  }, shot.toString('base64'));
}
async function waitForRedShare(page: Page, test: (share: number) => boolean, message: string) {
  const deadline = Date.now() + 8000;
  let share = Number.NaN;
  while (Date.now() < deadline) {
    share = await redShare(page);
    if (test(share)) return;
    await page.waitForTimeout(150);
  }
  assert.fail(`${message} (red share ${share})`);
}

test('#454: Calibrate image in the publish checklist measures the base image, not the active appearance photo', {
  timeout: 45000,
}, async (t) => {
  const f = await fixture(t, { initialDraft: appearanceDraft() });
  await f.page.route(redImageUrl, (route) =>
    route.fulfill({ body: redPng(), contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await f.page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const view = f.view();
    return route.fulfill({
      json: {
        ...view,
        product: {
          ...view.product,
          images: [...required(view.product.images), redImage],
          options: [{ id: 'colour', name: 'Colour', values: ['Navy', 'Red'] }],
          variants: ['Navy', 'Red'].map((colour, index) => ({
            id: `gid://shopify/ProductVariant/${index + 1}`,
            title: colour,
            imageUrl: null,
            selectedOptions: [{ name: 'Colour', value: colour }],
          })),
        },
      },
    });
  });
  await f.open();
  // Choose the Red appearance: the canvas now shows its own photo.
  await f.page.locator('.variant-photo-selector s-select').evaluate((select: HTMLSelectElement, key) => {
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, redKey);
  await waitForRedShare(f.page, (share) => share > 0.3, 'The Red appearance photo is shown');
  await (await checklistListsCalibration(f)).click();
  await f.page.getByText('Choose two points along a length you know.').waitFor();
  await waitForRedShare(
    f.page,
    (share) => share < 0.02,
    'Measuring shows the base image, not the Red appearance photo',
  );
  await drawAndApply(f);
  // The calibration the merchant measured is the one stored, on the base view image.
  await hostSave(f.page);
  const deadline = Date.now() + 8000;
  const stored = () => required(f.read().selectedSetup).product.views[0]?.calibration;
  while (!stored() && Date.now() < deadline) await f.page.waitForTimeout(100);
  assert.equal(stored()?.imageUrl, imageUrl);
  assert.equal(stored()?.distanceCm, 40);
});
