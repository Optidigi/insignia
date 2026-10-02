# M5-005 — scope-provenance diagnostic

## Authority and baseline

The owner authorized the attributed PR-030 principal approval and a normal merge only of the approved PR #30 inputs. GitHub's actual merge is `6687e443baf97ee8bf179db61a1e4450f903f8eb`, ordered parents `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` then `30f00935f90f7564d426838487b3a6e5f37a9e01`, tree `e772af245c7f09c59d398656e16305adfeaea005`. This branch starts at that verified remote main. Approval is external; no native approval was fabricated. See [merge receipt](evidence/m5-005/pr30-merge.json) and [principal review](PR-030-principal-review.md).

This is a read-only own-organization development diagnostic, not production merchant authentication or access repair. Production source, M5-004 machinery/grant guard, architecture, SQL and protocol remain unchanged. M5-004's closed canonical register is retained byte-for-byte.

## Offline implementation and safety gate

The sole operator uses `node scripts/m5-005/diagnostic.mjs` with no target/query/credential flags. A private one-use canonical register reserves each allowance before preparation/dispatch. Four fixed requests share a single in-memory bearer. There are no retries, redirects, pagination, alternate credentials, mutations or API fallbacks. Twelve-second deadlines include credential preparation/body streaming; expired preparation cannot dispatch, unknown outcomes stop subsequent work, pending continuations retain the lock. Response limit is 128 KiB. Auth evidence contains only expiry and a sanitized scope projection, never a full-body hash, bearer identifier or raw credentials.

Before owner credential metadata/content or authenticated browser/API access, the source/build binding must match a clean committed checkout, a passing offline report, two independent GPT-6.1-sol/high restricted full-source safety reports/settings and all ten exact-source workflows. `verifyGate` rechecks the hashes and refs at execution. Synthetic tests use the actual public diagnostic entry point and external HTTP/credentials only. The agreed seams are `diagnose`/`diagnoseSynthetic`, fixed request/schema guards and source gate.

The two fixed GraphQL documents are checked against a selected-field/type contract extracted from official versioned **2026-07** public reference pages. This is a bounded documented-field validator for these two no-argument documents, not a full provider SDL/introspection/MCP validator. Public source URLs, API version, document hashes and field types are in `scripts/m5-005/schema-contract.json`. `displayName` is deprecated but still present in that pinned reference. An unvalidated declared document is wholly NOT_RUN, without live experimentation.

Offline safety-source focused results: 48/48 pass on pinned Node 24.21.0; completed evidence adds one captured-input public-seam replay (49/49). The operator implementation is unchanged after the live run. Red/green evidence covers the initial entry point, first identity sequencing, partial-stream UNKNOWN containment, permission-error comparison and independent metadata-shape handling. Tests cover identity/host/API/method/document/variables/mutation refusal, every scope absence/type/duplicate distinction, canonical history loss/re-entry, ignored abort/late work, bounded/invalid bodies, token-invalid outcomes and complete source/CI/review-gate omissions.

## Scope chronology (preserved, not rewritten)

| Observation/context | Fact | What it does not prove |
|---|---|---|
| M5-002R CLI `app execute`, before preview | Installation scopes empty | Later direct-bearer scope state |
| M5-002R authorized preview and subsequent cleanup | Nine handles observed on the same installation | Persistence/equivalence across later routes and times |
| PR-028R3 adjudication | Retain then-observed nine; no repair | Exact grant rollback as an app-dev-clean contract |
| M5-004 direct client_credentials, 2026-10-02 ~00:09 UTC | Exact identities matched; installation `accessScopes: []`; stopped before fixture creation | Revocation, wrong credential/install, platform defect, or token-scope value |
| Tracked `shopify.app.m5-002.toml` | Nine locally declared handles | Current released declaration or current grants |
| M5-005 current cross-surface observation | 2026-10-02 01:23:18–19 UTC: all five scope surfaces explicitly empty, exact identity matched | No inference yet |

Sources: [M5-002R](M5-002R-REPORT.md), [PR-028R3](PR-028R3-principal-review.md), [M5-004 report](M5-004-REPORT.md), [original M5-004 register](evidence/m5-004/live/register.json), and the attributed PR-030 scope-history adjudication. M5-004 did not capture the token response's `scope` field; its value remains unknown. No private logs are searched to reconstruct it.

## Current observation and budget

The sole operator ran frozen source `6cde4be314904e0c82152d378fb9bf7864ba1fa1`, tree `5e31daec61ced395dc623a401031274fc0214403`, after both fresh restricted full-source safety reviews, root PASS, 100/100 no-retry stress and ten exact-source SUCCESS workflows on attempt 1. See [gate receipt](evidence/m5-005/gate-pass.json), [complete Spec review](evidence/m5-005/safety-spec-result.md), [complete security review](evidence/m5-005/safety-security-result.md), and their selected same-launch model/effort/sandbox settings. Root T3 runtime reports actual `gpt-6.1-sol/high`; no provider-private attestation is claimed. Root is the only writer and remote operator. Evidence added afterward is **not** the source that called Shopify.

| Current surface | HTTP / time UTC 2026-10-02 | Observed field semantics |
|---|---|---|
| Client_credentials token response | 200, 01:23:18.521–18.920 | `scope` present, string, explicitly empty; expiry 86399 seconds |
| GraphQL installation identity/grants | 200, 01:23:18.925–19.202 | All exact identities + partnerDevelopment matched; `accessScopes` present array `[]` |
| GraphQL app-declared scopes | 200, 01:23:19.207–19.467 | Installation/app/client matched; both `requestedAccessScopes` and `optionalAccessScopes` present arrays `[]` |
| Same-bearer REST access-scopes | 200, 01:23:19.471–19.717 | `access_scopes` present array `[]` |
| Native current released version and dev overview | NOT_OBSERVED | T3 `preview_status` and required `preview_open` both explicitly reported no automation host; no alternate session/login/browser attempted |

All returned scope projections contain zero duplicate/malformed handles; all three API reads contain no retained error field. Token, installation and REST observations agree at EMPTY. Configured/requested, granted and bearer-associated meanings remain separate despite agreement. Detailed narrow observations are in the [durable register](evidence/m5-005/live/register.json); there is no raw auth body/hash or bearer-derived identifier.

Whole-slice consumption is **1 exchange + 2 fixed GraphQL reads + 1 fixed same-bearer GET**, all four actual HTTP dispatches completed. No retries, redirects, other provider reads, UI views, mutations or cleanup operations occurred. The register is closed, no pending work or operator lock remains, and no programmatic allowance remains. Optional UI views: zero reserved/inspected, both NOT_OBSERVED. UI background requests are not included in a claimed globally complete HTTP count. [Budget/final-state receipt](evidence/m5-005/scope-observation-summary.json); [browser limitation](evidence/m5-005/native-views.json).

The protected existing-file parser checked designated credential ownership/private permissions and client identity without printing/modifying contents. Credentials and bearer stayed in process memory; no secret copy, alternate credential, owner setup or auth-policy change. [M5-004 preservation receipt](evidence/m5-005/m5-004-preserved.json) confirms all five closed-run files unchanged before/after. No product was created or read, so no fixture cleanup is required.

## Supported interpretation and remaining prerequisite

The current direct route is authenticated and target-correct. Its **explicit empty token-associated and REST scopes corroborate the empty installation array**, while current app-requested/optional arrays also return empty. Thus an empty grant view here is not merely an error or absent-field normalization artifact. The tracked nine-scope TOML is demonstrably not proof of this current returned app declaration. This is consistent with a dev-preview declaration/grant context that differs from the restored/current app context, but does **not** establish which released version/configuration is active, when/why anything changed, revocation, platform defect or equivalence to the historical CLI route. The optional native source that could distinguish released versus preview state was unavailable. Historical nine grants remain a valid earlier observation; M5-004's uncaptured token scope remains unknown.

M5-004's publication/status experiment remains BLOCKED: the observed bearer/install exposes none of its required nine retained grants, including `read_products` and `write_products`. This diagnostic does not prove a product-read/write permission by probe and does not weaken that guard. All availability cases remain NOT_RUN.

Smallest proposed next step for principal direction: a separately bounded existing-session read-only inspection of this app's current released-version scope declaration and development/preview status once the collaborative browser is connected. That would distinguish currently released versus local/dev configuration before choosing any remedy. Any configuration/grant change, reauthorization or resumed availability test needs **new explicit principal/owner scope**; none is authorized here. There is no current need to rotate credentials, recreate the app, repair the nine handles, or replay M5-004 based solely on these observations.

## Retained obligations

No scope equality can authorize writes or resume M5-004. Actual availability/status/readback qualification, nonempty publication-history and all-channel/in-flight evidence, non-CAS status race, genuine RELEASE_BOUND/trusted recovery sources and remaining G7 stay open. No activation, complete M5/gate pass, M6/M7, launch, scope repair, preview or release follows from this report. Principal adjudication remains required for the proposed next action.

## Completed-change verification

Completed-change full root PASS (exit 0), focused 49/49 and secret scan PASS are retained in [local verification](evidence/m5-005/local-verification.json) and complete logs. All ten applicable exact-head workflows and two new independent full-source GPT-6.1-sol/high restricted completed-change reviews are required before handback; actual refs, run links and full reports are returned in the PR packet. Safety-source CI above is not substituted for final-head CI. Root DB-free execution explicitly skips eight web and four worker integration cases; hosted PostgreSQL 18.6/runtime workflows supply the required real integration coverage. The six retained 100001-row benchmark input hashes match, so historical evidence is reused with its provenance rather than relabelled as new live qualification. Remaining per-session processes are verified at completion; shared historical host services are preserved.
