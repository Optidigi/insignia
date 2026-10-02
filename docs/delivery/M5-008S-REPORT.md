# M5-008S — optional product scope granted on the designated development store

## Result

**VERIFIED: optional write_products is currently granted to the exact designated development installation.** This is development-access qualification only. No product, availability, Function, publication, checkout or billing operation occurred.

The user explicitly replaced the unavailable current-installation inventory prerequisite with a store-local optional-scope request. That prerequisite was not searched or reused. Required scopes remained empty throughout. The [brief](prompts/M5-008S-OPTIONAL-SCOPE-DEV-STORE-GRANT.md) permits this one release, one store grant and one exchange/read pair; earlier exhausted registers remain closed.

## Exact PR #37 merge

The [attributed PR-037 principal verdict](PR-037-principal-review.md) is external approval, not a native GitHub review. Live target main, base/effective merge base `adecff04a3ff5b5d72665cbb404265477d6eb748`, head `77d01a5cfe828c723f37d7ab45e245d01e44d5bd` and tree `f11ba18504ccf44c29c0319aa3f1afc8ed91103e` matched immediately before merge. All ten exact-head workflows succeeded on attempt 1; the worktree was clean and GitHub reported MERGEABLE/CLEAN.

Executed `gh pr merge 37 --repo Optidigi/insignia --merge --match-head-commit 77d01a5cfe828c723f37d7ab45e245d01e44d5bd`. No added head commit, squash/rebase, force push, fabricated native approval or bypass.

Verified remote merge **`d3adffdd7ea6c538016ac3569d1f17e81259aa89`**, ordered parents:

1. `adecff04a3ff5b5d72665cbb404265477d6eb748`
2. `77d01a5cfe828c723f37d7ab45e245d01e44d5bd`

Tree **`f11ba18504ccf44c29c0319aa3f1afc8ed91103e`** matches approval. GitHub readback and fetched remote main agree. Branch `feat/m5-008s-optional-product-grant` starts at that merge. [Premerge](evidence/m5-008s/pr37-premerge.json), [merge receipt](evidence/m5-008s/pr37-merge.json), [package/runtime authority](evidence/m5-008s/authority.json) (supplied manifest 6/6 PASS).

## Version and native optional approval

The connected, existing authenticated T3 browser showed the exact app in Dev organization `200969036`, Insignia/Optidigi. Active prestate was `insignia-1`, version `1146748534785`. Its create form explicitly stated that it was pre-populated from insignia-1.

| Public configuration | Before | After |
| --- | --- | --- |
| Required scopes | empty | empty |
| Optional scopes | empty | write_products |
| Name / app URL | Insignia / https://example.com | unchanged |
| Embedded / legacy installation | true / false | unchanged |
| Redirects / preferences URL | empty / empty | unchanged |
| Webhook API | 2026-07 | unchanged |
| POS embedded / proxy fields | false / empty; prefix unselected | unchanged |
| Version tag / release message | empty | left empty; generated version name |

Only the optional-scopes textarea was edited. The visible form and native “Release this new version?” confirmation were checked before the reserved final submit. One final Release produced **insignia-2 / version 1152880803841**, Active. The list showed exactly this one new version plus prior insignia-1. Detail showed optional_scopes write_products, unchanged public app fields and API version. A read-only create-form view explicitly pre-populated from insignia-2 proved required scopes still empty and all whitelisted controls matched the intended form. No second form was edited/submitted. Final browser view is the new active detail. No rollback was needed.

Displayed Created/Released time was 2 October 2026, 8:14 pm; Dashboard timezone was not exposed, so this is not relabelled UTC. Capture timestamps are UTC observation times. [Selected public UI evidence](evidence/m5-008s/ui-observations.json) preserves the observations. Dev Dashboard’s documented active-extension inheritance is the accepted preservation mechanism; no independent extension manifest or deployed Function identity was obtained.

The already authenticated designated Admin tab showed insignia-rewrite-dev and dev. One request used the [documented optional-scope URL](M5-008S-RESEARCH-NOTES.md), fixed client `1443cf6d03d39edae7c101a943c5c684` and only write_products. Native grant screen identified Insignia and only “Edit products — Products, collections”; one reserved **Update** approval returned to the existing store app route. Its blank app area was not treated as embedded-app correctness or grant proof. The following API read established the grant independently. Returned authorization/session query strings were excluded.

## Single protected exchange and read

After the local helper safety gate, the sole operator used the existing protected server.env route. File and directory checks required same uid, private permissions, regular non-symlink file/directory, fixed client ID and bounded parsed values; observed file uid 1000, mode 600. No credential was printed, copied to evidence, modified or placed in command arguments.

The temporary fixed-target helper extracts protectedCredentials byte-for-byte from the existing public qualification source and imports the unchanged fixed M5005Identity query/schema contract. Historical nine-grant guards and production source were untouched. [Exact executed helper text](evidence/m5-008s/grant-helper-source.mjs.txt) is documentary provenance, not a new runtime entry point; [hashes](evidence/m5-008s/helper-provenance.json) bind it and the loader extraction.

Twelve pinned Node24.21.0 synthetic identity/scope/token controls passed with zero credential reads/fetches. A fresh restricted GPT-6.1-sol/high safety review found reservation exclusivity and failed-body cancellation issues in the initial temporary helper. Both were fixed before any credential access; the complete corrected helper passed Node syntax and a [fresh safety rereview](evidence/m5-008s/preaccess-rereview-security-review.md). [Initial findings](evidence/m5-008s/preaccess-security-review.md) and [actual same-launch settings](evidence/m5-008s/preaccess-settings.json) remain visible.

The executed helper acquires a durable exclusive one-use guard before reading the package register, reserves both calls before credential loading, uses fixed HTTPS destinations, refuses redirects/retries, bounds each request to 12 seconds and 128 KiB, cancels failed bodies, aborts on completion/failure, and persists only selected public observations. Auth/bearer/raw response bodies are not retained. [Local checks and scratch failures](evidence/m5-008s/local-verification.json) distinguish local readiness mistakes from remote configuration mismatch.

| Call | Actual receipt |
| --- | --- |
| Client-credentials exchange | 1 attempt; HTTP 200 at 18:22:03 UTC; expires_in 86399; token_type not supplied |
| Fixed Admin GraphQL read, API 2026-07 | 1 attempt; HTTP 200; no GraphQL errors |
| Shop / domain / development | gid://shopify/Shop/105501393179 / insignia-rewrite-dev.myshopify.com / partnerDevelopment true |
| App / client | gid://shopify/App/429028933633 / 1443cf6d03d39edae7c101a943c5c684 |
| Installation | gid://shopify/AppInstallation/1054356963611 |
| Actual granted handles | read_products, write_products |

[Sanitized grant result](evidence/m5-008s/grant-result.json) binds the unchanged fixed query SHA256 `b0b9b788418c0b7e30d120adfc5a2c4a1a83ee220a0a2f880e03677748944ee9`. The observed read_products handle is included by write_products; it was not separately requested. This is an Admin client-credentials result, not an App Events token experiment or a change to its incomplete-token rejection policy.

## Final state, budget and limits

[Closed package register](evidence/m5-008s/register.json): new release **1/1**, optional request **1/1**, optional approval **1/1**, structural rollback **0/1**, auth exchange **1/1**, fixed Admin read **1/1**. No retries or pending action. Native browser navigation has incidental background traffic; this is not a zero-network claim.

Retain insignia-2 with required empty / optional write_products and the designated store’s observed product grant. Cleanup does not revoke this authorized grant or roll back a structurally correct version. No Shopify CLI invocation, preview clean/deploy/release, reinstall, additional scope request, second store, product mutation or prior availability-run replay occurred. Architecture v1.4, operative TOML, production source, dependencies, CI, tests, old fixtures, billing resources and preview holding states were unchanged. [Preservation](evidence/m5-008s/preservation.json) verifies 33 named historical local artifacts; the global CLI installation remains untouched, unused and unresolved.

Root/integrator and sole remote operator are actual GPT-6.1-sol/high, confirmed by trusted T3 same-launch runtime. Repository-pinned writing-for-agents, diagnosing-bugs, code-review and handoff were read and applied within this slice. Fresh scoped Spec/correctness and Standards/security review reports, final refs and automatic CI are returned in the PR packet. No unchanged root/PostgreSQL/stress/benchmark suite is manually rerun solely for this docs/evidence slice.

**Next principal decision:** accept this bounded development-access evidence and decide whether to authorize a separate bounded availability qualification against current state. The closed M5-004 register and unused historical allowances do not reopen. No public-merchant authentication, RELEASE_BOUND/trusted recovery, publication activation, M5 completion, gate pass, M6/M7 or launch is established. Stop for principal review; the successor PR is not authorized to merge.
