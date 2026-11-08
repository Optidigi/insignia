# Granular QA method for the integrated merchant UI

**Research note — 8 November 2026.** This note describes a focused QA approach for the selected Preact merchant UI composed into Shopify App Home, and its related customer-host flow. It is based on the clean `insignia-ui-audit-2026-11-08` worktree, the project entry instructions, current package scripts and existing browser test patterns. No application code, live app, or store data was changed or exercised for this research.

## Recommended test shape

Use a short, explicit transition table for each important screen. For each user action, record the starting state, the action, the expected visible/accessible result, the expected request or lack of request, and the state that must survive reload. Keep the selected reducers and host decisions as the contract; do not introduce another state framework. The project adaptation guide specifically requires preserving the selected reducers and verifying actual built UI behavior.

Playwright should locate controls by accessible role/name or label, scope a control to its exact dialog or frame, perform a normal user action, then wait for the expected outcome. A successful `click()` confirms Playwright found one actionable target; it does not prove the app handled the event. Playwright recommends retrying web-first assertions because they wait for the expected UI state. Avoid force-clicks and one-shot `isVisible()` checks for success conditions. For nested Shopify/customer frames, identify the intended iframe and use a strict `frameLocator`; a broad search across every frame can click Shopify chrome or another app. Keep a trace on failure so the action, DOM snapshot, timing, and network evidence are reviewable. ([Playwright locators and best practices](https://playwright.dev/docs/best-practices), [actionability](https://playwright.dev/docs/actionability), [frames](https://playwright.dev/docs/frames), [trace viewer](https://playwright.dev/docs/trace-viewer))

### Modal close no-op: first regression exemplar

1. Open the actual integrated modal from its real launch control. Assert that the named dialog becomes visible and focus enters it.
2. Within that dialog, click the visible Close/Cancel control by role and accessible name. Assert the dialog becomes hidden or detached, focus returns to the launching control, and no business write was issued.
3. If Escape is part of the modal contract, repeat from a reopened dialog and assert the same close/focus behavior. For dirty-edit confirmation flows, assert that close/cancel preserves the draft and that only the explicit discard action discards it.

This catches the reported no-op: the selector can resolve, and the click can pass actionability, while the dialog remains open. The WAI-ARIA APG modal pattern recommends moving focus into an opened dialog, containing Tab/Shift+Tab, closing on Escape, and returning focus to the invoker when the dialog closes; a visible close button should be in the dialog tab sequence. Apply these checks to the actual modal semantics in use, including any Shopify host-owned dialog. ([WAI-ARIA APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/))

## High-value flow matrix

| Area | Exercise | Required evidence |
|---|---|---|
| Controls | Inventory visible buttons, links, inputs, row actions, navigation, and menus by screen. Exercise each control that changes state at least once. | Expected page/dialog/field state and route effect; exact request or proof of no request. A rendered control alone is not a pass. |
| Loading and failure | Hold a read or write response; exercise loading, 403/validation failure, 5xx/network loss, retry, navigation away/back, and an older response arriving after a newer selection. | Loading feedback appears while held; repeated actions are fenced where required; the final state reflects the current request; errors remain recoverable; stale results do not replace newer state. Prefer controllable routes/promises and DOM assertions over fixed sleeps. |
| Save | Change one valid field, save, then reload or reopen. Also cover unchanged/invalid input, denied authority, and a response lost after the fixture has committed. | Exact method, payload, revision/version and write count; success/error presentation; authoritative fixture state and same value after reload. For uncertain delivery, retry/reconcile the same command without creating a duplicate. |
| Publish | Try an incomplete draft, then a publishable draft. Include delayed and failed provider/readback outcomes where the workflow supports them. | Ineligible state causes no publish mutation. Successful publish shows the exact revision/status and readback matches the accepted draft. A pending/failed outcome is not presented as completed. |
| Persistence | Save or publish, navigate away, reload, and revisit through Home/product navigation. | A fresh read restores the value and status; no browser-only/session-only state is mistaken for merchant persistence. |
| Merchant host | Open App Home inside Shopify admin, navigate between a few routes, use native Save Bar/title actions, close a host modal, and return focus to the app control. | App Bridge/session context and host-owned components work in the actual Shopify shell; app surface and outer admin chrome are scoped separately. Local mocks do not prove this composition. |
| Customer host | Open the intended storefront product, launch/reopen the Designer, close/Escape, and verify resume/focus/scroll. For commerce, exercise confirmation only in an isolated fixture or authorized test store. | Close returns to the host and preserves the selected draft; reopen resumes it. Quote/cart navigation follows the exact confirmed receipt and cart state, not merely a button press. Keep customer cart, payment, order, and email effects outside ordinary local fixtures. |

For state coverage, think in terms of reachable states and transitions rather than random button sequences. Stately's official graph documentation explains shortest paths to reach each state and simple paths for transition coverage; it also warns that unbounded loops need a stopping condition. Use that as a coverage technique or checklist over the existing reducers. It does not require importing XState into this Preact project. ([Stately graph and paths](https://stately.ai/docs/graph))

## Local-first execution and proof boundaries

The current repository already has a useful pattern in `apps/web/test/admin/selected-methods-browser.test.mts`: a browser test opens the selected page, edits by role/name, observes the response, asserts the saved message and exact fixture record, then reloads to check persistence. Its support fixture controls API reads/writes, authorization, held responses, and the “commit succeeded but first reply was lost” case. Use this style for deterministic UI and adapter regressions, extending existing tests rather than creating broad click smoke tests.

Relevant commands in this worktree are:

- `corepack pnpm --filter @insignia/web test` runs `apps/web` Node tests, including `test/admin/*.test.mts` browser cases.
- `corepack pnpm test:browser` runs the web and storefront suites.
- `corepack pnpm check:ui` runs the four isolated frontend packages' tests; it checks selected/demo package behavior but does not replace the integrated web suite.

Use controlled local API routes for loading, failure and persistence cases; these prove the client and adapter contract, not backend durability or a native Shopify session. Shopify distinguishes developer-hosted iframe App Home from Shopify-hosted App Home UI extensions. This project’s real merchant shell is the former: its app surface is embedded and App Bridge communicates with Shopify admin outside the iframe. Therefore, keep a final, bounded host check against a dedicated development store to prove the actual frame, identity/session context, Polaris components, and App Bridge behavior. Shopify documents development stores as test environments that can preview apps without affecting live stores. Do not interpret that host check as authorization to publish, mutate customer carts, place orders, send email, or change live resources. ([Shopify App Home models](https://shopify.dev/docs/apps/build/app-home), [development stores](https://shopify.dev/docs/apps/build/stores/development-stores), [test apps locally](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally))

For Luna agents, split the work by a bounded flow (for example: dialog/keyboard, save/publish, or customer-host resume). Require each report to name the source and test file, the exact user action, the expected visible and persisted result, the command run, and the observed result/trace. First make the modal close regression fail before changing its handler, then make the behavioral test pass. Keep one integration owner responsible for reconciling overlapping edits and running the repository’s existing suite. Avoid assigning “test everything” or random click generation; the small transition table makes missing behavior and coverage gaps auditable.

## Performance evidence

Measure user-facing milestones, not only total navigation: App Home shell visible, useful product/editor data ready, modal open/close response, Save confirmation, and Publish readback. Record each result with browser, viewport, cache state, and whether the request was synthetic or native; compare repeated cold and warm observations before setting a project budget. Keep delayed-response tests as behavior checks, separate from timing benchmarks.

Because the merchant UI is inside an iframe, measure inside its document and observe the outer Shopify experience separately. Browser APIs running only in the parent page do not report all LCP/INP entries from a cross-origin child frame; web.dev documents this iframe limitation. Lab values also differ from field values; INP requires real interactions and Lighthouse uses Total Blocking Time as a lab proxy. Core Web Vitals’ general “good” thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1 at the 75th percentile) are useful context, not automatically an Insignia acceptance budget. ([LCP and iframe measurement](https://web.dev/articles/lcp), [Web Vitals measurement](https://web.dev/articles/vitals-measurement-getting-started), [Core Web Vitals](https://web.dev/articles/vitals))

## Primary sources checked

- [Playwright Best Practices](https://playwright.dev/docs/best-practices), [Auto-waiting and actionability](https://playwright.dev/docs/actionability), [Frames](https://playwright.dev/docs/frames), and [Trace Viewer](https://playwright.dev/docs/trace-viewer): locator semantics, retrying assertions, frame scoping, and failure diagnosis.
- [WAI-ARIA APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): keyboard and focus behavior for modal dialogs.
- [Stately graph and paths](https://stately.ai/docs/graph): reachable-state and transition-path coverage.
- [Shopify Apps in App Home](https://shopify.dev/docs/apps/build/app-home) and [App Home reference](https://shopify.dev/docs/api/app-home/latest): iframe/extension distinction and App Bridge/Polaris boundaries.
- [Shopify development stores](https://shopify.dev/docs/apps/build/stores/development-stores) and [test apps locally](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally): isolated native-host validation environment.
- [web.dev LCP](https://web.dev/articles/lcp), [Web Vitals measurement](https://web.dev/articles/vitals-measurement-getting-started), and [Core Web Vitals](https://web.dev/articles/vitals): iframe measurement limits and lab/field interpretation.
