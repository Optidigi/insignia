# Principal review packet — M0-011

## Identity and authorization

Repository: `Optidigi/insignia`. Candidate branch: `spike/m0-011-provider-transport`; PR URL and final head are recorded in the PR body after the final push. Base and effective merge base: `88dca8ebb4aad6baa24922508335e14038abbc98`. That is the normal PR #13 merge with exact reviewed parents `31484d328ec401a30994d073518b11eb67777433` and `8bda74f1985762923580b5d1d92b56c4a0d7203f` and the approved head tree. [PR-013R external principal approval](PR-013R-principal-review.md) covers those inputs; it is not a native GitHub approval. The owner authorized that merge and [M0-011](prompts/M0-011-live-billing-transport.md), not this PR's merge or full G8 acceptance.

## Outcome and scope

This PR adds a **local** Partner read/App Events transport boundary in `spikes/m0-011`, synthetic contract tests, pinned Node 24 CI, and [direct provider-readiness evidence](evidence/m0-011-provider-readiness.md). It reuses M0-010's query/parser/encoder/response classification. It also preserves the owner launch, prompt, principal review/verification and operational state. The v1.2 plan, ledger, older source, receipts, stopped preview and historical grants are unchanged.

The conditional live billing branch stopped **before setup**. The existing app's public-App-Pricing method, actual Partner App GID, current contract, private test plan/meter isolation, provider credentials and App Events behavior are not established. No subscription, plan, meter, event, test order, payment, inventory or preview action occurred. The app and Dev store identity reads are real; HTTP behavior tests use injected synthetic responses only.

## Acceptance evidence

| Criterion | Actual procedure | Result / limit |
|---|---|---|
| Reviewed predecessor and branch | `gh pr view 13`, `gh run view` on workflows `36357971726`, `36357971708`, `36357971684`, `gh pr merge 13 --merge --match-head-commit 8bda74f1985762923580b5d1d92b56c4a0d7203f`, `git show -s --format='%H %P %T' 88dca8e...`, `git fetch origin main`, `git merge-base` | PASS. Exact base/head and green final-head workflows before normal merge. Remote main merge, parents and approved tree verified; branch starts at merge. |
| Existing named resources | Authenticated Dev Dashboard app Settings/Apps/Stores read; `shopify app info --path /home/serveradmin/insignia-pf002-shopify-import --json`; `shopify store info --store insignia-staging.myshopify.com --json` | PASS for app name/OAuth Client ID, shop GID, Dev/Basic store and same Dev Dashboard/CLI organization. Installation GID and effective grants were **not re-read**. No secret fields retained. |
| Pricing, app/Partner identity and credentials | Authenticated Dashboard navigation and documented hosted pricing URL; scoped environment capability check | BLOCKED for live use. Dev Dashboard showed no pricing/distribution section; hosted pricing URL returned no page; attempted Partner Dashboard route was 404. Actual Partner App GID, public eligibility, effective no-charge tariff, current subscription, meter/other consumers and separate provider access remain unknown. These absences do not prove ineligibility. |
| Current route research | [App Events reference](https://shopify.dev/docs/api/app-events/latest), [billing tutorial](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/build-billing-event), [Partner API](https://shopify.dev/docs/api/partner/2026-07) | PASS as public source binding: App Events latest currently documents the `2026-07` POST and client-credentials flow; tutorial still uses `unstable`. Runtime route/auth are **NOT_RUN**. |
| Local billing regression | `cd spikes/m0-010 && corepack pnpm install --frozen-lockfile && corepack pnpm check` on Node `v24.21.0`, pnpm `12.6.0` | PASS: strict TypeScript and **34** synthetic tests, including M0-010R R1/R2. |
| Adapter and safety regression | `cd spikes/m0-011 && corepack pnpm install --frozen-lockfile && corepack pnpm check` on same runtime | PASS: strict TypeScript and **20** synthetic tests. Covers fixed query/tenant, pagination, dry-run default, fresh $0 double-read, identity, first-send time, immutable replay, 3/6 journal cap while intact, alternate-path refusal in normal process, redirect/timeout/oversize/status/redaction and explicit local-file reset limit. No provider call. |
| Historical integrity | `python3 -B spikes/m0-007/scripts/check-history.py`; `sha256sum docs/architecture/{implementation-plan,decision-ledger,OPTION-A-APPROVED}.md`; `git diff --check` | PASS: plan `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`, ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`, Option A `321f86f5823a0b73b6a6483c172e5d56a0172de442f38dc79ae337de51adf209`; 41 earlier sources and 120 receipts unchanged. |
| Final-head CI | M0-011 workflow and applicable existing workflows | Record exact run IDs and final-head results in PR body after push. |

## Evidence classification and resource register

| Question | Status |
|---|---|
| Existing app/staging identity and Dev status | **VERIFIED** by authenticated Dashboard and CLI reads. |
| Public App Pricing eligibility, Partner App GID, test plan/meter and isolation | **UNKNOWN**. No distribution or pricing method was changed. |
| Separate Partner/App Events authentication | **NOT_RUN**; no approved local credentials found, no token acquired. |
| Effective subscription, zero-price cycle, history and current aggregate | **UNKNOWN**; no Partner request. |
| App Events 202 receipt, duplicate/retry behavior and async log | **NOT_RUN** live; synthetic behavior only. |
| Billing count/cost delta and historical coverage | **NOT_RUN** live; zero live events. |
| New resources and cleanup | **0** new plans, meters, subscriptions, events and orders; no cleanup action required. Existing stopped preview and orders #1001–#1006 untouched. |

## Local pre-review and dispositions

One restricted writer used a separate worktree for `spikes/m0-011/**`; the orchestrator integrated it and owned the documentation/workflow changes. One operator serialized authenticated reads. Fresh independent read-only Spec and Standards/security reviews examined the integrated candidate. These are local reviews, not principal approval. This host has unrestricted filesystem permissions; review/write boundaries were instruction-enforced rather than an OS sandbox claim.

- Both reviews identified a potentially stale no-charge read before a delayed credential acquisition. The adapter now re-reads Partner after the credential and journal sync, rechecks cycle/price/time and token lease before the POST; a changed-price regression blocks the send.
- Both reviews identified that the journal limit is per intact file and the App GID was not independently bound. The staging Shop GID is pinned; a normal process refuses a noncanonical journal path, and tests demonstrate that deleting the file resets the local counter. The `appGidVerified` manifest flag is a manual evidence assertion and is **not set for any live run here**. The actual Partner App GID and an operator-wide attempt register are mandatory before future live submission. These remain activation blockers, not claimed fixes to the missing provider evidence.
- Security review's new-event backdating, redirect classification and temp-file collision findings were addressed with a first-reservation 60-second check, manual redirect refusal and unique temp names. Exact replay retains the original time/body/key. The spec review's replay-header ambiguity and non-202 status finding were addressed with three-state replay evidence, allowlisted request ID and status on classified provider responses.
- The installation/grant live baseline was not re-read; the provider-readiness record labels it as such. The collaborative browser host became unavailable after the read-only Admin check. No alternative session extraction was attempted.

## Compatibility, safety and remaining activation assumptions

The adapter adds no production billing engine, schema, commercial tariff or runtime deployment. Its guarded two-tier $0 shape may differ from Shopify's actual private test plan; that difference requires a separate narrow parser, never relaxation of the production entitlement parser. The current 2026-07 route is documented publicly but untested with this app. `RECEIVED` is only an HTTP receipt. A file journal protects accidental duplicate/attempt overruns while intact; it is not tamper resistant or a global event budget. Any future operator must keep durable attempt accounting across restarts/files and stop if the count is ambiguous. The temporary App Events and Partner credentials, actual Partner App GID, active cycle, no-charge contract and cancellation path all remain unverified.

The owner/app organization administrator needs to identify the **existing app's Partner Dashboard listing** and expose its distribution, App Pricing method, private test plan/meter and existing subscription/consumer state for read-only inspection, then provide already approved Partner and App Events credentials through a secure local channel if they exist. If the prerequisites require distribution selection, a billing-mode switch, a new permanent API client, a shared-plan edit or replacing a subscription, a separate decision is required. No such action is implied by this PR.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/base/head: PENDING final-head review. Gate result: NONE requested. Further authorization: NONE.
