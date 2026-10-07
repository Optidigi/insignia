# M5-018 — M5 exit candidate: admin publication/activation integration + G7 closure

## Goal

Move out of publication/availability mechanics and finish the actual M5 acceptance surface.

Deliver one integrated candidate in which a merchant can:
- open the embedded admin reliably;
- edit/configure a product;
- preview it;
- save with correct CAS/conflict behavior;
- request publish;
- see durable publication/activation state;
- never receive a false published/active success when readiness or activation is unresolved.

Close as much of G7 as the current stable app release permits.

Do not reopen M5-014–017 publication-discovery experiments.

## Entry

Begin only after owner-authorized NORMAL merge of PR #48 at:
- base `4bba14fb4415815557ffa5f1e600427a62128489`
- head `125e6d452d713acc9ce7eb741c2506f25857cb8f`
- tree `31ccad58a7a1941fce17451d83ca7326ac712ecc`

Verify actual merge ordered parents/tree and begin from remote main.

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests-mocking, diagnosing-bugs, code-review and handoff skills.

## 1. Freeze availability architecture

New activation uses v3.

Do not:
- create v1/v2 holds for new operations;
- change v3 timing/publication semantics;
- add generic Publication/Catalog discovery;
- add another live availability fixture;
- reinterpret historical evidence.

Availability changes are allowed only if required by an independently reproduced integration defect, in which case stop for principal review rather than silently reopen the architecture.

## 2. Admin publication workflow

Audit and complete the actual M5 merchant flow end-to-end:

- ProductConfig load/create;
- one mutable draft per product;
- copy-to-product creates independent draft content;
- price/setup/tier/placement configuration;
- visualizer preview integration;
- optimistic draft save with explicit version/CAS;
- stale editor => 409/conflict UX, never silent overwrite;
- validation errors surfaced field/section-wise;
- explicit publish request;
- immutable requested revision;
- durable publication operation/outbox;
- effective published pointer advances only after activation contract permits it;
- activation PENDING/HELD/OPERATOR_HOLD/FAILED states visible and truthful;
- no UI path labels a requested revision effective before durable activation completion.

Historical published revisions remain immutable/readable.

## 3. V3 activation integration

Prove the real application/admin path is wired to v3, not only unit fixtures:

- FIRST_PUBLICATION and MODE_CHANGE create v3 hold/evidence;
- SAME_MODE remains no-hold;
- unresolved v1/v2 historical state routes to operator handling;
- REHELD_CONFLICT renders/operator-holds correctly;
- RESTORATION_PENDING renders/operator-holds correctly;
- retry/reentry never redispatches claimed mutations;
- activation evidence and ProductConfig effective pointer commit atomically where specified;
- release/readiness/grant/entitlement failure leaves requested revision pending and previous effective revision intact.

Use PostgreSQL integration tests for durable state transitions.

## 4. G7 embedded-admin matrix

Close the remaining G7 criteria with production-like web/browser evidence.

At minimum cover:

### Navigation/session
- embedded cold launch;
- deep link directly to product config;
- reload;
- back/forward where applicable;
- mobile viewport;
- blocked/restricted third-party cookies;
- expired identity token/session;
- installation generation change.

### Authorization
- exact shop/install binding;
- permitted staff;
- underprivileged staff rejected;
- cross-shop identifiers rejected;
- stale/revoked install rejected;
- private SSR/fragments never bootstrap private data without current authorization.

### Mutation security
- header-authenticated mutation endpoints;
- CSRF/origin/fetch-metadata controls as applicable to the chosen auth model;
- no custom long-lived browser session workaround;
- idempotency on repeated save/publish requests;
- ambiguous save response recovery reads exact durable state instead of replaying blindly.

### Polaris/Preact
- hydration;
- custom-element events;
- form/focus behavior;
- visualizer island communication;
- UI -> canvas and canvas -> UI state synchronization;
- no React/react-konva introduction.

### Refresh/concurrency
- native refresh;
- two-tab stale draft conflict;
- grant-cache expiry/refresh;
- entitlement/readiness refresh;
- late activation-state update in mounted page without misleading success state.

### Production bundle
- production Astro/Preact bundle;
- no dev-only auth/bootstrap dependency;
- CSP/script assumptions compatible with embedded admin;
- supported browser matrix retained for M10 requalification.

Use Playwright/browser tests plus real embedded development-store observations where necessary.

## 5. Real-store G7 authority

A bounded development-store browser qualification is authorized after:
- source/tests complete;
- full offline checks green;
- fresh precredential/full-source reviews clear;
- exact-source CI green;
- source/build frozen.

The browser qualification may use the designated development store/install and one fresh disposable ProductConfig/product fixture if required.

Allowed remote mutations:
- create at most one disposable DRAFT product if no safe existing fixture is suitable;
- application ProductConfig draft/save/publish requests needed to exercise the actual M5 admin flow;
- status mutations performed only through the already-reviewed v3 activation path if the current released app is already capable of the required activation.

No manual publication mutation.

No scope change.

No Shopify app version release.

No Function deploy/release.

No billing/order/cart mutation.

Cleanup any disposable product to ARCHIVED when exact settlement is known.

If current app release/Function state prevents the real activation from reaching its intended bound, classify:
`BLOCKED_RELEASE_BOUND`.

Do not change app version or deploy a Function in this slice.

Instead prepare an exact release proposal:
- current active version ID;
- required extension/config delta;
- exact scopes unchanged;
- exact installation impact known;
- rollback shape;
- tests/artifact hashes.

Return that as the sole remaining M5 activation blocker for separate owner authorization.

## 6. G7 classification

Return each criterion as:
- PASS
- BLOCKED_PLATFORM
- BLOCKED_RELEASE_BOUND
- NOT_APPLICABLE with justification
- FAIL

Do not roll partial evidence into a blanket PASS.

M5 may be considered ready to exit only when:
- merchant config/save/preview/publish workflow is correct;
- G7 acceptance criteria are principal-reviewable;
- activation integration is correct;
- no known unsafe admin/publication state exists.

A `BLOCKED_RELEASE_BOUND` result may leave M5 technically open, but it should isolate the remaining work to one explicit app-release action rather than another architecture investigation.

## 7. Tests

Run:
- full root;
- PostgreSQL18;
- all existing 11 workflows;
- browser/Playwright G7 suite;
- v3 activation integration;
- ProductConfig save/publish concurrency;
- renderer/visualizer regression;
- stress controls where applicable;
- secret/style/boundary checks.

Fresh GPT-6.1-sol/high full-source:
- Spec/correctness;
- Standards/security.

## 8. Boundaries

No new availability architecture research.
No Publication/Catalog discovery experiment.
No scope/version change.
No app release.
No Function deployment.
No M6/M7 feature implementation beyond the minimal preview/admin seams already belonging to M5.
No production launch.

## 9. Handback

Return one integrated PR with:
- PR48 merge receipt;
- M5 admin implementation/evidence;
- v3 activation integration receipts;
- complete G7 criterion matrix;
- bounded real embedded-admin evidence;
- disposable fixture cleanup if used;
- release-bound proposal only if blocked;
- fresh reviews;
- final exact-head CI.

Stop for principal review.

Do not merge successor.
