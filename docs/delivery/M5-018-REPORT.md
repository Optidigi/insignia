# M5-018 — integrated admin and G7 candidate

Status: IN_PROGRESS; live qualification remains gated. No provider/credential/store-browser access, fixture or release has occurred in M5-018.

[Authority](prompts/M5-018-M5-EXIT-G7.md) follows [external acceptance of PR48](PR-048R-principal-review.md). The [normal merge receipt](evidence/m5-018/pr48-merge-receipt.json) records merge407608ab929e703cd2b10972de93cf00c58aa9df and exact approved ordered parents/tree. The fresh branch starts from fetched remote main. Availability architecture, sealed runs and historical fixtures remain closed.

## Implementation

Production admin publication now composes the existing v3 activation coordinator and production v3 adapter. The server may receive trusted readiness capabilities from server composition; browser bodies and unsigned environment JSON cannot supply release authority. Default composition has no trusted release source and durably records WAITING_RELEASE before any availability/publication mutation. This is deliberately incomplete release provenance, not manufactured RELEASE_BOUND evidence.

The HTTP publish command commits the immutable revision, completed durable request identity, current-intent pointer and `m5.publication.intent` outbox together, before any provider preparation. Projection preparation keeps its separate existing publication operation/outbox. A simulated crash before preparation proves the request and outbox survive together. It advances bounded durable steps through the existing coordinator, rechecks current tenant/identity/feature eligibility, and returns the durable phase after activation. A same-mode activation commits without a hold; first publication and mode change produce v3 evidence. Reentry uses the same immutable request and durable claims. Prior effective revisions remain visible when a new request waits.

Mounted pages passively refresh authenticated publication/readiness observations, preserve unsaved controls/canvas/CAS and exact uncertain requests, and clear private editor state after current authorization is rejected. Continuation uses original source version/key even if the draft changes. Requests omit cookies and use fresh App Bridge bearer identity. Server validation supplies bounded field/section feedback. Failed/superseded requests have an explicit terminal FAILED display; unresolved availability takes operator precedence. Interrupted saves accept only the same product/config/install and exact next version with matching content.

## Offline proof boundaries

The PostgreSQL HTTP integration uses real durable config/publication/activation repositories and production v3 transport adapter, with synthetic provider responses and synthetic trusted release premises. It proves FIRST_PUBLICATION, SAME_MODE/no hold, MODE_CHANGE, immutable older revision, exact reentry, and release/entitlement failure preserving the previous effective pointer. It is not live RELEASE_BOUND evidence.

Committed production-bundle browser tests exercise actual Polaris 1.1, Preact hydration, direct Konva events/projection, mobile cookie-free navigation/reload, expired identity, stored-request installation generation, exact interrupted-save recovery, two-tab stale edits and explicit winning-draft review, back navigation, readiness refresh, and mounted late activation with local edits preserved. Existing HTTP/auth negatives cover staff/shop/install and origin/fetch metadata. These local results do not establish unsupported live browser/staff coverage.

## Frozen live procedure

Only after full offline checks, fresh actual GPT-6.1-sol/high full-source reviews CLEAR, natural exact-source CI green and source/build hashes frozen:

1. Inspect the designated development installation and exact current app's active version/configuration through the shared native browser, read-only. Record active version, unchanged required/optional scopes, URL and extension identities.
2. Open the stable embedded installation once, then at most one deep-link/reload observation if it actually exposes the frozen production admin. Record actual hydration/identity/config access; stop on a release/platform boundary rather than using a historical preview or diagnostic auth bypass.
3. If the current released app cannot reach this production admin or its Function bound, create no product/config fixture. Classify each live criterion honestly and prepare the exact bounded release proposal from current facts. Do not release, change scopes, start a Shopify preview, deploy Functions or enable commerce.
4. Any wider live fixture procedure requires an independently reviewable source/build/review/CI gate before execution within the already-authorized one-fixture ceiling. No prior canonical run or product is reused.

Source/build stay frozen during bounded qualification; documentation/evidence integration follows. No successor merge, M6/M7 or launch is authorized.

## Checks and matrix

Final executed-check receipts, G7 criterion matrix, bounded live results, reviews and final-head CI will replace this IN_PROGRESS disposition before principal handoff. No complete G7/M5 exit is claimed here.

## Precredential review correction

The original fresh [Spec](evidence/m5-018/precredential-spec-r1.md) and [Standards/security](evidence/m5-018/precredential-security-r1.md) verdicts at candidate9c2262 were CHANGES_REQUESTED. Their original reports and actual same-session model/effort/read-only settings are preserved. Four concrete findings were independently reproduced and corrected:

- An exact-key ACTIVE reentry detected policy drift but returned ACTIVE. The handler now honors the reconciliation result. The existing progress diagnostic stores a versioned admin reconciliation hold; future GET/reentry exposes OPERATOR_HOLD and new requests are rejected before intent creation. Historical terminal phase, immutable activation evidence and effective pointer remain unchanged. No availability adapter, hold semantics, migration or sealed JSONB is modified.
- Passive authorization denial followed by delayed save restored the private product header. Authorization epochs now fence every save success/recovery/follow-up read and other asynchronous commands. Denial clears private state and renderer. The original price-control-only probe passed despite the header leak; the sharpened header assertion reproduces the exact defect.
- An explicit stale-save409 with independently identical content was accepted as interrupted-response recovery.409 stays conflict with explicit latest-draft review; content recovery applies only to ambiguous results. Two tabs now cover equal and unequal edits with independent command keys.
- A delayed pre-command ACTIVE poll replaced a newer pending publication and erased its retained request. Ordered observation epochs fence obsolete successes/readiness failures; authorization rejection still invalidates in-flight private commands. A production-bundle reordered-response test locks this behavior.

[Regression receipts](evidence/m5-018/review-regression-log-bindings.json) bind original neutral logs to whitespace-rendered committed logs. The first attempted active-phase→operator-hold correction was rejected by the unchanged terminal SQL fence; the final correction uses diagnostic state and preserves that fence. All four browser regressions and both HTTP/v3 lifecycle controls passed before broad requalification.

M0-007 previously did not naturally trigger for admin/database changes (10/10 applicable initial workflows passed). Its existing checks are unchanged; PR/push path filters now also include `apps/web/**` and `packages/database/**`, making the required eleven-workflow M5 admin/activation gate run naturally. No dispatch, rerun, protection change or historical receipt edit is used.
