# Current state and owner/operator checklist

## Active assignment

Updated 14 November 2026. Insignia runs only on `app.insigniacustomizer.com`, on rewrite-dev (host alias `prod`, store `insignia-rewrite-dev`). The 12–13 November bug batch and the 13 November [pre-public fix batch](#pre-public-fix-batch-13-november-2026) (#406, #412–#417) are complete: fixed, deployed and natively verified. Main up to `a03b41ba` is deployed (deploy B, 14 Nov) and released as version `1211378860033` (binding `2afc1883`, #464), including #430; the signer runs `afc3c1da` (migration 64). Exact identities are in [Deployed identities](#deployed-identities). **The merchant-issue batch #434–#446 is merged and deployed (deploys A and B, 14 Nov); open leftovers are listed under [Known behaviour, limits and open follow-ups](#known-behaviour-limits-and-open-follow-ups). Next: the 16–17 November checks (small pending checks), then phase 2, UI acceptance.** The [operating model](operating-model.md) owns permissions; the [specification](../architecture/implementation-plan.md) owns requirements.

### Picking this up

1. **Verify the checkout.** `git fetch origin`, then check branch, `HEAD` and `git status -sb`; start new work from current `origin/main` and preserve dirty work and other worktrees. Deployed application source is main `a03b41ba` (binding `2afc1883`) for web, worker, verifier, theme and host inspector (deploy B, 14 Nov), and `afc3c1da` for the signer and schema 64. `git diff --stat 2afc1883 origin/main -- . ':!*.md'` lists non-Markdown changes since then. Anything else is undeployed drift; Markdown-only commits are not code drift.
2. **Read** this section, [Known behaviour, limits and open follow-ups](#known-behaviour-limits-and-open-follow-ups) and the [checklist](#owneroperator-checklist) rows your task touches.
3. **Find the owner of a fact.**
   - This file: status, deployed identities, known limits and owner/operator actions.
   - [Operating model](operating-model.md): workflow, permissions, standing approvals and protected resources.
   - [Specification](../architecture/implementation-plan.md): requirements and the owner decisions behind them.
   - [Runtime README](../../deployment/m5-runtime/README.md): deploy mechanics.
   - History files (linked at the end of this section): consult them for a specific question.
4. **Deploy** autonomously to rewrite-dev under the standing 13 November approval in the [effective resource scope](operating-model.md#effective-resource-scope) (its limits are listed there; anything outside them still needs the owner). Follow the runtime README's [current state](../../deployment/m5-runtime/README.md#current-state) and [deploy next](../../deployment/m5-runtime/README.md#deploy-next). A theme or app-version release makes quotes fail closed from candidate creation until fresh admission after the release, about 35 minutes.
5. **Standing approvals** are in the operating model's [effective resource scope](operating-model.md#effective-resource-scope), for example rewrite-dev test-gateway orders (then update the protected facts below). Consumed approvals are not reusable.
6. **Local tests on the dev host:** use the toolchain pins in the [README](../../README.md), and set `TMPDIR` to a directory under your home. `/tmp` there is a small per-user tmpfs that is nearly full.
7. **Native QA on the dev host:** `~/insignia-qa/RECIPE.md` (outside the repo) drives the Designer iframe with T3 preview tools; `~/insignia-qa/load/loadtest.mjs` is a bounded scripted-buyer load test. All browsers on the host share one visitor address, so new buyer sessions count against the 60-per-hour per-visitor limit; leave headroom, empty every cart and place no orders unless a task explicitly needs a test order.

### Remaining work and end shape (owner-agreed roadmap, 12 November 2026)

**End shape.** Insignia is a public Shopify app on `app.insigniacustomizer.com`:
- The storefront Designer quotes per-line, quantity-independent signed prices (cart-line v3). Checkout Functions verify them.
- Per-shop signing keys never expire; they live only in the separate signer.
- Customer artwork email goes from `noreply@insigniacustomizer.com` to real buyers.
- Merchants pay the Lean plan ($49.99 / 30 days, with a trial) through Shopify billing.
- Production runs with scoped credentials, off-host encrypted backups (signing wrapping key in separate custody), installed monitoring and alerts to `@optidigi.nl`, a qualified restart and rollback, and a working uninstall/privacy lifecycle.
- Rollout to real merchants happens only after the owner approves.

| Phase | Status | What remains | Needs the owner | Done when |
| --- | --- | --- | --- | --- |
| 1 Storefront flow on the new domain | **Done** 12 Nov | — | — | Owner ran the full flow; no deltas. |
| Signing hardening | **Done** 11 Nov | Automatic: the worker job destroyed key 1 at 12 Nov `00:00:29Z` and destroys key 2 from 16 Nov 00:00Z. | Optional later: HSM/KMS (e.g. AWS KMS Ed25519) instead of the local signer. | Non-expiring key 3 signs via the signer; retired keys hold no private half. |
| 4 Customer email (development) | **Done** 11 Nov | — | — | Received SPF/DKIM/DMARC pass and order #1009 mailed `admin@optidigi.nl` only. |
| Bug batch (#334–#351 and follow-ups) | **Done** 12–13 Nov | — | — | 17 original issues and their follow-ups fixed, deployed in three rewrite-dev deploys and natively verified ([batch summary](#bug-batch-1213-november-2026)). |
| Pre-public fix batch (#406, #412–#417) | **Done** 13 Nov | Follow-up #424 (S4). | — | Fixed, deployed in deploy 4 and natively verified ([batch summary](#pre-public-fix-batch-13-november-2026)). |
| 2 UI acceptance | **Next** | Agent prepares a review checklist of merchant-admin and Designer screens and states (wide and narrow, both themes); fixes findings. | Review and accept (checklist rows "Merchant UI" and "Selected Designer visual fidelity"). | Explicit owner acceptance recorded. |
| 5 Production foundations | Open | Production storage and credentials cutover; off-host encrypted backup plus a full loss-recovery rehearsal (RPO 24 h / RTO 4 h); installed monitoring and alert relay with receiver authentication; restart and rollback qualification. | Allocate credentials and storage. The owner implements server backup in a separate session; it must back up `runtime/signer-secrets/signing-wrap-keys.json` in custody separate from database backups. | The matching checklist rows close with their stated evidence. |
| 6 Commercial readiness | Open | Real $49.99 / 30-day plan, invoice and trial-to-paid; public-app/distribution settings; merchant, market and currency eligibility (EUR); **email proof:** Cloudflare arbitrary-recipient sending entitlement evidence so customer mode can mail real buyers (development mode stays admin-only until then). | Billing, distribution and market choices; obtain the Cloudflare entitlement evidence. | The "Native/commercial eligibility" row closes and customer mode is enabled with real evidence. |
| 7 Uninstall and privacy | Open | Reconcile the VAT installation's original uninstall dispatch against actual provider state; qualify erasure and reinstall fencing end to end. (#406, batched erasure of a shop's buyer sessions, is done in the pre-public fix batch.) | A concrete allocation for any new effect. | The "Genuine uninstall/privacy" row closes. |
| 8 Rollout | Not approved | First real merchant. | Explicit go. | Owner authorization after the gates above. |

**Small pending checks.**
- Renewal of an expired quote, natively, from 16–17 Nov (with the key 2 check): a test cart was seeded on 13 Nov `20:15Z` in the dev host's **default** T3 preview browser profile (1 × Zwart / M, $17.45, `_insignia_line_v3`; T-shirt demo). Open the cart page in that profile, renew it, check out or empty it, and record the result. Do not empty that profile's cart before then.
- **End-to-end purchase after deploy 4 (13 Nov, about `20:05–20:11Z`):** Designer (upload on Linkerborst, typed quantity 2) → Review $34.90 → cart line 2 × $17.45 with a `_insignia_line_v3` carrier (transform priced it; variant $9.95) → checkout loaded without validation errors → test-gateway order `FXUC9QZLM`, $42.90 with shipping. Insignia recorded the order, paid fact, binding and line. No artwork notification, as expected: notifications are planned only for "artwork later" placements.
- 16 Nov: key 2's destruction. Confirm that the worker logs `signing_key_destruction` with count 1, a Designer Add to cart still succeeds and no `public_config_drift` line appears. The published config still lists key 2 until the next owner rotation or publication, and quote readiness tolerates that (#333).
- Per-visitor and shop limits under load: test locally, not by flooding prod.
- Per-visitor 429 through Shopify's app proxy: run `~/insignia-qa/load/limitprobe.mjs` (raise its cap to about 60) at the end of the 16–17 Nov session. It blocks new buyer sessions from this host's visitor address for up to an hour.
- Delete the owner-supplied Cloudflare Rules token when the domain work is final; the owner will say when.

**Owner decisions in force (11–14 November 2026).**
- Merchant-issue batch (14 Nov): automatic recovery of an interrupted publish (#446 Option A) could not be built within the schema and operator-resolution rules; the owner accepted shipping the throttling fixes and deciding the operator-hold exit (#466) before rollout. Publish keeps the ≥30 s session-token rule; the server-continuation option is #468. Shopify's contextual save bar is the single save path (its Save is Save draft); Publish stays in Insignia's header (#441). An R2 CORS rule for `app.insigniacustomizer.com` on the Insignia artwork bucket is allowed if #434 needs it. Admin authentication reuses a verified online grant per shop, staff member and session until it expires, with a short per-shop installation cache fenced by generation; staff-sensitive actions keep a fresh exchange (#435).
- Standing grant (13 Nov): deploy, install and change rewrite-dev and the Insignia app without asking, within the limits in the [operating model](operating-model.md#effective-resource-scope).
- Accepted limits (13 Nov): Review may wait behind an in-flight autosave; two tabs on one cart line, last write wins.
- Signing keys do not expire.
- Insignia lives only on `insigniacustomizer.com`; alert inboxes stay on `@optidigi.nl`.
- The legacy generic `insignia.optidigi.nl` stack is removed. The legacy Stitchs, Superfunny and Custom stacks must keep running untouched.
- The VAT store's leftover old-host uninstall webhook stays.
- The Cloudflare status Worker detects removed services by itself.
- Standing OK for rewrite-dev test-gateway orders.

### Pre-public fix batch, 13 November 2026

Owner-approved 13 November 2026, before the public app. A native keyboard and six-language QA pass on version `1206211837953` (evidence under `~/insignia-qa/runs/2026-11-13/` on the dev host) filed #412–#417; the owner also pulled #406 forward from phase 7. All are fixed, deployed in deploy 4 and closed.

| Issue | Severity | Fix | Native result (13 Nov, about 19:40–19:50Z) |
| --- | --- | --- | --- |
| #416 | S1 | #419: the quantity field is a text input with a numeric keypad; only plain digits count | Typed `1.5` and `1,5` stay as typed, invalid and unpriced; Review stays on Quantities; `2` prices 2 items |
| #412 | S3 | #420: a keyboard open focuses the visible skip link; a pointer open focuses the Designer without showing it | Skip link focused with a 3 px ring |
| #413 | S3 | #420: Tab wraps inside the Designer | Tab from "Add artwork" (last stop) reaches the skip link; Shift+Tab wraps back |
| #414 | S3 | #421: name "+n, All N options" | "+1, All 6 options" |
| #415 | S4 | #421: the trailing action is hidden from the name when the heading already contains it | Named "Choose artwork" |
| #417 | S4 | #423: an unnamed (restored) artwork is labelled at render time in the current language | Restored draft reads "Ontwerp" in Nederlands; the rejected-upload path was not repeated natively |
| #406 | — | #422, migration 63: erasure fences only; bounded cleanup removes the sessions | Readback only: both functions no longer delete sessions; no uninstall run |

**Deploy 4** (13 Nov, standing [dev store and app grant](operating-model.md#effective-resource-scope)): source `9b5dbdee`, binding `1bd804a2` (#425), version `1207622696961` (`native-a11y-quantity-9b5dbdee`), schema 63, fail-closed window `19:05:02Z`–`19:34:38.0Z` (about 30 min, no buyer rows in it). Web's `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` is `appKey` only. Record in the [deploy history](history-2026-11-12-bug-batch.md#deploy-4-main-9b5dbdee--deployed-and-released-13-november-2026).

**Follow-up.** #424 (S4): a cart-review row for a product without a title fell back to "Artwork" in the page locale. Fixed on main by #430; ships with the next theme release.

### Bug batch, 12–13 November 2026

**Issues.** All 17 original issues are fixed, merged and deployed: #334–#343 and #345–#351. So are the follow-ups #366–#370, #371 (items 1–6), #374, #375, #381, #382, #386, #390, #392 and #397, plus the session-quota copy (#407). Open: only #406.
- Fix PRs: #333, #352–#365, #372, #373, #376–#378, #380, #384, #385, #387–#389, #391, #394, #395, #398–#405 and #407.
- Deploy binding PRs: #379, #393, #408. Deploy docs PRs: #383, #396, #409.

**Deploys to rewrite-dev.** Each deployed the server side first, then released one theme-only app version; Functions stayed byte-identical. Records are in the [deploy history](history-2026-11-12-bug-batch.md).

| Deploy | Source / binding head | Version (profile) | Schema | Fail-closed window |
| --- | --- | --- | --- | --- |
| 1, 12 Nov | `fb436e16` / `9a577bb1` | `1205760688129` (`native-buyer-fixes-fb436e16`) | 59 | `17:15:23Z`–`17:58:20Z`, about 43 min |
| 2, 12 Nov | `bf512171` / `3ca7b253` | `1205994881025` (`native-repair-messages-bf512171`) | 59 | `20:40:22Z`–`21:13:45.8Z`, about 33 min |
| 3, 13 Nov | `c78a8179` / `04e8a411` | `1206211837953` (`native-session-drafts-c78a8179`) | 62 | `01:06:36Z`–`01:39:37.4Z`, about 33 min |

No buyer traffic arrived in any window, and no deploy made a production resource migration, new scopes or markets, a database reset, history erasure, a protected VAT retry, a checkout, order or payment, or a consumed sender or alert drill. The #333 web-only fix for the 12 November published-config drift incident was deployed at 12 Nov `01:00:35Z`, before deploy 1.

**Result.** Acceptance takes about 0.8 s server-side (777–841 ms in deploy 3; `release-read` 4–7 ms, no `release-collect`). The cold path of #345, which took 3.6–5 s, is gone.

**Owner decisions of the batch** and where each is recorded:
1. Buyer-actionable and transient errors are 4xx; transient ones are 409 `BUSY` with `Retry-After`, and the client retries acceptance automatically. 5xx is only for unexpected errors: [spec §8.3](../architecture/implementation-plan.md#83-http-contracts).
2. Per-visitor session limit: a sliding window of 60 per hour, with `Retry-After` and `SESSION_RATE_LIMITED` copy: spec §8.3 and [§10.4](../architecture/implementation-plan.md#104-retention-and-erasure).
3. After a reload, a saved draft is offered behind "Continue your design?": [spec §8.2](../architecture/implementation-plan.md#82-state-model).
4. Escape does exactly what the close button does; an open nested dialog closes first: [spec §8.1](../architecture/implementation-plan.md#81-bootstrap-and-visual-reference).
5. Deploys per group, then "in whichever shape is sensical", including theme releases with fail-closed windows on rewrite-dev. Used for deploys 1–3 and consumed: [operating model](operating-model.md#effective-resource-scope).
6. Spanish: "personalización" is the whole design and "diseño" the artwork: [translation reference](../../frontend/skills/insignia-translation-review/references/bundled-languages.md).
7. #374: no rollback to a web image from before #348: [runtime README](../../deployment/m5-runtime/README.md#current-state).
8. #366: drafts may have no quantities, and autosave reuses the design's draft ID: spec §8.2.
9. #371: tombstones clear after a successful repair and expire after 3 days ([spec §8.4](../architecture/implementation-plan.md#84-acceptance-and-cart-application)). Lifetime session quotas rise to 100 drafts, 1,000 proposals and 250 cart applications and commands instead of minting a new session; an exhausted quota shows specific copy with no Retry (`SESSION_QUOTA`): spec §8.2 and §8.3.
10. #375: a one-step owner emergency revoke: [spec §5.5](../architecture/implementation-plan.md#55-keyconfiguration-rollout) and the [runtime README](../../deployment/m5-runtime/README.md#signing-wrapping-key-kek-custody).
11. #345: the 10 November rule "refresh at most once per shop per 25 s" is unchanged; only the verifier's reuse condition became stricter: spec §8.4.

### Deployed identities

Rewrite-dev on host alias `prod`, as of 14 November 2026 `08:49Z` (deploy B).

| Component | Identity | Source |
| --- | --- | --- |
| Shopify Active version | `1211378860033`, profile `native-merchant-batch-a03b41ba`; 40 versions, module hash `a3809ff5…`; NEVER_RELEASE versions inactive | theme from main `a03b41ba` (binding `2afc1883`, #464) |
| Functions | transform wasm `5c8708b5…` (module `826a9059…`, query `02ab5bce…`), validation wasm `6c362b36…` (module `076bfef2…`, query `5867e61f…`) | `aa3b6166` |
| Web | `sha256:fde5a841…` (deploy B) | main `2afc1883` |
| Worker | `sha256:71e75d2a…` (deploy B) | main `2afc1883` |
| Verifier | `sha256:797714b3…`, code manifest `5a865bdd…` (deploy B) | main `2afc1883` |
| Signer | `sha256:e9b1f153…` (since 13 Nov `21:54:55Z`, #431) | main `afc3c1da` |
| Host inspector | `~/insignia-artwork-releases/782f474cfc24a9a157743bcb598f70059e76f027/` (deploy B; prior `b2d63170…` kept for rollback) | tree `782f474c` of main `a03b41ba` |
| Database | PostgreSQL 18.6, schema 64; expected column-ACL digest `ae2043f790171fa854016a8679e5b155`, function-ACL digest `bda94d7ecad6c07dc0cecd83d79983d0` | 64 repository migrations |

**Deploy B** (14 Nov, standing grants): main `a03b41ba`; CI runtime 43572894659 and foundation 43572894686. DB checkpoint restore-verified `08:05:39Z`, shredded `08:49:49Z`; no migration. Stage 1 `08:06:09–11Z` (admission record `2289237c…`); host inspector switched to package `782f474c…` at `08:06:42Z` (socket ready; #445 probe: 12001×1 and 7000×6000 PNGs return `DIMENSIONS_TOO_LARGE`). Candidate `1211378860033` created once `08:07:28Z` (only the 15 theme assets, 8 changed; Functions byte-identical). Binding #464 merged `08:22:40Z` as `2afc1883` (main foundation attempt 1 failed on the known "Escape routes every close" flake; attempt 2 passed). Phase B `08:48:43–45Z`; one `app release` `08:48:55Z`; fresh admission `ec5fe957…` at `08:49:07Z`. Fail-closed window `08:07:28Z`–`08:49:07Z` (about 42 min) with no buyer activity. No error lines; ACL digests and protected facts unchanged. Receipt `a03b41ba-deploy-B/deployment-receipt.json` (sha256 `448effd1…`) on both hosts.

`1bd804a2` is the binding of application source `9b5dbdee`. Fresh web and quiesced worker reads matched release record `0e335396…` at `19:34:37.985Z`; that proof is finite, and every purchase still needs live checks. Deploy receipt: `/home/serveradmin/.local/share/insignia/recovery-release-20261110/9b5dbdee-deploy-1/deployment-receipt.json` on prod (copy at the same path on the dev host). The later server-only signer deploy (#431: migration 64 and the signer image) has its receipt in `afc3c1da-signer-1/`. **Deploy A** (14 Nov, server-only under the same profile and version; no migration, app version or fail-closed window): CI runtime 43553114370 and foundation 43553114398 on `42bf0615`; DB checkpoint restore-verified `03:59:38Z` and shredded `04:01:04Z`; verifier, web and worker replaced `03:59:51–54Z`; fresh admission record `52306f38…` at `04:00:23Z`; no error lines; ACL digests and protected facts unchanged; receipt `42bf0615-deploy-A/deployment-receipt.json` (sha256 `ed0954f2…`) on both hosts. Prior images stay loaded.

**Protected facts:** orders 10, paid 9, refunds 2, bindings 9, lines 12 (after the 13 November post-deploy test order, confirmation `FXUC9QZLM`, recorded `20:11:26Z`). Every preflight expects these; update them after each test order.

**Signing keys** (epoch 0; no rotation scheduled or due):

| Key | State | Days | Private half |
| --- | --- | --- | --- |
| 1 | destroyed 12 Nov `00:00:29Z` | 20736–20767 | none |
| 2 | retiring; destroyed from 16 Nov 00:00Z | 20766–20771 | none |
| 3 | active, non-expiring | 20768–2147483647 | wrapping key `signing-20261111`, held only by the signer |

The signing wrapping key lives only in `runtime/signer-secrets/signing-wrap-keys.json` (owner 10101, mode 0400); see the [runtime README](../../deployment/m5-runtime/README.md#signing-wrapping-key-kek-custody). The worker still needs the old shared KEK `m5-runtime-20261011` (`INSIGNIA_CREDENTIAL_KEY_*`), because it is the shop-credential ring for offline tokens; it no longer protects any signing key. [Key 2 rotation receipt](evidence/technical-merchant-completion/native-signing-rotation-development-2026-11-09.json).

**Customer artwork email** runs in development mode since 11 Nov `23:45:02Z`: recipient fixed to `admin@optidigi.nl`, no backfill (the two earlier PENDING notices stay untouched). Customer mode for real buyers stays disabled.

**Custody locators** on prod (for an authorized operator; not fresh-clone prerequisites or execution authority), under `/home/serveradmin/.local/share/insignia/`:
- `recovery-release-20261110/`: deploy receipts `afc3c1da-signer-1` (signer only), `9b5dbdee-deploy-1` (current release), `c78a8179-deploy-1`, `bf512171-deploy-1`, `fb436e16-deploy-1`, `origin-lock-20261111-1`, `cart-line-v3-final-42943190043-1`, Phase A `cart-line-v3-42932707400-1` and `functions-renew-final-42893217931-1`.
- `legacy-generic-removal-20261111/`: final dump, compose file, env and crontab of the removed `insignia.optidigi.nl` stack (0600).
- The host has no mutable checkout; services use immutable images and packages.

### Known behaviour, limits and open follow-ups

**Merchant-issue batch #434–#446 (14 Nov 2026): merged, deployed and natively verified** in deploy A (`42bf0615`, server-only) and deploy B (`a03b41ba`, version `1211378860033`). Evidence: `~/insignia-qa/runs/2026-11-14/deployA-verify/` and `deployB-verify/` on the dev host; each issue has the native result in a comment.
- Fixed: #435 (#451: grant and installation reuse; authentication 0–25 ms per request, was 1–1.5 s), #437 (#449: decimal comma), #438 (#450, #457: incomplete placements save; coded 422s with reasons, no Retry, edits kept), #443 (#453), #436 (#458: server publish work about halved; "Publishing…" progress and settlement without reload; ~21 s click to Published natively), #439 and #440 (#455: DB-only setup status), #441 (#462: Shopify save bar is the single save path), #442 (#463), #444 (#461), #445 (#459: `DIMENSIONS_TOO_LARGE` from the new host inspector), #454 filed (checklist calibration with an active appearance photo).
- Open: #434 — code side shipped (#460); uploads still fail because the `insignia-demo` R2 bucket CORS rule allows only the store origin. No available credential can edit bucket settings and the browser has no Cloudflare session, so (owner, 14 Nov) the admin preview moves to a same-origin route (in progress). #446 — throttling fixed (#451, #452); an existing `OPERATOR_HOLD` has no exit because operator recovery is not wired and Option A is blocked by the schema and operator-resolution rules: #466. `QA cover B – Tee` stays held as its evidence. #465 — artwork cleanup re-claims rows every few minutes without settling (operational).
- Owner decisions (14 Nov): ship #451/#452 for #446 and decide #466 (operator-hold exit) before rollout; keep spec §7.1's ≥30 s session-token rule for publish for now, with the server-continuation option logged in #468. Both are pre-rollout follow-ups.
- Not natively verified: phone keyboard with the pinned editor canvas at 390 px, horizontal scroll inside the Products table in the mobile app, the host toast duration in a visible tab (a hidden test tab kept it >60 s; 8 s is passed).
- Known gap: the server copy action rejects selected setups (`PRODUCT_IDENTITY_CHANGED`); the editor's Copy setup does not use it.
- Merchant QA: two concurrent merchant sessions triggered #446; with #451 the per-request Shopify reads are gone, but keep one merchant session at a time until #466 is decided. QA products on rewrite-dev are Draft or published test products (titles `QA merchant P1–P3`, `QA repro A – …`, `QA cover B – Tee`).

**Released in deploy B:** #430, which fixes #424 (untitled cart-review rows read "Customized product" in the Designer language; unnamed artwork gets its own singular label) and makes autosave stop only on `SESSION_QUOTA`, pausing until `Retry-After` for other 429s.

**Released but not visible to buyers.**
- German theme cart messages: the *Sie* text (#391) is released, but the store publishes English only (`/de/cart` returns 404), so buyers don't see it.

**Not natively verified.**
- The per-visitor 429 arriving through Shopify's app proxy with `Retry-After` (#348); planned for 16–17 Nov (small pending checks).

**Natively verified since deploy 3.** A brand-new visitor session: fresh incognito sessions on 13 Nov created buyer sessions at `19:48:17Z` and `20:09:30Z`, and the visitor-admission row holds both issue times in its sliding window, so the trusted Cloudflare client-chain header works end to end.
- Renewal of an expired quote (from 14 Nov, see small pending checks).

**Noted in the #405 review.**
- Accepted (owner, 13 November 2026): Review can wait behind an in-flight autosave. Saves to one draft run in order at acknowledged versions, which is what prevents CAS conflicts; it costs one short request.
- Accepted (owner, 13 November 2026): two tabs editing the same cart line overwrite each other; the last write wins, bounded. Detecting it would need a new buyer-facing conflict step.

**Known behaviour.**
- A restored draft labels its artwork with the translated word for artwork ("Artwork", "Ontwerp", …) instead of the file name: drafts store IDs only (#423).
- On a same-page reopen, an unapplied Designer quantity edit is kept; after a reload the cart quantity is used (#397, #403).
- Cart replacement adds new lines before removing old ones (#353), so it briefly needs extra stock. After a 422 it falls back to `cart/change.js`; that pairing is heuristic and can still refuse when stock is tight ([spec §8.4](../architecture/implementation-plan.md#84-acceptance-and-cart-application)).

**Limits.**
- The signer's 120 signatures per minute per shop (burst 60) is the next per-shop throughput cap, now that #381 removed the acceptance-fence starvation.
- Emergency revoke (#375) needs a staff session in the embedded admin. The signing page locks itself read-only in a browser after one start, so a second run needs another browser profile or cleared site data. An operator-only path without a staff session would need new owner decisions ([runtime README](../../deployment/m5-runtime/README.md#signing-wrapping-key-kek-custody)).
- Each theme release makes quotes fail closed for about 30–35 minutes on rewrite-dev with the current binding procedure.
- The protected VAT installation (`stitchs-vat-verification`) has no stored credential. Since #361 the worker logs `lifecycle_credential_unavailable` at warn, once per process start and then at most hourly. It stays `UNRESOLVED_NO_RETRY`; its leftover old-host per-shop uninstall subscription stays by owner decision.

**Dev host.**
- `frontend/designer/scripts/customer-localization-browser-check.mts` fails two tests locally on this host only (Chromium crash or timeout). They pass in CI.
- `/tmp` is a nearly full per-user tmpfs. Point `TMPDIR` for isolated PostgreSQL and test temp directories at a directory under your home.

### Continuing limits and custody

- Rolling back to a pre-PR298 image would also need the prior app version re-released and a qualified v2/v3 cart decision; neither is authorized, and since #374 no web image up to `bf512171` is a rollback target.
- Q1 terminal-decline recovery is integrated. Unavailable, lost and postcommit acknowledgements retain exact operation identity. With schema52 terminal markers, use compatible recovery/fix-forward; schema51 or old acceptance writers are not a valid rollback. The original same-tab cart report remains unattributed; its time/browser/error ID is unavailable and must not be requested again or assigned a shared cause without evidence.
- Native Copy discovery/review and Cancel/scrim removal with pointer reopening passed on the earlier startup artifact. Fields not displayed, precise chooser timing, busy-copy and native early-aftershow are not qualified by that result. QA009 early-aftershow/leave-resume and uncancellable late-response limits remain scoped in [history](history-2026-11-09-precutover.md). New close/upload behavior is covered by built-UI/CI checks; deploys 1–3 observed Escape and the close confirmation natively, not the unfinished-upload warning.
- Retention reconciliation recorded ten expired capture paths disposed after 388 guards, four minimal projections retained, 363 operation records and five metadata inventories unchanged. Four local auth files remain held behind exact process-read access. Pathname absence does not prove physical erasure. Nov9 checkpoint payload was disposed before its deadline; Nov6 custody is not a fresh verified backup. Preserve active configurations, permanent inspector/verifier custody and minimal unresolved authority.
- The `app.insigniacustomizer.com` certificate (Let's Encrypt, HTTP-01 through Cloudflare) expires 9 Feb 2027; renewal uses the same path. The origin admits only Cloudflare ranges ([runtime README](../../deployment/m5-runtime/README.md#cloudflare-only-origin)).
- Owner visual acceptance, native EUR and complete off-host/object recovery remain separate.

[Frontend review links](../../frontend/README.md#native-development-review) identify the retained fixtures. Deploys and observations of 10–13 November, including the canonical host, signer, key 3 and the 12 November incident, are in the [deploy history](history-2026-11-12-bug-batch.md). [Integration history](history-2026-11-10-integration.md) records the combined-source result. [History through 8 November](history-through-2026-11-08.md) and [9 November preparation history](history-2026-11-09-precutover.md) retain original observations and authority context; they are not current commands.

## Owner/operator checklist

Earlier selected-UI transfer and qualification results are in [delivery history](history-through-2026-11-08.md#selected-admin-test-transfer). Their synthetic/local limits remain; owner visual acceptance and production qualification are separate.

This checklist retains outstanding owner/operator obligations from their dated source observations; active engineering work is above. The responsible-party columns identify missing resources, human actions or production allocations. Source links retain exact grants/observations; consumed allocations are not reusable. Private access uses existing verified SSH/custody or an owner-approved private credential channel, never chat/Git secrets.

| Item / status | Responsible party and exact next action | Resource, prerequisite and evidence needed to close |
| --- | --- | --- |
| Merchant UI — owner-unaccepted | **UI/integration engineer:** support review of the deployed candidate and any explicitly allocated remaining native-write qualification; **owner:** final judgment on wide/narrow screens and meaningful state behavior. | Rewrite-dev → insignia-1. Use spec inventory and local preview; native reads require rechecked access. Source/type/rendered controls, reviewed real screens and explicit owner acceptance; tags/HTTP200/canvas counts alone do not close it. |
| Selected Designer visual fidelity — owner-unaccepted | **Agent:** qualify the selected PR223 Designer on wide/narrow native storefronts, including retained production choices, geometry and artwork/review state. **Owner:** accept the resulting native UI. | The latest §15 instruction selects the new UI for every customer flow. PR223 and the retained selected components/reducers are the current presentation reference. The older S24 legacy-modal asset is historical context, not a prerequisite or fallback for this selected integration. Local browser proofs do not establish native visual acceptance. |
| Automatic customer artwork email — enabled on rewrite-dev in development mode (admin recipient only) | **Agent:** keep customer mode disabled until real arbitrary-recipient provider evidence exists. **Owner:** decide when to qualify Cloudflare arbitrary-recipient sending (entitlement evidence) for real buyer addresses. | Received authentication/delivery qualified from owner-supplied headers for `<lubIW02KieKU8MqVGX0zxlsoqHosdDYpQhoH@insigniacustomizer.com>`: SPF, aligned DKIM, DMARC and compauth pass; Inbox, SCL 1. Development-mode runtime enabled `23:45:02Z` with a no-backfill cut-off. The earlier two PENDING notices are untouched. Test order #1009 sent `<QCD5JF4Q5NbsESM4S2o1Z8Q2TDxLCG3EPSSN@insigniacustomizer.com>` to `admin@optidigi.nl` only. Customer mode, real-buyer recipients and backfill are not enabled. |
| Genuine uninstall/privacy — unresolved | **Owner/native operator:** reconcile the original VAT dispatch through actual provider state and genuine generation-bound callback evidence; obtain a new concrete allocation only for genuinely new effects. **Agent:** continue offline qualification and preserve the existing decision. | VAT installation `998524223812`, generation1, original intent `2026-10-18T22:19:55.728Z`: **UNRESOLVED_NO_RETRY**. No retry/reinstall/fabricated callback; protect rewrite-dev, receiver/worker and minimal immutable authority. Close with actual settlement plus qualified erasure/reinstall fencing, not failed calls. [Record](evidence/technical-merchant-completion/NATIVE.json), [lifecycle runbook](../../deployment/lifecycle/README.md). |
| Production storage/credentials — owner-held cutover | **Agent:** prepare exact current consumer/rollback inventory and use already-qualified isolated reconnect seams. **Owner/operator:** provide/allocate scoped production storage and credentials through private custody, then perform the identified bounded cutover. | Private `insignia-public` target; web/worker/inspector/verifier/backup/monitor/recovery consumers, existing wrapping/signing/offline credentials and retained-key dependencies. Local schema45 SCRAM rotation/drain/reconnect/rollback passed; actual native transition has not. Close with new-role/profile readback, old-credential rejection, full consumer readiness and unchanged records/permissions. [Runbook](../../deployment/m5-runtime/README.md#credential-rotation-procedure). |
| Complete backup/recovery — unqualified | **Owner/operator:** allocate source/off-host credentials, recipient certificate and separate recovery-key custody; install daily encrypted backup/replication and perform isolated complete loss recovery. **Agent:** prepare/review the runbook and rehearse safe boundaries locally. | Current database and private artwork/preview objects, seven-day maximum archive retention capped by existing promises. Close with actual off-host DB+object restore, erasure/expiry replay before exposure, measured **RPO24h/RTO4h**, rollback and signed-off recovery ownership. Local/DB-only results do not close it. [Backup runbook](../../deployment/backup/README.md). |
| Monitoring/email authentication — unqualified installation | **Owner/operator:** allocate/install the scoped producer/monitor and private relay configuration, verify outage/recovery wiring, obtain original receiver authentication verdicts. **Agent:** prepare qualified packages and checks. | Availability/backup/stalled-processing/overdue-deletion alerts to `admin@optidigi.nl`. Four bounded drill deliveries were confirmed; **do not resend** that consumed drill. Close with installed monitoring and receiver SPF/DKIM/DMARC evidence. [Alert record](evidence/technical-merchant-completion/NATIVE.json), [alerts runbook](../../deployment/alerts/README.md). |
| Native/commercial eligibility and release envelope — partial | **Owner + release engineer:** qualify applicable real $49.99/30-day contract/invoice/trial-to-paid and distribution/public-app settings, representative merchant/market/currency eligibility and supported capacity/enforcement on exact release artifacts under concrete native allocations. | Current positive journey is bounded USD/US development use; zero-dollar selection/cancel/reauthorization budgets are consumed. EUR/GBP or other contexts are not enabled/advertised by this evidence. Preserve exact money, ordinary supported discounts, OptionA residual, Function budgets and independent proof. Close the applicable spec gates, including artifact-specific stack/resource justification, without replaying deferred tier/FX/Plus/usage matrices. [Billing record](evidence/lean-v1/native-billing-lifecycle-2026-10-17.json). |
| Fixture/test-gateway disposition — bounded USD test order complete; retain review fixture | **Native operator:** read current owned fixture and gateway/test settings, compare original baseline/consumed allocation, prepare exact cleanup disposition; act only within a valid specific grant. | Owned product `10519322493211`, variant `54211066986779`, marker `insignia-m5-acceptance-1f443da8-75c4-44d1-99be-27c397e10c26`, retained test orders/purchase history. Preserve the fixture needed by current UI and all financial/history facts. Preserve the original fixture and the separately allocated demo product10585669959963. Its publication, paid native test order#1005, original artwork and current native cart handoff are qualified above. No automatic archive, change to existing stock, gateway toggle or reuse of a consumed payment budget. The new one-order allocation is consumed; no second checkout, gateway change or history deletion is authorized. Close with exact settings readback and retained-history/cleanup evidence. [Journey](evidence/lean-v1/native-lean-purchase-original-2026-10-17.json). |
| Runtime promotion/restart/rollback — production gap | **Agent:** prepare a minimal reproducible deployment/promotion plan and compatible immutable artifact inventory. **Owner/operator:** allocate final production effects and durable image/archive custody, qualify full restart/recovery. | The 19October audit observed verifier Docker restart policy `no` and no matching service unit. That historical observation does not establish current restart configuration; full reboot recovery remains unqualified. CI image export retention is three days. Preserve active dated mount/configuration paths until deliberately migrated; no automatic volume removal or broad host reconfiguration. Close with durable exact artifacts, full-role startup/readiness/restart and bounded rollback evidence. |
| Rollout — not approved | **Owner:** authorize controlled merchant rollout only after applicable checklist/spec gates close; **agent/operator:** verify exact source/artifact/configuration/installation envelope before allocated effects. | Production rollout remains unallocated. The separately approved §16 bounded development fixture and app/theme updates continue under their exact limits; they do not authorize new scopes, real charges or merchant rollout. Native smoke and internal review are not rollout approval. |

### Time-bound retention and private custody

**Past cutoff:20October2026 at00:00UTC** for explicitly timed private captures, safety snapshots and retained cleanup-operation copies. The exact deploy217 dump and two redundant deploy219 captures were disposed after their original deadlines. The [dump disposal receipt](evidence/technical-merchant-completion/development-expired-dump-disposal-2026-11-09.json) proves pathname absence and protected-configuration identity, not physical erasure. Later reconciliation recorded ten expired paths disposed and four minimal projections retained, with 363 operation records and five metadata inventories unchanged. Four auth files remain held behind exact process-reference access. Further disposal is not scheduled. Reconcile remaining overdue custody against original manifests and active references, preserving sole minimal unresolved authority. A handoff extends no deadline and does not convert an expired copy into a new recovery arrangement.

Some older source records say only `2026-10-20` without a time/zone; preserve that distinction and resolve them from their private manifest/source promise rather than inventing a timestamp. They do not extend the explicitly earlier midnight cutoffs. Native/private indexes: `~/.local/share/insignia/cleanup-20261019/{FINAL.json,RESTORE.md}` locally; VPS cleanup subdirectories `vps-r2`, `vps-r3`, `vps-cache`, `vps-cache-all`; current development handover/recovery packets `~/insignia-deploy217-20261019` and `~/insignia-deploy219-20261019`; current native capture index under the private `insignia-canonical-native-20261019` directory. Owner/operator must inspect the actual mounted paths and original manifests; these are locators, not deletion globs. Permanent verifier/inspector/configuration custody is distinct from disposable captures and does not extend any credential or personal-data expiry.

The original/design rows below were reconciled against the current rewrite fixture's database in a bounded **read-only** observation at `2026-10-19T16:43:47.586Z`; no database writes/provider calls or cleanup occurred. Current metadata is not new proof of physical object absence. All listed October deadlines have passed as of this update; this read-only review did not verify cleanup or extend any deadline. The **retention operator** verifies ordinary cleanup, original/derivative/quarantine absence and payload erasure as applicable, preserves financial facts, and records closure. If a row is already erased/deleted, verify that narrower outcome instead of repeating a mutation. Exact grant and worker-runbook boundaries remain binding.

| Record / last metadata | Exact original deadline (UTC) | Source |
| --- | --- | --- |
| Artwork `bf5e68d1-2213-44df-a3da-5d9c155b749b`, USABLE | `2026-10-21T17:11:18.009Z` | [Retention facts](evidence/m8-context-runtime/pr131-native-retention-facts-2026-10-14.json) |
| Artwork `a4d401a0-1f50-4431-a9f0-19db938246b3`, USABLE | `2026-10-21T17:29:58.544Z` | Same retention facts |
| Artwork `949a9e43-b3ee-4afc-b34d-f9a37ed099a3`, USABLE | `2026-10-21T18:30:57.729Z` | Same retention facts |
| Artwork `a02c0a73-dd68-4144-8030-11324da9675c`, USABLE | `2026-10-21T19:13:36.526Z` | Same retention facts |
| Artwork `7cb3c29b-a525-4e07-8631-bc8d8255f63d`, USABLE | `2026-10-21T19:53:52.426Z` | Same retention facts |
| Design purchase `e3a74311-4323-4ea0-ba1a-154a9e65cd49`, unerased | `2026-10-21T19:53:52.136Z` | [Replacement record](evidence/m8-context-runtime/pr140-native-merchant-replacement-2026-10-15.json) |
| Replacement artwork `b01c6980-c17d-409a-b1f9-4ae97ea0d0d8`, USABLE | `2026-10-22T00:53:38.690Z` | Same replacement record |
| Artwork `75cbd361-d5c4-4b59-99b4-dab45bff9da1`, USABLE | `2026-10-22T10:23:38.721Z` | [Artwork record](evidence/m8-context-runtime/pr156-native-artwork-quote-cart-2026-10-15.json) |
| Design purchase `61065563-ab4b-4261-9fe6-0ad5a3d8b58e`, unerased | `2026-10-22T10:23:38.381Z` | [Purchase record](evidence/m8-context-runtime/pr156-native-test-purchase-2026-10-15.json) |
| Artwork `f56527e5-480e-4509-be38-693c11d0ce97`, USABLE | `2026-10-24T10:07:20.522Z` | [Lean journey](evidence/lean-v1/native-lean-purchase-original-2026-10-17.json) |
| Design purchase `675e9dfa-d81a-4aa1-a17b-3faf98a97be8`, unerased | `2026-10-24T10:07:20.206Z` | Same Lean journey |
| Incomplete artwork `b92a171d-e23e-4bad-a174-81e1d5edcad7`, already DELETED | Tombstone retains `2026-10-22T00:31:47.899Z`; no new original-deletion task | [16October physical-absence closure](evidence/lean-v1/incomplete-asset-cleanup-2026-10-16.json) |

These specific development deadlines do not replace the product's absolute retention rules or authorize new manual deletion. Keep minimal immutable VAT/generation/economic authority while erasing disposable/private payloads under their actual policy. Gates and obligations close only with their required evidence, not a handover statement.
