import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type { ChildProcess } from "node:child_process";
import type { DesignerQuoteReview } from "../src/quote-review";



const root = fileURLToPath(new URL("../", import.meta.url));
const port = 4187;
const origin = `http://127.0.0.1:${port}`;
let vite: ChildProcess | undefined;
let browser: Browser;

before(async () => {
  vite = spawn(process.execPath, [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--force",
  ], { cwd: root, stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${origin}/scripts/fixtures/customer-localization.html`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The local Vite server has not opened its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "local Vite fixture should start");
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  vite?.kill("SIGTERM");
});

async function openFixture({ width = 390, height = 844, colorScheme = "light" } = {} as { width?: number; height?: number; colorScheme?: "light" | "dark" }) {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme,
  });
  await page.goto(`${origin}/scripts/fixtures/customer-localization.html`);
  await page.locator(".app").waitFor();
  await page.waitForFunction(() => Boolean(window.__customerLocalizationTest));
  return page;
}

async function setLocale(page: Page, locale: string) {
  await page.evaluate((value) => window.__customerLocalizationTest.setLocale(value), locale);
  await page.waitForFunction((value) => document.querySelector(".app")?.getAttribute("lang") === value, locale);
}

test("changing language while editing keeps focus, invalid input, and translated validation", async () => {
  const page = await openFixture();
  try {
    const quantity = page.locator("#quantity-white-small");
    await page.locator(".steps button").nth(1).click();
    await quantity.waitFor();
    await quantity.fill("1001");
    assert.equal(await quantity.getAttribute("aria-invalid"), "true");
    await quantity.focus();

    await setLocale(page, "en-XA");
    assert.equal(await quantity.inputValue(), "1001");
    assert.equal(await quantity.evaluate((input) => input === document.activeElement), true);
    assert.notEqual(
      await page.locator(".quantity-error").innerText(),
      "Use whole numbers from 0 to 999.",
      "validation text should render from the active catalog after the locale changes",
    );
  } finally {
    await page.close();
  }
});

test("the customer language picker retains edits, persists choices, and resets to the full host locale", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${origin}/?scenario=classic&example=accordion&locale=de-CH`);
    await page.locator(".app").waitFor();
    const picker = page.locator("#customer-language");
    await picker.waitFor();
    assert.equal(await picker.inputValue(), "");
    assert.ok(await picker.getAttribute("aria-label"));
    assert.equal(await page.locator("html").getAttribute("lang"), "en");

    await page.locator(".steps button").nth(1).click();
    const quantity = page.locator('input[type="number"]:enabled').first();
    await quantity.fill("3");
    await page.locator(".app").evaluate((node) => { node.dataset.localeIdentity = "retained-design"; });
    await picker.selectOption("it");
    await page.locator('.app[lang="it"]').waitFor();
    assert.equal(await picker.inputValue(), "it");
    assert.equal(await page.locator(".app").getAttribute("data-locale-identity"), "retained-design");
    assert.equal(await page.locator(".app").getAttribute("data-step"), "1");
    assert.equal(await quantity.inputValue(), "3");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.evaluate(() => localStorage.getItem("insignia.customer.language.v1")), "it");

    await page.reload();
    await page.locator('.app[lang="it"]').waitFor();
    assert.equal(await page.locator("#customer-language").inputValue(), "it");
    await page.locator("#customer-language").selectOption("");
    await page.locator('.app[lang="de"]').waitFor();
    assert.equal(await page.locator("#customer-language").inputValue(), "");
    assert.equal(await page.evaluate(() => localStorage.getItem("insignia.customer.language.v1")), null);
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
  } finally {
    await page.close();
  }
});

test("language picker uses the exact customer wording locale and a 44px mobile target", async () => {
  const page = await openFixture({ width: 320, colorScheme: "dark" });
  try {
    const picker = page.locator("#customer-language");
    await page.evaluate(() => window.__customerLocalizationTest.setWordingOverlay({
      locale: "en",
      messages: { "customer:steps.quantities": { message: "Merchant quantity heading" } },
    }));
    await page.getByText("Merchant quantity heading").waitFor();
    await picker.selectOption("nl");
    await page.locator('.app[lang="nl"]').waitFor();
    assert.notEqual(await page.locator(".steps button").nth(1).innerText(), "Merchant quantity heading");
    await picker.selectOption("");
    await page.getByText("Merchant quantity heading").waitFor();
    await page.waitForFunction(() => window.__customerLocalizationTest.languagePreferenceChanges().length === 2);
    assert.deepEqual(
      await page.evaluate(() => window.__customerLocalizationTest.languagePreferenceChanges()),
      ["nl", null],
    );
    const geometry = await picker.evaluate((select) => {
      const rect = select.getBoundingClientRect();
      const target = select.closest(".language-picker")!.getBoundingClientRect();
      return { width: rect.width, height: rect.height, targetWidth: target.width, targetHeight: target.height };
    });
    assert.ok(geometry.width >= 44 && geometry.height >= 44, `native picker target is too small: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.targetWidth >= 44 && geometry.targetHeight >= 44, `visible picker target is too small: ${JSON.stringify(geometry)}`);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await page.evaluate(() => {
        const product = document.querySelector(".header-product")!.getBoundingClientRect();
        const actions = document.querySelector(".header-actions")!.getBoundingClientRect();
        const steps = document.querySelector(".steps")!;
        return {
          productRight: product.right,
          actionsLeft: actions.left,
          stepsClient: steps.clientWidth,
          stepsScroll: steps.scrollWidth,
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
        };
      });
      assert.ok(bounds.productRight <= bounds.actionsLeft + 1, `${width}px product title region overlaps header actions: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.stepsScroll <= bounds.stepsClient + 1, `${width}px step navigation overflows: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.document <= bounds.viewport, `${width}px document overflows: ${JSON.stringify(bounds)}`);
    }
  } finally {
    await page.close();
  }
});

test("language change failure stays visible and recoverable at 320px in both themes", async () => {
  const output = fileURLToPath(new URL("../../../.m1-artifacts/frontend/customer-language/", import.meta.url));
  await mkdir(output, { recursive: true });
  for (const colorScheme of ["light", "dark"] as const) {
    const page = await openFixture({ width: 320, colorScheme });
    try {
      await page.evaluate(() => window.__customerLocalizationTest.setWordingOverlay({
        locale: "en",
        messages: { "customer:steps.quantities": { message: "Incomplete {{missing}}" } },
      }));
      const failure = page.locator(".language-picker-error");
      await failure.waitFor();
      assert.equal(await failure.innerText(), "Language couldn’t be changed. Try again.");
      const bounds = await failure.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= 320, `${colorScheme} failure notice exceeds viewport: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.width > 0 && bounds.bottom > bounds.top, `${colorScheme} failure notice is not visible: ${JSON.stringify(bounds)}`);
      await page.screenshot({ path: `${output}failure-320-${colorScheme}.png`, animations: "disabled" });

      await page.locator("#customer-language").selectOption("de");
      await page.locator('.app[lang="de"]').waitFor();
      await failure.waitFor({ state: "hidden" });
    } finally {
      await page.close();
    }
  }
});

test("a blocked language-preference write keeps the selection for the mounted session", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && key === "insignia.customer.language.v1") {
        throw new DOMException("Storage blocked", "SecurityError");
      }
      return setItem.call(this, key, value);
    };
  });
  try {
    await page.goto(`${origin}/scripts/fixtures/customer-localization.html`);
    await page.locator(".app").waitFor();
    await page.waitForFunction(() => Boolean(window.__customerLocalizationTest));
    await page.locator("#customer-language").selectOption("fr");
    await page.locator('.app[lang="fr"]').waitFor();
    await page.locator(".steps button").nth(1).click();
    assert.equal(await page.locator("#customer-language").inputValue(), "fr");
    assert.equal(await page.locator(".app").getAttribute("data-step"), "1");
  } finally {
    await page.close();
  }
});

test("header actions and centered steps do not overlap at intermediate desktop widths", { timeout: 180000 }, async () => {
  for (const language of ["en", "nl", "de", "fr", "es", "it"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 960 } });
    try {
      await page.goto(`${origin}/?scenario=classic&example=accordion&locale=${language}`);
      await page.locator(`.app[lang="${language}"]`).waitFor();
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
        for (const width of [800, 1024]) {
          await page.setViewportSize({ width, height: 960 });
          await page.evaluate(() => document.fonts.ready);
          const bounds = await page.evaluate(() => {
            const rect = (selector: string) => {
              const node = document.querySelector(selector);
              if (!node) return null;
              const box = node.getBoundingClientRect();
              return { left: box.left, right: box.right, width: box.width };
            };
            const lastStep = [...document.querySelectorAll(".steps button")].at(-1)?.getBoundingClientRect();
            const stepLabels = [...document.querySelectorAll(".steps button")].map((button) => {
              const label = button.querySelector(".step-label")!;
              const range = document.createRange();
              range.selectNodeContents(label);
              const buttonBounds = button.getBoundingClientRect();
              const textRects = [...range.getClientRects()];
              return {
                text: label.textContent,
                lineCount: textRects.length,
                inside: textRects.every((rect) => rect.left >= buttonBounds.left && rect.right <= buttonBounds.right),
              };
            });
            return {
              viewport: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              product: rect(".header-product"),
              steps: rect(".steps"),
              stepLabels,
              lastStepRight: lastStep?.right ?? null,
              actions: rect(".header-actions"),
            };
          });
          assert.ok(bounds.scrollWidth <= bounds.viewport, `${language} ${colorScheme} ${width}px header causes horizontal overflow: ${JSON.stringify(bounds)}`);
          assert.ok(bounds.product && bounds.steps && bounds.actions, "header regions should be present");
          assert.ok(bounds.product.right <= bounds.steps.left + 1, `${language} ${colorScheme} ${width}px product overlaps steps: ${JSON.stringify(bounds)}`);
          assert.ok(bounds.lastStepRight !== null && bounds.lastStepRight <= bounds.actions.left + 1, `${language} ${colorScheme} ${width}px Review step overlaps header actions: ${JSON.stringify(bounds)}`);
          for (const label of bounds.stepLabels) {
            assert.equal(label.lineCount, 1, `${language} ${colorScheme} ${width}px step label wraps: ${JSON.stringify(label)}`);
            assert.ok(label.inside, `${language} ${colorScheme} ${width}px step text escapes its button: ${JSON.stringify(label)}`);
          }
        }
      }
    } finally {
      await page.close();
    }
  }
});

test("a pending cart request, failure, and retry retain design data and idempotency", async () => {
  const page = await openFixture();
  try {
    const quantity = page.locator("#quantity-white-small");
    await page.locator(".steps button").nth(1).click();
    await quantity.fill("5");
    await page.locator(".steps button").nth(2).click();
    await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("data-step") === "2");
    await page.locator(".panel-footer .primary-button").click();
    await page.waitForFunction(() => window.__customerLocalizationTest.commitRequests().length === 1);
    const firstRequest = await page.evaluate(() => window.__customerLocalizationTest.commitRequests()[0]);

    await page.locator("#customer-language").selectOption("de");
    await page.locator('.app[lang="de"]').waitFor();
    assert.equal(await page.locator(".panel-footer .primary-button").getAttribute("aria-busy"), "true");
    assert.equal((await page.evaluate(() => window.__customerLocalizationTest.commitRequests())).length, 1);

    await page.evaluate(() => window.__customerLocalizationTest.rejectCommit(0));
    await page.locator(".cart-submit-error").waitFor();
    const localizedError = await page.locator(".cart-submit-error").innerText();
    assert.notEqual(localizedError, "Your cart could not be updated. Your design is still here. Try again.");

    await page.locator(".panel-footer .back-button").click();
    await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("data-step") === "1");
    assert.equal(await quantity.inputValue(), "5");
    await page.locator(".steps button").nth(2).click();
    await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("data-step") === "2");
    await page.locator(".panel-footer .primary-button").click();
    await page.waitForFunction(() => window.__customerLocalizationTest.commitRequests().length === 2);
    const requests = await page.evaluate(() => window.__customerLocalizationTest.commitRequests());
    assert.notEqual(requests[0].requestId, requests[1].requestId);
    assert.equal(requests[0].idempotencyKey, firstRequest.idempotencyKey);
    assert.equal(requests[1].idempotencyKey, firstRequest.idempotencyKey);
  } finally {
    await page.close();
  }
});

test("an upload pending state and failure follow the latest language without closing the dialog", async () => {
  const page = await openFixture();
  try {
    await page.locator(".artwork-choice").click();
    await page.locator("dialog[open]").waitFor();
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture-image"),
    });
    await page.getByText("Opening file…").waitFor();
    await setLocale(page, "en-XA");
    await page.evaluate(() => window.__customerLocalizationTest.rejectUpload(0));
    await page.locator(".upload-error").waitFor();
    assert.notEqual(await page.locator(".upload-error").innerText(), "We couldn’t open this image. Try another PNG, JPG or SVG.");
    assert.equal(await page.locator("dialog[open]").count(), 1);

    await setLocale(page, "en");
    assert.equal(
      await page.locator(".upload-error").innerText(),
      "We couldn’t open this image. Try another PNG, JPG or SVG.",
      "the stable upload failure reason should be rendered in the latest language",
    );
  } finally {
    await page.close();
  }
});

test("expanded customer copy fits 320px and 390px viewports in light and dark mode", async () => {
  const page = await openFixture({ width: 320 });
  try {
    await setLocale(page, "en-XA");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const measurements = await page.evaluate(() => {
          const app = document.querySelector(".app");
          const steps = document.querySelector(".steps")!;
          const footer = document.querySelector(".panel-footer");
          return {
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
            app: app ? { left: app.getBoundingClientRect().left, right: app.getBoundingClientRect().right } : null,
            steps: steps ? { client: steps.clientWidth, scroll: steps.scrollWidth } : null,
            footer: footer ? { client: footer.clientWidth, scroll: footer.scrollWidth } : null,
          };
        });
        assert.ok(measurements.document <= measurements.viewport, `${colorScheme} ${width}px document has horizontal overflow: ${JSON.stringify(measurements)}`);
        assert.ok(!measurements.app || (measurements.app.left >= 0 && measurements.app.right <= width), `${colorScheme} ${width}px app exceeds viewport: ${JSON.stringify(measurements)}`);
        assert.ok(!measurements.steps || measurements.steps.scroll <= measurements.steps.client + 1, `${colorScheme} ${width}px step navigation overflows: ${JSON.stringify(measurements)}`);
        assert.ok(!measurements.footer || measurements.footer.scroll <= measurements.footer.client + 1, `${colorScheme} ${width}px footer overflows: ${JSON.stringify(measurements)}`);
      }
    }
  } finally {
    await page.close();
  }
});


test("merchant wording updates the selected Designer without losing its quantity draft or focus", async () => {
  const page = await openFixture();
  try {
    await page.locator(".steps button").nth(1).click();
    const quantity = page.locator("#quantity-white-small");
    await quantity.fill("1001");
    await quantity.focus();
    await page.evaluate(() => {
      window.__customerLocalizationTest.setWordingOverlay({ locale: "nl", messages: {
        "customer:steps.quantities": { message: "Aantallen" },
        "customer:quantities.useWholeNumbers": { message: "Gebruik gehele getallen van 0 tot {{maxQuantity}}." },
      } });
      window.__customerLocalizationTest.setLocale("nl");
    });
    await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("lang") === "nl");
    assert.equal(await quantity.inputValue(), "1001");
    assert.equal(await quantity.evaluate((input) => input === document.activeElement), true);
    assert.match(await page.locator(".steps button").nth(1).innerText(), /Aantallen/);
    assert.match(await page.locator(".quantity-error").innerText(), /Gebruik gehele getallen van 0 tot 999/);
    await page.evaluate(() => window.__customerLocalizationTest.setWordingOverlay(null));
    await page.waitForFunction(() => document.querySelector(".quantity-error")?.textContent?.includes("Gebruik hele aantallen"));
    assert.equal(await page.locator(".app").getAttribute("lang"), "nl");
    assert.equal(await quantity.inputValue(), "1001");
    assert.equal(await quantity.evaluate((input) => input === document.activeElement), true);
    assert.match(await page.locator(".quantity-error").innerText(), /Gebruik hele aantallen/);
  } finally { await page.close(); }
});

test("all bundled languages retain a design and fit the selected modal at supported widths", { timeout: 180000 }, async () => {
  const output = process.env.INSIGNIA_CAPTURE_LANGUAGES === "1"
    ? fileURLToPath(new URL("../../insignia/.artifacts/languages-2026-11-04/customer/", import.meta.url)) : null;
  if (output) await mkdir(output, { recursive: true });
  const captures = [];
  for (const language of ["nl", "de", "fr", "es", "it"]) {
    const page = await openFixture();
    try {
      await page.locator(".steps button").nth(1).click();
      await page.locator("#quantity-white-small").fill("2");
      await setLocale(page, language);
      assert.equal(await page.locator("#quantity-white-small").inputValue(), "2");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
        const files: Record<string, Record<string, string>> = { artwork: {}, quantities: {}, review: {} };
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
          for (const [index, step] of ["artwork", "quantities", "review"].entries()) {
            await page.locator(".steps button").nth(index).click();
            await page.waitForFunction((value) => document.querySelector(".app")?.getAttribute("data-step") === String(value), index);
            await page.evaluate(() => document.fonts.ready);
            const bounds = await page.evaluate(() => ({
              viewport: innerWidth, document: document.documentElement.scrollWidth,
              steps: [document.querySelector(".steps")?.clientWidth, document.querySelector(".steps")?.scrollWidth],
              footer: [document.querySelector(".panel-footer")?.clientWidth, document.querySelector(".panel-footer")?.scrollWidth],
            }));
            assert.ok(bounds.document <= bounds.viewport + 1, `${language} ${colorScheme} ${step} ${width}: document overflow ${JSON.stringify(bounds)}`);
            for (const region of ["steps", "footer"] as const) {
              const [client, scroll] = bounds[region];
              assert.ok(client === undefined || scroll !== undefined && scroll <= client + 1, `${language} ${colorScheme} ${step} ${width}: ${region} overflow ${JSON.stringify(bounds)}`);
            }
            if (output) {
              const name = `customer-${language}-${colorScheme}-${step}-${width}.png`;
              await page.screenshot({ path: `${output}${name}`, animations: "disabled", caret: "hide" });
              files[step][width === 1440 ? "desktop" : width === 390 ? "mobile" : "narrow"] = name;
            }
          }
        }
        for (const step of ["artwork", "quantities", "review"]) captures.push({ language, colorScheme, step, ...files[step] });
      }
      await page.locator(".steps button").nth(1).click();
      assert.equal(await page.locator("#quantity-white-small").inputValue(), "2");
      assert.equal((await page.evaluate(() => window.__customerLocalizationTest.commitRequests())).length, 0);
    } finally { await page.close(); }
  }
  if (output) await writeFile(`${output}manifest.json`, `${JSON.stringify(captures, null, 2)}\n`);
});


test("the actual customer preview forwards its language without remounting the design", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/?scenario=classic&example=accordion&locale=de`);
    await page.locator('.app[lang="de"]').waitFor();
    await page.locator('.steps button').nth(1).click();
    await page.locator('input[type="number"]:enabled').first().fill('3');
    await page.locator('.app').evaluate((node) => { node.dataset.localeIdentity = 'retained-design'; });
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set('locale', 'it');
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('.app[lang="it"]').waitFor();
    assert.equal(await page.locator('.app').getAttribute('data-locale-identity'), 'retained-design');
    assert.equal(await page.locator('.app').getAttribute('dir'), 'ltr');
    assert.equal(await page.locator('input[type="number"]:enabled').first().inputValue(), '3');
  } finally { await page.close(); }
});

test("the actual mobile artwork toolbar keeps view names readable beside the preview control", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    for (const language of ["nl", "de", "fr", "es", "it"]) {
      await page.goto(`${origin}/?scenario=classic&example=accordion&locale=${language}`);
      await page.locator(`.app[lang="${language}"]`).waitFor();
      await page.locator(".print-card .artwork-choice").first().click();
      await page.locator("dialog[open] .artwork-library button").filter({ hasText: "North outdoor club.svg" }).click();
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      const control = page.locator(".inline-preview-toggle");
      await control.waitFor();
      assert.ok(await control.getAttribute("aria-label"), "icon-only control keeps its translated accessible name");
      assert.equal(await control.locator("span").isVisible(), false);
      for (const view of await page.locator(".view-tabs button").all()) {
        const geometry = await view.evaluate(button => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const rect = range.getBoundingClientRect();
          return { height: rect.height, line: Number.parseFloat(getComputedStyle(button).lineHeight) };
        });
        assert.ok(geometry.height <= geometry.line + 1, `${language}: short supplied view names stay on one line`);
      }
    }
  } finally { await page.close(); }
});

test("automatic customer language follows Shopify; browser fallback is only used without valid host context", async () => {
  const context = await browser.newContext({ locale: "nl-BE" });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/?scenario=classic&example=accordion&locale=fr-CA`);
    await page.locator('.app[lang="fr"]').waitFor();
    assert.equal(await page.locator('#customer-language').inputValue(), "");
    await page.goto(`${origin}/?scenario=classic&example=accordion&locale=el-GR`);
    await page.locator('.app[lang="en"]').waitFor();
    await page.evaluate(() => localStorage.setItem('insignia.admin.language.v1', 'de'));
    await page.goto(`${origin}/?scenario=classic&example=accordion`);
    await page.locator('.app[lang="nl"]').waitFor();
    assert.equal(await page.locator('#customer-language').inputValue(), "");
    await page.locator('#customer-language').selectOption('it');
    await page.locator('.app[lang="it"]').waitFor();
    await page.reload();
    await page.locator('.app[lang="it"]').waitFor();
    await page.locator('#customer-language').selectOption('');
    await page.locator('.app[lang="nl"]').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('insignia.admin.language.v1')), 'de');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'the Shopify host document is not rewritten');
  } finally { await context.close(); }
});

test("returning to the active language supersedes older preparation and commits only the latest manual choice", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/scripts/fixtures/customer-language-probe.html`);
    await page.locator('#active-locale').waitFor();
    const picker = page.locator('#customer-language');
    await picker.selectOption('de');
    await page.waitForFunction(() => window.__languageProbe.preparations().includes('de'));
    assert.equal(await page.locator('#active-locale').innerText(), 'en');
    await picker.selectOption('en');
    await page.waitForFunction(() => window.__languageProbe.preparations().filter(value => value === 'en').length === 1);
    await page.evaluate(() => window.__languageProbe.releaseGerman());
    await page.waitForFunction(() => document.querySelector('#preference-status')?.textContent === 'ready');
    assert.equal(await page.locator('#active-locale').innerText(), 'en');
    assert.equal(await picker.inputValue(), 'en');
    assert.deepEqual(await page.evaluate(() => window.__languageProbe.changes()), ['en']);
    assert.equal(await page.evaluate(() => localStorage.getItem('insignia.customer.language.v1')), 'en');
  } finally { await page.close(); }
});

test("a storefront locale refresh retains pending manual intent and persists it once", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/scripts/fixtures/customer-language-probe.html`);
    await page.locator('#active-locale').waitFor();
    const picker = page.locator('#customer-language');
    await picker.selectOption('de');
    await page.waitForFunction(() => window.__languageProbe.preparations().filter(value => value === 'de').length === 1);
    await page.evaluate(() => window.__languageProbe.setHostLocale('fr-CA'));
    await page.waitForFunction(() => window.__languageProbe.preparations().filter(value => value === 'de').length === 2);
    await page.evaluate(() => window.__languageProbe.releaseGerman());
    await page.waitForFunction(() => document.querySelector('#active-locale')?.textContent === 'de');
    assert.deepEqual(await page.evaluate(() => window.__languageProbe.changes()), ['de']);
    await picker.selectOption('');
    await page.waitForFunction(() => document.querySelector('#active-locale')?.textContent === 'fr');
    assert.equal(await page.locator('#active-locale').getAttribute('data-format-locale'), 'fr-CA');
    assert.deepEqual(await page.evaluate(() => window.__languageProbe.changes()), ['de', null]);
    assert.equal(await page.evaluate(() => localStorage.getItem('insignia.customer.language.v1')), null);
  } finally { await page.close(); }
});


const reviewedDesigns: Omit<DesignerQuoteReview, "intentId"> = {
  currency: "EUR",
  exponent: 2,
  totalMinor: "8087",
  customizedQuantity: 7,
  currentGroupId: "current-design",
  groups: [
    { id: "current-design", label: "Current shirt", quantity: 2, totalMinor: "2213", editable: true },
    { id: "other-design", label: "Other shirt", quantity: 5, totalMinor: "5874", editable: true },
  ],
};

async function openQuoteReview() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/scripts/fixtures/customer-localization.html?quote-review`);
  await page.waitForFunction(() => Boolean(window.__customerLocalizationTest));
  await page.locator(".steps button").nth(1).click();
  await page.locator("#quantity-white-small").fill("2");
  await page.locator(".steps button").nth(2).click();
  await page.waitForFunction(() => window.__customerLocalizationTest.reviewRequests() > 0);
  await page.evaluate((review) => window.__customerLocalizationTest.setQuoteReview(review), reviewedDesigns);
  return page;
}

function euro(minor: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(minor / 100);
}

test("review separates exact multi-design totals from per-item costs and only links other editable designs", async () => {
  const page = await openQuoteReview();
  try {
    await page.evaluate(() => window.__customerLocalizationTest.resolveReview(new Date(Date.now() + 60_000).toISOString()));
    const totals = page.getByRole("region", { name: "Design totals" });
    await totals.waitFor();
    await page.waitForFunction(() => document.querySelector(".review-group-total")?.textContent?.trim() === "€22.13");
    assert.deepEqual(await totals.locator(".review-group-total").allTextContents(), [euro(2213), euro(5874)]);
    assert.equal(await totals.getByText("2 items", { exact: true }).count(), 1);
    assert.equal(await totals.getByText("5 items", { exact: true }).count(), 1);
    assert.equal(await totals.getByText("Current design", { exact: true }).count(), 1);
    assert.equal(await totals.getByRole("button").count(), 1);
    assert.equal(await totals.getByRole("button", { name: /Current shirt/ }).count(), 0);
    await totals.getByRole("button", { name: /Other shirt/ }).click();
    assert.deepEqual(await page.evaluate(() => window.__customerLocalizationTest.selectedQuoteGroups()), ["other-design"]);
    await page.locator(".review-pricing summary").click();
    assert.equal(await page.locator(".review-pricing summary bdi").innerText(), euro(1200));
    assert.deepEqual(await page.locator(".review-costs dd").allTextContents(), [euro(1000), euro(200)]);
    assert.equal(await page.locator(".review-pricing").getByText("Other shirt").count(), 0);
    assert.ok((await page.locator(".panel-footer").innerText()).includes(euro(8087)));

    await page.evaluate((review) => window.__customerLocalizationTest.setQuoteReview({
      ...review, customizedQuantity: 2, totalMinor: "2213", groups: [review.groups[0]!],
    }), reviewedDesigns);
    await totals.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".review-pricing").getByText("Current shirt").count(), 0);
    assert.ok((await page.locator(".panel-footer").innerText()).includes(euro(2213)));
  } finally { await page.close(); }
});

test("pending and unavailable reviews mask stale group totals and per-item prices", async () => {
  const page = await openQuoteReview();
  try {
    const totals = page.getByRole("region", { name: "Design totals" });
    await totals.waitFor();
    await page.locator(".review-pricing summary").click();
    const amounts = page.locator(".review-group-total, .review-pricing bdi");
    await page.waitForFunction(() => document.querySelector(".review-group-total")?.textContent?.includes("Calculating"));
    const pending = await amounts.allTextContents();
    assert.equal(pending.length, 5);
    assert.ok(pending.every((text) => text.trim() === "Calculating quote…"), JSON.stringify(pending));
    await page.evaluate(() => window.__customerLocalizationTest.rejectReview());
    await page.waitForFunction(() => document.querySelector(".review-group-total")?.textContent?.trim() === "Unavailable");
    assert.ok((await amounts.allTextContents()).every((text) => text.trim() === "Unavailable"));
    assert.equal((await totals.innerText()).includes(euro(2213)), false);
    assert.equal((await totals.innerText()).includes(euro(5874)), false);
  } finally { await page.close(); }
});


test("design totals retain translated labels and fit narrow and desktop review layouts", async () => {
  const page = await openQuoteReview();
  try {
    await page.evaluate(() => window.__customerLocalizationTest.resolveReview(new Date(Date.now() + 60_000).toISOString()));
    const labels = [
      ["en", "Design totals", "Current design"],
      ["nl", "Totalen per ontwerp", "Huidig ontwerp"],
      ["de", "Summen je Design", "Aktuelles Design"],
      ["fr", "Totaux par création", "Création actuelle"],
      ["es", "Totales por diseño", "Diseño actual"],
      ["it", "Totali per design", "Design attuale"],
    ];
    for (const [language, heading, current] of labels) {
      await setLocale(page, language);
      assert.equal(await page.locator(".review-design-totals h3").innerText(), heading);
      assert.equal(await page.locator(".review-design-totals").getByText(current, { exact: true }).count(), 1);
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.locator(".review-design-totals").evaluate((section) => ({
          client: section.clientWidth,
          scroll: section.scrollWidth,
          rows: [...section.querySelectorAll(".review-group-row")].map((row) => ({
            infoRight: row.querySelector(".review-group-info")!.getBoundingClientRect().right,
            totalLeft: row.querySelector(".review-group-total")!.getBoundingClientRect().left,
            height: row.getBoundingClientRect().height,
          })),
        }));
        assert.ok(geometry.scroll <= geometry.client + 1, `${language} ${width}: totals overflow`);
        assert.ok(geometry.rows.every((row) => row.infoRight < row.totalLeft && row.height >= 44), `${language} ${width}: totals overlap or have small targets`);
      }
    }
    await setLocale(page, "en");
    await page.setViewportSize({ width: 390, height: 844 });
    const output = fileURLToPath(new URL("../../../.m1-artifacts/frontend/customer-language/", import.meta.url));
    await mkdir(output, { recursive: true });
    await page.locator(".review-design-totals").screenshot({ path: `${output}review-design-totals-390.png` });
  } finally { await page.close(); }
});

test("expiring a reviewed quote replaces design totals and unit prices with unavailable", async () => {
  const page = await openQuoteReview();
  try {
    await page.evaluate((review) => {
      const expiresAt = new Date(Date.now() + 600).toISOString();
      window.__customerLocalizationTest.setQuoteReview({ ...review, expiresAt });
      window.__customerLocalizationTest.resolveReview(expiresAt);
    }, reviewedDesigns);
    await page.waitForFunction(() => document.querySelector(".review-group-total")?.textContent?.trim() === "€22.13");
    await page.waitForFunction(() => document.querySelector(".review-group-total")?.textContent?.trim() === "Unavailable");
    assert.ok((await page.locator(".review-group-total, .review-pricing bdi").allTextContents()).every((text) => text.trim() === "Unavailable"));
  } finally { await page.close(); }
});
