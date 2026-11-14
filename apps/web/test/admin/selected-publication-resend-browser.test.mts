import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { PUBLICATION_RESEND_VALIDITY_MS, PUBLICATION_STEP_MARGIN_MS } from '../../src/server/merchant-config.ts';
import { fixture, storedIntent } from './support/selected-browser.mts';

const progress = 'Publishing. This can take up to a minute; this page updates when it finishes.';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenExpiry = (authorization: string | undefined) => {
  const payload = authorization?.split('.')[1];
  assert.ok(payload, 'publish carries an expiring synthetic session token');
  const exp: unknown = JSON.parse(Buffer.from(payload, 'base64').toString()).exp;
  assert.equal(typeof exp, 'number');
  return Number(exp) * 1000;
};

/**
 * #468: the built editor publishes with App Bridge's caching (the current session token is returned
 * until it expires; only then is a new 60 s token issued). The synthetic server works in persisted
 * steps and, like the real one, stops between steps once less than PUBLICATION_STEP_MARGIN_MS of the
 * request's staff session remains, answering `resend`.
 */
async function timedPublication(t: TestContext, remainingMs: number, workMs: number) {
  const f = await fixture(t);
  await f.page.addInitScript(() => {
    let expiresAt = Date.now() + 60_000;
    const encode = (value: unknown) => btoa(JSON.stringify(value));
    window.shopify.idToken = async () => {
      if (Date.now() >= expiresAt) expiresAt = Date.now() + 60_000;
      return `synthetic-selected-token.${encode({ exp: expiresAt / 1000 })}.sig`;
    };
    window.syntheticTokenRemaining = (ms) => {
      expiresAt = Date.now() + ms;
    };
  });
  let workLeft = workMs;
  const publishes: { at: number; expiresAt: number; key: string | undefined }[] = [];
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || JSON.parse(request.postData() ?? '{}').action !== 'publish')
      return route.fallback();
    const expiresAt = tokenExpiry(request.headers().authorization);
    publishes.push({ at: Date.now(), expiresAt, key: request.headers()['idempotency-key'] });
    while (workLeft > 0) {
      if (expiresAt - Date.now() < PUBLICATION_STEP_MARGIN_MS)
        return route.fulfill({
          status: 202,
          json: {
            kind: 'resend',
            revisionId: 'revision-selected-111',
            minimumValidityMs: PUBLICATION_RESEND_VALIDITY_MS,
            message: 'Publication is still in progress.',
          },
        });
      const step = Math.min(250, workLeft);
      await sleep(step);
      workLeft -= step;
    }
    return route.fallback(); // The fixture records the accepted publication and serves it as ACTIVE.
  });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish', exact: true }).waitFor();
  await f.page.evaluate((ms) => window.syntheticTokenRemaining(ms), remainingMs);
  const clicked = Date.now();
  await modal.getByRole('button', { name: 'Publish', exact: true }).click();
  return { ...f, modal, publishes, clicked };
}
async function published(f: Awaited<ReturnType<typeof timedPublication>>) {
  await f.page.getByText('Published', { exact: true }).first().waitFor({ timeout: 90_000 });
  await f.modal.waitFor({ state: 'hidden' });
  assert.equal(await storedIntent(f.page), null, 'the publish custody settled');
  return Date.now() - f.clicked;
}

test('#468: publish is sent at once; a session ending mid-publish is resent as the same request with a new token', {
  timeout: 120_000,
}, async (t) => {
  const f = await timedPublication(t, 20_000, 12_000);
  const first = await (async () => {
    for (let waited = 0; f.publishes.length === 0 && waited < 15_000; waited += 100) await sleep(100);
    return f.publishes[0];
  })();
  assert.ok(first, 'the publish request was sent');
  assert.ok(
    first.at - f.clicked < 5_000,
    `the publish is sent without waiting for a long-lived token (${first.at - f.clicked} ms)`,
  );
  // While the server stops and the client waits for the next session token, the dialog keeps its progress.
  for (let waited = 0; f.publishes.length < 2 && waited < 30_000; waited += 100) {
    if (waited === 0 || waited % 1_000 === 0)
      assert.equal(await f.modal.getByText(progress, { exact: true }).count(), 1);
    await sleep(100);
  }
  const total = await published(f);
  assert.equal(f.publishes.length, 2, 'one resend');
  const [, second] = f.publishes;
  assert.ok(second);
  assert.equal(second.key, first.key, 'the resend is the same idempotent request');
  assert.ok(second.expiresAt > first.expiresAt, 'with a new session token');
  assert.ok(second.expiresAt - second.at >= PUBLICATION_RESEND_VALIDITY_MS);
  assert.ok(second.at - first.expiresAt < 3_000, 'immediately once the new token is available');
  assert.equal(await f.page.getByText(/could not be published/).count(), 0);
  t.diagnostic(`remaining 20 s, work 12 s: sent after ${first.at - f.clicked} ms, Published after ${total} ms`);
});

test('#468 measurement: click to publish sent and to Published by session-token age', {
  skip: process.env.INSIGNIA_PUBLISH_MEASURE !== '1',
  timeout: 600_000,
}, async (t) => {
  const work = Number(process.env.INSIGNIA_PUBLISH_WORK_MS ?? 12_000);
  for (const remaining of [5_000, 20_000, 45_000]) {
    const f = await timedPublication(t, remaining, work);
    const total = await published(f);
    const sent = f.publishes.map((entry) => entry.at - f.clicked).join('/');
    t.diagnostic(`MEASURE remaining=${remaining} work=${work} sent=${sent} published=${total}`);
  }
});
