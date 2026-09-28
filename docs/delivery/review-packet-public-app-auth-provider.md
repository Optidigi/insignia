# Principal review packet — public-app authentication/provider closure

## Identity

Repository: `Optidigi/insignia`. Branch: `continuation/public-app-auth-provider` from verified PR #15 normal merge `5e5d4b21a44fe70b7db0fa70bdb236e8f3b5a3dd`. Final PR URL, head and effective merge base are recorded in the PR body after commit. Authorization: [owner-issued continuation](prompts/PUBLIC-APP-AUTH-AND-PROVIDER-CLOSURE.md), following the [attributed external PR #15 approval](PR-015-principal-review.md). Required next action: principal review; no next-PR merge is delegated.

## Outcome and scope

One new-app embedded staff launch, protected route navigation and a process-local synthetic save were observed on the dedicated Basic dev store. Browser action, authenticated server trace, post-save HTTP 200 and reload agree on the one synthetic label. Separately, one additional token-only App Events acquisition reproduced the documented-response mismatch without sending an event. The candidate parser makes missing scope/lease visible and returns no usable bearer through `getToken()`; event sending was outside this package. Partner/App Pricing reads remain pending separately owner-controlled registration and Partner credentials.

Changed code is limited to the M0-009 new-app launch/auth trace and launcher preflight, plus the M0-011 token-result candidate and synthetic tests. Current operational pointers and evidence are updated; v1.2 plan/ledger, old staging config, old provider target guard, historical source/evidence and commerce resources remain unchanged. No new released version, billing method, plan, meter, subscription or event was created.

## Acceptance evidence

| Criterion | Actual command or procedure | Result | Evidence |
|---|---|---|---|
| Exact reviewed PR #15 merge | `gh pr view`, `git fetch`, merge parent/tree read | VERIFIED: merge `5e5d4b21a44fe70b7db0fa70bdb236e8f3b5a3dd` | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Current new-app installation/grants | Pinned `2026-07` CLI Admin GraphQL before and after preview | VERIFIED: exact app/shop/installation; `read_products`, `write_products` | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Staff embedded auth and protected pages | Shared Admin browser, new-app preview, server trace | OBSERVED in a human-assisted browser session; fresh staff token exchange implied by successful fresh-process protected request and checked code path | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Local synthetic save | Owner save action, same-trace auth and post-save 200, protected reload | OBSERVED; process-only label | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Token contract | One bounded direct client-credentials request; official reference and local parser tests | HTTP 200 bearer issued; scope/lease absent; token-client readiness rejected | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Partner/App Pricing | Partner settings read; protected Partner credential destination checked | BLOCKED BY OWNER PREREQUISITES; no Partner client/registration; subscription state unverified | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Billing event and gate acceptance | No event POST, no subscription | NOT_RUN; 0 unique / 0 POST; no complete G7/G8 pass | [Direct record](evidence/public-app-auth-provider-closure.md) |
| Local/CI checks | M0-009/M0-011 pinned checks, old/new builds/smokes, history, staged diff/secret scan, final-head CI | See final PR body/run IDs | [Direct record](evidence/public-app-auth-provider-closure.md) |

## Local pre-review

One delegated restricted writer in a separate worktree handled only local M0-011 token model/tests, then the orchestrator cherry-picked and integrated it. The orchestrator owned M0-009 and all remote Shopify actions. The prompt requested independent auth and provider delegation; auth remained with the integration owner, a procedural deviation with no extra writer or remote operator. Fresh read-only Spec and security reviews inspected the current diff. They caught pre-save logging being mistaken for a save outcome, a placeholder/malformed URL passing launcher preflight, and a logging exception that could mask a successful save; all three were corrected. A separate explicit `codex exec -m gpt-6-sol -c model_reasoning_effort=high -s read-only` integration review found that a metadata-complete token with no `token_type` became send-ready. A failing public-seam regression reproduced that gap; the candidate now classifies it as incomplete, and all 24 M0-011 tests pass. That CLI invocation's model/effort flags are observable, but its output did not expose resolved provider-side settings; no private attestation is claimed. The launcher subprocess tests remain synthetic preflight evidence, not full Astro/Shopify evidence. Final changed paths receive a read-only review before handoff. Local reviewers do not replace principal review.

## Compatibility and safety

The trace is an opt-in new-app-only server observation keyed by a client-generated UUID; it records no token or staff identity. A successful post-save event is separate from authentication and logging cannot change the response. Old staging mode remains isolated. The new token result never exposes an incomplete bearer through `getToken()`. The separate `AppEventsClient` can accept an independently supplied credential, so this token result alone does not prove a global event-send guard; no event call occurred. No provider schema, pricing, money, migration, tenant contract or retention policy changed. Credentials remain outside Git; no session export occurred. The temporary tunnel stopped; its new-app preview record and Shopify's initial placeholder version remain, with no working permanent endpoint claimed. Historical staging preview/grants and protected orders remain untouched.

## Principal decision — principal completes externally

Verdict: PENDING. Gate result: none accepted. A changed token acceptance/lease policy, next-PR merge, paid registration, live billing test, public launch or M1 needs separate authorization.
