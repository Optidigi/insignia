// One-off WebKit repro for the iPhone modal hang.
// Loads the production stitchs.nl modal URL with iPhone viewport + UA,
// captures console errors, network failures, page errors, and final body state.

import { webkit, devices } from "playwright";

const URL = "https://stitchs.nl/apps/insignia/modal?p=8513346601060&v=48255817973860&returnUrl=/products/t-shirt-heren";

(async () => {
  const browser = await webkit.launch({ headless: true });
  const ctx = await browser.newContext({ ...devices["iPhone 14"] });
  const page = await ctx.newPage();

  const errors = [];
  const networkFails = [];
  const consoleMsgs = [];

  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message}`));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("requestfailed", (req) => {
    networkFails.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      networkFails.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  console.log(`navigating: ${URL}`);
  try {
    await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  } catch (e) {
    console.log(`navigation error: ${e.message}`);
  }

  // Give it 5s for client-side hydration to either succeed or fail.
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => ({
    title: document.title,
    baseCount: document.querySelectorAll("base").length,
    baseHrefs: Array.from(document.querySelectorAll("base")).map(b => b.href),
    hasReactRouterContext: typeof window.__reactRouterContext !== "undefined",
    hasReactRouterManifest: typeof window.__reactRouterManifest !== "undefined",
    bodyHasModal: !!document.querySelector(".insignia-modal-page, .insignia-modal"),
    bodyTextSlice: (document.body.textContent || "").trim().slice(0, 300),
    moduleScripts: Array.from(document.querySelectorAll('script[type="module"]')).length,
  }));

  console.log("\n=== Page state after 5s ===");
  console.log(JSON.stringify(state, null, 2));

  console.log("\n=== Page errors ===");
  if (errors.length === 0) console.log("(none)");
  else for (const e of errors) console.log(e);

  console.log("\n=== Console errors/warnings ===");
  if (consoleMsgs.length === 0) console.log("(none)");
  else for (const c of consoleMsgs) console.log(c);

  console.log("\n=== Network failures + HTTP >=400 ===");
  if (networkFails.length === 0) console.log("(none)");
  else for (const n of networkFails) console.log(n);

  await browser.close();
})();
