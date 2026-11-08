# Whole-product integration audit, 8 November 2026

Issue-finding pass only. No implementation fixes, application source changes, commits, deployments, saved product edits or publication changes. The primary agent tested the actual Shopify-embedded admin and selected customer modal. Three independent Luna Max agents examined admin composition, customer integration and shared state/runtime boundaries; a fourth independently challenged the consolidated findings. Findings below are filtered and deduplicated. This is not release clearance or a claim that every native transaction passed.

## Baselines and evidence limits

- Source reviewed and locally built: `origin/main` at `897a44e48a715957881ca1117a7ba26c63da567a` in this isolated worktree. Original selected UI baseline: `d490e4d0`. The old dirty workspace was untouched.
- Ahead-main branch `origin/perf/selected-ui-responsive-workflows` at `a5971e44` was read for already-addressed issues, not checked out, changed or deployed.
- Native target: `insignia-rewrite-dev`, actual embedded Insignia app and the published selected customer Designer. The observed Methods and skeleton component asset names match this source build. This does not establish the exact full deployed web/worker/extension release fingerprint; current delivery-state deployment receipts are historical evidence, not a fresh runtime attestation.
- No native network trace or server request log was available. Visible failures are established; backend causes must not be inferred from a shared dependency alone.
- Customer entry was unlocked through Shopify's existing authenticated owner Preview store. No password/security setting was changed. The simple native fixture and actual published Superfunny T-shirt were both examined. No assumed color/size matrix or old external product IDs were used as live facts.

## Prioritized findings

### F1. High: Add views cannot dismiss normally and can strand the Shopify host blocker

On product `10588450554139`, X and Escape leave Add views open. Cancel removes the app dialog, but leaves four Shopify host scrims active. The header and navigation remain covered; a header hit-test returns the top scrim. This was observed after the user's original close and reproduced through a second open/X/Cancel cycle without selecting or saving photos. A second native caller is confirmed: the configured Superfunny product's Images > Change Grijs > Choose Voorkant image has the same missing ID, no-op X, and four leftover host scrims after Cancel. Save draft remained disabled; no image assignment changed.

The actual Add views `s-modal` has no `id`. The shared `frontend/admin/examples/admin/support/method-dialog.tsx` assigns none. Pinned Polaris calls `shopify.modal.show(this.id, ...)` and `shopify.modal.hide(this.id)` in the native host. This makes missing stable modal identity the strongest cause hypothesis. Cancel also unmounts the component before the asynchronous hide completes. The native show/hide call/event sequence was not captured, so neither mechanism is claimed fully proved.

Control cases matter: Translations Add language has an explicit modal ID, and both its X and Cancel close cleanly with zero remaining host scrims. The Shopify Storefront setup resource picker and order Design preview also dismiss normally. Do not report all dialogs as broken. Other shared-helper product and Methods callers remain candidates and should be tested together.

The local selected browser fixture mocks `idToken` and Save Bar but no `shopify.modal`. Polaris therefore takes its standalone local-dialog path. Passing those tests cannot establish native host cleanup.

Suggested later correction: give each shared modal a stable unique identity and reconcile close/hide/unmount in the documented host lifecycle. Retain native checks for X, Escape, Cancel, reopening, focus return and host hit-testing.

Evidence: [stranded host scrim](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/orphaned-host-scrim-after-cancel.png), [variant-picker host scrim](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/variant-picker-orphaned-host-scrim.png). Source detail: [shared-state audit](whole-state-parity-audit-luna-2026-11-08.md).

### F2. High: native admin loading is not dependable

Fresh native editor loads failed for both the reported polo `10588450554139` and the previously qualified simple product `10585669959963`. The polo failed from both a direct link and Products, including Retry. Methods also repeatedly showed `Methods could not be loaded`; a later fresh Methods navigation reached that failure in approximately 2.55 seconds.

Products initially loaded its actual ten products, but a later navigation showed `Products are unavailable. Try again.` Its Retry subsequently recovered the same ten-product list. Orders initially failed, then successfully recovered through Retry with five actual test orders, newest first. Later, the published Superfunny editor `10588458647835` loaded normally with four views, six placements and real six-color image groups. These are observed availability/recovery results, not four proved independent code defects or a claim that every editor always fails.

Both Methods and the editor require the method catalog before their selected presentation can mount; Products uses a different request. That is useful diagnostic narrowing for the earlier editor/Methods failures, but Products' later failure and the richer editor's later success argue against naming one root cause without request evidence. Auth, provider, response validation, product-specific data, runtime, and intermittent service failures remain unseparated.

Suggested next diagnosis: capture exact failing request/status/correlation and server failure on the same deployed version, distinguish transport from DTO parsing, then replay that failure at the real container boundary. Do not replace a real failure with demo data or optimistic success.

Evidence: [editor error](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/fresh-editor-load-failure.png), [Methods error](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/methods-load-failure.png), [initial Orders error](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/orders-load-failure.png). Dependency trace: [admin audit](whole-admin-audit-luna-2026-11-08.md).

### F3. High: the native final Add to cart attempt failed

The actual simple product opened the selected dark-mode Designer. A supported path-only synthetic SVG uploaded and inspected successfully. Entering quantity 3 reached authoritative Review at USD 12.50 per item, USD 37.50 total. Ordinary close/reopen preserved that exact draft and returned to Shopify without an Insignia cart page.

One Add to cart click showed `Adding to cart...`, then `Your cart could not be updated. Your design is still here. Try again.` The modal remained on the product page and preserved the design. No successful handoff is claimed. There was no second mutation attempt.

Reconciliation: Shopify's cart drawer was empty before the attempt. After failure, the separate read-only store `get_cart` tool returned `item_count: 0` and `line_items: []`; a fresh full Shopify `/cart` page also showed `Your cart is empty`. The read tool returned no total/currency for an empty cart, so this note does not claim an independently measured numeric total. No cleanup removal was needed, no cart line was retried, and no checkout/order/payment/email was created. The primary agent's audit tab was retained for continuation rather than clearing its session custody.

The cause is unknown. There is no evidence yet for incorrect pricing, a duplicate line, or corruption. Investigate the same attempt through quote acceptance/cart application/readback before replaying any mutation. This failed final step blocks native edit-from-cart testing in this pass.

Evidence: [failed submit](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/customer-cart-submit-failure-native.png), [empty cart afterward](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/cart-empty-after-failed-submit.png), [successful review before submission](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/customer-review-native.png).

### F4. UX decision, not a proved regression: Shopify selections are discarded at first Designer entry

Independent native examples establish the continuity gap:

- Main agent: Shopify quantity 3 on the simple product; the first Designer's quantity field was 0. It required re-entry.
- Luna agent: native Superfunny product had Grijs/M selected, then its fresh Designer started at Zwart with zero quantities. No previous per-tab Designer draft existed. Manually selected Grijs/M quantities were subsequently retained correctly.

Source confirms that the Liquid trigger and buyer mount carry product/context but not the current selected variant/form quantity, and the Designer initializes its own default appearance and empty quantities. The isolated demo's default initialization is preserved; the newly connected Shopify controls expose a second set of choices that currently do not carry across. This is a UX integration decision to resolve, not evidence of wrong cart IDs or a broken reducer.

For a later correction, make the responsibility explicit. Prefer seeding a genuinely new design from the exact current Shopify variant and valid quantity when supplied, while leaving every other variant at zero. Ordinary resumed drafts must keep their own edits. Alternatively remove redundant theme controls where Insignia owns the selection; do not leave visible controls that appear consequential but are ignored.

The single-default-variant fixture also exposes raw `Selection` and `Default Title` labels in Quantities/Review. That is a small presentation opportunity, not a fabricated product-type problem. A product with no real selectable options should need only its quantity control.

Evidence: [quantity reset](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/customer-quantity-handoff-native.png). Source and independent native case: [customer audit](whole-customer-audit-luna-2026-11-08.md).

### F5. Medium: three translation categories are indistinguishable

Native Settings > Translations shows three different Other text rows as `Unavailable`. The Section selector repeats the three indistinguishable options. Actual groups are `host`, `language`, and `startup`; all six supported admin catalogs omit those category-label keys. Field labels exist, so merchants can edit the content but cannot identify the sections before opening them. A dynamic key cast hides the omission from type checking.

Later fix should supply the category names and validate manifest-to-category label completeness. Do not hide the actual supported startup/language/recovery wording to remove the symptom.

Evidence: [native overview](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/translations-overview.png). Exact source trace: [admin audit](whole-admin-audit-luna-2026-11-08.md).

### F6. Medium: Home can omit its product-test task for larger catalogs

Reproduced at the pure helper boundary: the first 20 title-sorted products can contain no published configuration while another published product exists on a later page. `homeProductsFromResponse` correctly returns unknown, but the separate `homeHasPublishedProduct` collapses the same incomplete page to false. With theme integration active, `homeSetupFromTheme` then omits the test invitation.

This was not reproduced against a native >20-product store. Existing source tests correctly check the product-panel unknown state but miss its later composition. Preserve unknown until a suitable aggregate/query/pagination establishes the store-wide fact; don't create an invented product or mark setup complete.

Source trace and controlled probe: [admin audit](whole-admin-audit-luna-2026-11-08.md).

### F7. Lower-priority recovery-copy gap: permitted SVG restrictions are not explained usefully

The actual repo example `frontend/designer/public/club-logo.svg` is a static SVG containing text. The native upload advertised SVG, showed real upload feedback, then rejected it with `This image was rejected. Choose a supported static image.` This is intentional backend policy: `apps/worker/src/artwork/svg-policy.ts` excludes text/fonts and other constructs. It is not evidence that the inspector or its security boundary is wrong.

A subsequent synthetic SVG using only a path and circle uploaded successfully and the workflow continued. Recovery works, but the rejection leaves a customer with a valid static logo unclear on what to change. Later guidance should explain the supported alternative, such as outlining text or exporting PNG/JPG, without leaking parser internals or relaxing inspection. The demo upload adapter's wider acceptance is not live-service acceptance.

Evidence: [rejected example](/Users/pc/Development/Insignia/.artifacts/integrated-qa-research-2026-11-08/customer-upload-state-native.png).

### E1. Engineering qualification concern: flattened server externals depend on the environment

The untouched application source built successfully, but starting its generated web server first resolved an ambient CommonJS cookie package outside the repo and failed on the named `parseCookie` import. After a temporary ignored binding to the locked cookie 2.0.1, it next resolved an ambient Zod v3 and failed at `z.uuid`. Bare cookie/Zod/noble imports appear in flattened generated server chunks, while the web manifest/root packaging checks do not bind these transitive dependencies.

An isolated offline deploy had no runtime-root cookie binding. The existing portable-runtime test under the pinned Node stopped earlier at an escaping Darwin ARM optional compiler symlink. A Linux image/startup was not qualified in this pass. This is a build/reproducibility and possible package-startup concern, not a claim that these errors caused the live app failures.

For behavioral checks only, temporary links to the already installed locked cookie/Zod/noble packages were placed inside ignored `apps/web/dist/server/node_modules`. They changed no application source or manifest. Under that explicit environment workaround, 40 selected editor/Methods browser cases and 15 order/billing/private-preview browser cases passed. All three temporary links were removed after the checks. A passing workaround is not a clean-package pass.

Full evidence: [state/runtime audit](whole-state-parity-audit-luna-2026-11-08.md).

## Coverage ledger

| Area | Native observation | Local/source coverage and remaining limit |
| --- | --- | --- |
| Products | Actual catalog, table, editor entry, later load failure and successful retry | Authenticated composition traced; no saved writes |
| Product editor | Empty editor/photo picker; fresh editor failures; richer Superfunny editor with four views/six placements/six color groups, manual image-assignment entry and second confirmed dialog failure | Selected reducer/client/save/conflict/publication cases; no native save/publish success claimed |
| Home | Metrics, guide expand, recent orders/drafts, route links | Selected composition preserved; no invented totals; controlled pagination defect probe |
| Orders | Initial error and successful Retry, newest first, detail, rendered purchased-design preview and successful close | Historical economics, retention/expiry, upload/lock/denial/export-related behavior tests; no native replace/lock/refund/export/fulfillment mutation |
| Methods | Repeated live load failure | Real built selected CRUD/assignment/recovery tests with fake providers; no native CRUD/assignment success claimed |
| Settings | Landing page, Billing, Permissions check/busy/result, Storefront setup/check/product picker, Translations overview/editor/add-language X/Cancel | No billing/scope/theme/language/custom-text changes; Privacy source route is deliberate in current integration spec, not identified as a demo leak |
| Customer simple product | Correct selected dark modal, required-artwork validation, rejected/successful real uploads, quantity entry, exact authoritative review, close/reopen, failed final cart step and independent empty-cart readback | No successful native cart edit/removal or checkout proof |
| Customer Superfunny | Actual product variant selection, default-color handoff, multiple color/size quantities, deferred artwork/review, close/reopen | Agent native walkthrough; no cart write; preview color and ordered quantities deliberately distinguished |
| Responsive/loading/accessibility | Native loading/error/busy states observed; modal/focus/keyboard subset | Local selected desktop/mobile layout and state tests; not all pages on mobile, all locales, all engines or full assistive-tech qualification |
| Performance | Timed repeated Methods failure only | No broad cold/warm performance or field-vitals verdict; service failures need tracing first |

The 313 distinct existing checks passed: admin 76, selected-domain 30, selected browser 40, order/billing/private-preview browser 15, Designer 109, storefront nonbrowser 37, theme-integration browser 3, shell/heading/shared-control browser 3. Six selected-domain database opt-ins were skipped. These results are bounded local evidence with simulated providers/host where stated, not 313 native end-to-end successes. The Home helper's separate five-case rerun is already included in the admin count and is not counted twice.

## Filtered-out claims

- No proof of a second legacy customer UI or fake cart implementation being mounted. Actual customer entry is the selected Designer modal, and Shopify owns its product/cart pages.
- Shared selected helpers living under `examples/.../support` are not by themselves accidental demo imports. Production routes use authenticated adapters. The modal host assumptions in one helper are a concrete issue, unlike the folder name alone.
- Native test orders explain Home's zero live metrics. Recent orders still link to the real Orders list. The five-item Home list is not treated as the entire order catalog.
- Generic Home product titles reflect the bounded list DTO, not proved loss of available immutable names. Detail fetches richer order presentation. This is a possible enrichment improvement, not a reported defect.
- Navy as an active preview while explicitly selected Grijs quantities remain in the order does not establish a wrong variant/cart identity. Bulk quantity selections must survive preview switching.
- The single-placement/method/default-variant product is deliberately simple data. Missing extra controls in that fixture are not missing supported functionality.
- The zero-dollar development billing terms are actual provider-recognized terms, not assumed chat-copy leakage. The existing Privacy route is documented in the current integrated spec; any scope change remains separate from proving a stray demo import.
- Dialog-scoped CUA Cancel selectors failed on slotted footer controls. Frame-level accessible Cancel worked. Those selector failures are not product defects. Direct file-input automation did not emit a chooser, while the visible Browse files action uploaded correctly; that failed selector attempt is also not reported as a product bug.
- Independent final challenge downgraded F4 from a medium defect candidate to a UX responsibility decision, and F7 to a smaller copy improvement. It independently confirmed F6's helper logic and required E1 to remain separate from native outage causation. See [challenge review](whole-audit-challenge-luna-2026-11-08.md).

## Recommended next order

1. Pin the current deployed source/artifact and get redacted request evidence for F2/F3. Reconcile the existing failed cart attempt before another write. Keep build/package qualification E1 separate from live-service causation.
2. Correct and lock down the shared native modal identity/lifecycle once, then verify every native caller's close, reopen, focus and host cleanup. Existing standalone dialog tests are insufficient.
3. Resolve the fresh-entry selection responsibility, category labels and pagination/recovery guidance. Preserve accepted designs, exact money and ordinary resume semantics.
4. Resume three isolated owned QA product lanes only when editor entry/save works: first-time polo, multi-view hoodie and actual larger-variant T-shirt. Save/reload/read back, then publish and customer-cart tests, all with exclusive product ownership and no checkout.
5. Complete the remaining native save/publish/edit-from-cart/export and mobile/locale/engine checks with evidence. Report pass, fail, blocked, unsupported and usability suggestions separately. Do not call unavailable paths passed because unit/browser fixtures passed.

## References used

- [Shopify modal close behavior and migration checks](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/modal#preserve-close-behavior)
- [Shopify App Home Modal API](https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/modal-api)
- [Playwright user-visible outcomes and isolation](https://playwright.dev/docs/best-practices)
- [W3C modal dialog keyboard/focus behavior](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- Bundled Checklist Design Modal, Loading, Uploading media and Adding to cart prompts were used for UI review; they do not override Insignia's security or exact-money contracts.
- [Earlier granular QA plan](integrated-ui-qa-plan-2026-11-08.md), [admin source audit](whole-admin-audit-luna-2026-11-08.md), [customer source/native audit](whole-customer-audit-luna-2026-11-08.md), [state/runtime audit](whole-state-parity-audit-luna-2026-11-08.md).
