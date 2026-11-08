# Integrated UI QA plan

8 November 2026. Research and bounded observation only. Source baseline: `897a44e48a715957881ca1117a7ba26c63da567a`, fetched from `origin/main` into an isolated worktree. The deployed build must be fingerprinted before the full execution campaign; reading current main does not prove deployed-byte identity. The old dirty UI workspace was preserved. No application code, product data, draft, publication, cart or deployment was changed in this research.

## Observed pilot

The parent inspected the user-provided Shopify product editor on `insignia-rewrite-dev`, product `10588450554139`, with Add views already open and zero images selected.

| User action | Observed result |
| --- | --- |
| Click the accessible Close X | Add views remained visible in later observations and screenshot |
| Press Escape on that close control | Add views remained visible after settling |
| Click the visible Cancel button at the app-frame scope | Dialog disappeared; editor still showed zero views and zero placements |

An initial dialog-descendant locator for Cancel matched no element, while the frame-level named button worked. This is recorded as an automation/portal-scoping issue, not a broken Cancel button. No selected image or saved change was introduced. The original screen was returned to its editor by Cancel. A screenshot of the failed close is saved at `/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/add-views-close-noop.png` outside the repository.

Cause is unconfirmed. Source routes the shared dialog's `afterhide` into `onClose`, while Cancel calls the close callback directly. An event-path or host-lifecycle difference is a hypothesis, not a diagnosis. Existing selected-product browser coverage selects an image and adds/saves a view; it does not prove this picker’s X/Escape lifecycle. Those tests use real built UI with controlled HTTP and a simulated Shopify host, so they are valuable but cannot establish native App Bridge behavior. See the [source coverage review](integrated-qa-coverage-luna-2026-11-08.md).

## Recommended order

1. **Record the target and expected behavior.** Freeze deployed build/release, source ref, app/store, supported product facts and existing test results. Inventory actual routes and important actions, prioritizing the already-designed UI. Record which actor owns each action: Insignia editor, App Bridge, Shopify product page, cart or checkout. Preserve the selected UI and reducers. Do not introduce another framework, redesign screens or treat the retired developer host as customer UI.
2. **Close shared-control gaps first.** Add a failing regression that reaches the actual rendered Close button. Check X, Cancel, Escape, reopening, focus return, keyboard containment, unchanged product state and absence of writes. Inspect other users of the shared dialog. Diagnose and fix at the owning event boundary, then verify both the built fixture and the same native Shopify interaction. If the local fixture passes while native fails, retain that distinction and reproduce at the host boundary; do not loosen assertions or dispatch reducer events to simulate successful dismissal.
3. **Run deterministic integrated state tests.** Extend existing `apps/web/test/admin/selected-*browser.test.mts`, their controllers/clients, and the selected storefront tests. Use held, failed and out-of-order replies to exercise pending, validation, denied access, transient failure, retry, navigation, uncertain commit and superseded selection. These cases belong locally, not as random disruptions to the shared store. Build/types/CI remain regression gates, not a replacement for runtime outcomes.
4. **Run bounded native merchant tasks with Luna.** Start with a simple end-to-end product draft, then parallelize independent products. Use actual Superfunny T-shirt, polo and hoodie catalog records present in the development store. Refresh the real variants, media and IDs first. Use dedicated QA drafts/copies and assign each product to one agent. Keep shared Method-default changes under one owner or use unique QA Methods, because propagation can affect other products. Validate saved state by fresh reads/reload and customer preview, not a success toast alone. Publication is a separate deliberate operation on the designated QA product.
5. **Review usability, responsiveness and measured performance.** Give agents business goals rather than a click-by-click answer key. Have another pass verify reported defects, responsive/keyboard behavior and consistency with the accepted design and Shopify references. Use desktop and narrow layouts plus Chromium/Firefox for key flows; distinguish emulated viewports from real mobile devices. Measure cold/warm startup, photo list readiness, canvas responsiveness, save confirmation and publish readback in the browser. Agent thinking/tool time is not a performance measurement.
6. **Fix, replay and retain the evidence.** Reproduce each material finding independently, assign severity and ownership, fix the common cause where appropriate, and repeat the failing path plus its affected neighbors. Add lasting regressions for confirmed bugs. A retry that succeeds does not erase the initial failure. Report pass/fail/blocked/unsupported separately, with local/native evidence identified. Finish by running the existing relevant integration gates and a small native canary set against the final deployed build.

## Granular test contract

For every important action, record:

`case ID → route/actor/product → starting state → real user action → expected visible/focus result → expected request or no request → persisted readback → actual result/evidence`.

A successful click proves actionability, not correct behavior. Use role/name locators within the actual app frame, and assertions that wait for the outcome rather than fixed sleeps. Handle native/shadow/slotted controls based on the rendered DOM. Do not force clicks or call private handlers to make the test pass.

| Area | High-value cases and required outcomes |
| --- | --- |
| Dialogs and menus | X/Cancel/Escape/programmatic completion; focus returns; reopen works; closing an unconfirmed picker does not add data |
| View/media assignment | Add/replace/remove/reorder a view; filter/search/upload; cancel selection; unsupported/failed media has a reason and recovery; no inferred front/back or color ownership |
| Placements | Add/edit/copy/remove; draw area; movement/alignment settings where supported; undo/redo; active selection remains valid after deletion |
| Methods and pricing | Enable/disable Methods, missing price, zero vs unset, explicit overrides and inherited defaults; preserved amount/currency and no unintended propagation |
| Save and reload | Unchanged/invalid edits, valid save, delayed save, lost response, reopen/reload; exact saved IDs, geometry and values survive; no duplicate write or false success |
| Publication | Incomplete setup is blocked with a useful action; success/pending/failure/conflict stay distinct; the recorded published revision is the one confirmed |
| Home, Products, Orders and settings | Links, search/sort/filter/paging, empty/partial/error/loading states, retained context, translation preferences and Shopify-owned handoffs; no unrelated billing or permission mutation |
| Customer handoff | Product → personalize modal → artwork/quantity/review → verified Shopify handoff; close/reopen retains the intended draft; exact chosen variants and quantities survive. Cart mutations require their own bounded QA lane, not the merchant setup lane |

Test reachable transitions and important forbidden/stale transitions using the current reducers. State-graph coverage is a technique; adopting XState is not required. Avoid a Cartesian product of every field/value/browser. Share common-component cases, then test representative product complexity and high-risk boundaries.

## Product lanes and current limits of evidence

- **Simple T-shirt:** one view/placement/Method first, valid save/reload and preview. Provides the first real product with a complete working setup.
- **Polo:** different supported Method/decoration-size or artwork-later rules where actual shop settings support them; check clear price and setup guidance.
- **Hoodie or actual large-variant product:** multiple views, manual variant-photo assignment, missing/uneven photos, sparse/unavailable option combinations and supported alignment controls. Prove actual variants survive from Shopify through editor to customer quantities.
- **Independent cross-cutting pass:** keyboard/modal behavior, long translated labels and narrow layouts; verify bug reports and review the first three products.

Checked-in Superfunny snapshots are historical external records, not current store IDs or proof of a full color × size matrix. The source audit found same-color size variants and a separate image-color manifest; these must not be multiplied into invented combinations. A one-size or other product-type lane is useful only if a real supported example is available. Current recorded native customer qualification uses one placement/Method/size, so it does not establish richer product coverage. See the [persona review](integrated-qa-personas-luna-2026-11-08.md).

Use one isolated test context/resource set per worker where the browser tooling supports it. Tabs alone do not isolate store-wide settings. Capture redacted traces/screenshots, console errors and relevant network timings. Keep source-private product/account data local. Leave the named review examples available for the owner; preserve originals and ordinary products. Do not place orders, capture payments, send email or change shared theme/billing/access as a side effect of this QA campaign. Guided-tour work remains deferred.

## Acceptance of the campaign

Every prioritized action has an observed outcome or an explicit blocked/unsupported reason. Each representative product survives save/reload and displays the same intended configuration in customer preview. Blocking/high-impact defects are resolved and replayed, or explicitly remain open. Minor polish suggestions are separate from functional bugs and intentional limitations. The final report includes product links, verified cases and failures with exact reproduction steps; it never says “everything works” based on screenshots or clicks alone.

## Sources and why they matter

- [Shopify modal migration, close behavior and migration tests](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/modal#preserve-close-behavior): explicitly tests secondary action, dismiss control, Escape and programmatic dismissal; state must reconcile across every path.
- [Shopify App Home Modal](https://shopify.dev/docs/api/app-home/v2.0/web-components/overlays/modal): supported overlay methods and hide/afterhide lifecycle. Project runtime is pinned to the 2.0 release-candidate CDN/types; latest docs are guidance, not proof of identical deployed bytes.
- [Playwright best practices](https://playwright.dev/docs/best-practices) and [assertions](https://playwright.dev/docs/test-assertions): user-visible outcomes, isolated tests and retrying outcome assertions.
- [Playwright trace viewer](https://playwright.dev/docs/trace-viewer): replay action, DOM and network evidence for failures.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): keyboard containment, Escape and focus restoration.
- [Shopify Web Vitals API](https://shopify.dev/docs/api/app-home/latest/apis/device-and-platform-integration/web-vitals-api): app/iframe performance reporting. Set meaningful budgets from measured baselines; one native interaction is not a field percentile or release-wide performance proof.
- [Stately graph/path testing](https://stately.ai/docs/graph): state and transition coverage as a method, without changing the project's reducer architecture.
- Installed Checklist Design `design-system-modal.md` and `design-system-loading.md`: visible exit, responsive dialog and clear pending feedback. Apply to UI observations, not code/performance claims; do not add decorative illustrations or extra copy merely to fill a checklist.

Independent Luna notes: [coverage](integrated-qa-coverage-luna-2026-11-08.md), [methods and primary sources](integrated-qa-methods-luna-2026-11-08.md), [personas](integrated-qa-personas-luna-2026-11-08.md). These are research records, not a completed full test campaign.
