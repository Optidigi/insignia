# M5-005 — scope-provenance diagnostic

## Authority and baseline

The owner authorized the attributed PR-030 principal approval and a normal merge only of the approved PR #30 inputs. GitHub's actual merge is `6687e443baf97ee8bf179db61a1e4450f903f8eb`, ordered parents `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` then `30f00935f90f7564d426838487b3a6e5f37a9e01`, tree `e772af245c7f09c59d398656e16305adfeaea005`. This branch starts at that verified remote main. Approval is external; no native approval was fabricated. See [merge receipt](evidence/m5-005/pr30-merge.json) and [principal review](PR-030-principal-review.md).

This is a read-only own-organization development diagnostic, not production merchant authentication or access repair. Production source, M5-004 machinery/grant guard, architecture, SQL and protocol remain unchanged. M5-004's closed canonical register is retained byte-for-byte.

## Offline implementation and safety gate

The sole operator uses `node scripts/m5-005/diagnostic.mjs` with no target/query/credential flags. A private one-use canonical register reserves each allowance before preparation/dispatch. Four fixed requests share a single in-memory bearer. There are no retries, redirects, pagination, alternate credentials, mutations or API fallbacks. Twelve-second deadlines include credential preparation/body streaming; expired preparation cannot dispatch, unknown outcomes stop subsequent work, pending continuations retain the lock. Response limit is 128 KiB. Auth evidence contains only expiry and a sanitized scope projection, never a full-body hash, bearer identifier or raw credentials.

Before owner credential metadata/content or authenticated browser/API access, the source/build binding must match a clean committed checkout, a passing offline report, two independent GPT-6.1-sol/high restricted full-source safety reports/settings and all ten exact-source workflows. `verifyGate` rechecks the hashes and refs at execution. Synthetic tests use the actual public diagnostic entry point and external HTTP/credentials only. The agreed seams are `diagnose`/`diagnoseSynthetic`, fixed request/schema guards and source gate.

The two fixed GraphQL documents are checked against a selected-field/type contract extracted from official versioned **2026-07** public reference pages. This is a bounded documented-field validator for these two no-argument documents, not a full provider SDL/introspection/MCP validator. Public source URLs, API version, document hashes and field types are in `scripts/m5-005/schema-contract.json`. `displayName` is deprecated but still present in that pinned reference. An unvalidated declared document is wholly NOT_RUN, without live experimentation.

Offline focused results: 48/48 pass on pinned Node 24.21.0. Red/green evidence covers the initial entry point, first identity sequencing, partial-stream UNKNOWN containment, permission-error comparison and independent metadata-shape handling. Tests cover identity/host/API/method/document/variables/mutation refusal, every scope absence/type/duplicate distinction, canonical history loss/re-entry, ignored abort/late work, bounded/invalid bodies, token-invalid outcomes and complete source/CI/review-gate omissions.

## Scope chronology (preserved, not rewritten)

| Observation/context | Fact | What it does not prove |
|---|---|---|
| M5-002R CLI `app execute`, before preview | Installation scopes empty | Later direct-bearer scope state |
| M5-002R authorized preview and subsequent cleanup | Nine handles observed on the same installation | Persistence/equivalence across later routes and times |
| PR-028R3 adjudication | Retain then-observed nine; no repair | Exact grant rollback as an app-dev-clean contract |
| M5-004 direct client_credentials, 2026-10-02 ~00:09 UTC | Exact identities matched; installation `accessScopes: []`; stopped before fixture creation | Revocation, wrong credential/install, platform defect, or token-scope value |
| Tracked `shopify.app.m5-002.toml` | Nine locally declared handles | Current released declaration or current grants |
| M5-005 current cross-surface observation | NOT_RUN until offline gate completes | No inference yet |

Sources: [M5-002R](M5-002R-REPORT.md), [PR-028R3](PR-028R3-principal-review.md), [M5-004 report](M5-004-REPORT.md), [original M5-004 register](evidence/m5-004/live/register.json), and the attributed PR-030 scope-history adjudication. M5-004 did not capture the token response's `scope` field; its value remains unknown. No private logs are searched to reconstruct it.

## Current observation and budget

**NOT_RUN — offline safety/CI gate pending.** Canonical live register not initialized; no credentials or authenticated browser/API access yet. Whole-slice limits: one client_credentials exchange, one identity GraphQL read, one app-declared GraphQL read and one same-bearer access-scopes GET. Optional native inspection is separately limited to two existing-session logical views: current released-version details and exact-app development overview. Each view is durably reserved in a private local receipt before inspection; no login/consent/app launch/settings-secret/actions. If unavailable, record NOT_OBSERVED. UI background requests are not represented as a globally complete four-request HTTP count.

## Retained obligations

No scope equality can authorize writes or resume M5-004. Actual availability/status/readback qualification, nonempty publication-history and all-channel/in-flight evidence, non-CAS status race, genuine RELEASE_BOUND/trusted recovery sources and remaining G7 stay open. No activation, complete M5/gate pass, M6/M7, launch, scope repair, preview or release follows from this report. Interpretation and the smallest next permission will be reported after the permitted one-shot observations; principal adjudication remains required.
