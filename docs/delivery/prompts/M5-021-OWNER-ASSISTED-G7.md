# M5-021 — owner-assisted native-browser G7 continuation

## Goal

Close the remaining M5/G7 evidence using the owner's normal authenticated Shopify browser because the shared browser is blocked by Shopify human verification before the app iframe.

Do not bypass or automate Shopify human verification.

No further app release or version creation is authorized.

## Entry

Begin only after normal merge of PR #51 at:
- base `e5262267234516251bd4a42367643b700e8854f0`
- head `405511e181ea2a05933ecdcd8ff0c43bfff63df8`
- tree `4d30b8e3139ad3dfac4820345b45cba1167ddb84`

Verify ordered merge parents/tree.

## Immutable state

Active:
`1158986629121 / m5-019r-9b94149272d1`

Rollback:
`1153019904001 / insignia-3`

Never release:
`1158837927937 / m5-019-a9717e1265ef`

Canonical:
`Insignia`
`https://insignia-app.optidigi.nl`
`https://insignia-app.optidigi.nl/admin/products`

No app-version release, creation, scope change or rollback in M5-021.

## Evidence provenance

Keep three provenance classes separate:
1. Owner normal-browser observations.
2. Local/server durable evidence.
3. Existing accepted automated/source evidence.

Never fabricate screenshots, timestamps or provider receipts.

## Phase A — owner reaches real embedded app

Owner:
1. Sign into Shopify normally.
2. Open `insignia-rewrite-dev`.
3. Open installed `Insignia`.
4. Complete Shopify human verification normally if shown.
5. Reach embedded Insignia admin.

Owner captures/reports:
- app iframe/admin appears;
- app identity is Insignia;
- expected `/admin/products` screen appears;
- no unexpected login/error/blank page.

If normal owner browser cannot reach iframe: stop `BLOCKED_OWNER_NATIVE_AUTH`; no mutations.

## Phase B — authenticated readiness before fixture

Prove:
- exact shop `insignia-rewrite-dev`;
- installed app/client matches Insignia;
- backend accepts current installation generation;
- owner/staff identity authorized;
- required grants accepted;
- canonical release/build readiness accepted;
- Function/readiness/commercial premises needed for M5 admin path are not fail-closed.

If extra provisioning/enablement mutation is required: stop and return exact blocker.

## Phase C — real embedded G7 core

Use owner normal browser for native-only criteria:
- cold launch;
- product-config deep link;
- reload;
- back/forward where meaningful;
- mobile/responsive viewport;
- Polaris/Preact hydration;
- visualizer canvas mount;
- UI→canvas and canvas/UI consistency after refresh;
- authenticated API behavior;
- private state removal after auth loss/expired session where safely observable;
- truthful save/publish states.

Existing accepted automated tests may satisfy destructive/impractical negative cases if no contradictory native behavior appears.

Update matrix per criterion:
- PASS_NATIVE_OWNER
- PASS_ACCEPTED_AUTOMATED
- BLOCKED_PLATFORM
- NOT_APPLICABLE
- FAIL

No blanket PASS.

## Phase D — one disposable merchant flow

Only after Phase B passes.

Authorize max:
- one disposable Shopify product;
- one ProductConfig;
- minimum reviewed activation/provider writes required by M5 publication path.

Owner operates browser; local agent prepares exact fixture/marker and records server/database evidence.

Prove:
1. ProductConfig opens/creates.
2. Representative placement/geometry.
3. Representative pricing/setup/tier.
4. Preview renders.
5. Save draft.
6. Durable draft/version readback.
7. Two-tab stale-edit conflict.
8. Ambiguous-save recovery may rely on accepted automated test if unsafe to induce live; native reload/recovery must not contradict it.
9. Publish request once.
10. Immutable revision/request/outbox/operation.
11. FIRST_PUBLICATION uses v3.
12. UI remains pending/non-effective until activation commits.
13. Activation reaches effective state.
14. Refresh/reopen shows exact effective revision/preview.
15. Repeated exact publish action is idempotent.

Do not start M7 cart work.

## Phase E — cleanup

If writes are settled and ownership exact:
- archive disposable product once;
- exact readback proves ARCHIVED/effectively unpublished.

If settlement ambiguous: no cleanup mutation; return blocker.

## Completion

M5/G7 PASS requires:
- real authenticated embedded admin reached;
- no contradictory native behavior;
- core native G7 criteria pass;
- real configure→preview→save→publish→v3 activation completes;
- truthful requested/effective state;
- safe cleanup;
- no unresolved provider write;
- Active remains `1158986629121`;
- source/build unchanged during live evidence;
- fresh final reviews CLEAR;
- final CI green.

If PASS: return one evidence PR and stop for principal approval to close M5/start M6.

## Hard boundaries

No release.
No rollback unless separately authorized for a new concrete safety incident.
No new app version.
No scope change.
No CAPTCHA/human-verification bypass or automation.
No M6/M7 implementation.
No production merchant rollout.
No historical availability/discovery reopening.
