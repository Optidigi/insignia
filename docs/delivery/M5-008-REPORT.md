# M5-008 — development product-access restoration checkpoint

## Outcome

**BLOCKED before version creation/release.** PR #35 was normally merged at its exact approved inputs. The existing authenticated Dev Dashboard exposed the exact app's active `insignia-1` and a create-version form explicitly pre-populated from that version. Its public fields match the accepted configuration, including explicitly empty required/optional scopes and redirects. Only `write_products` was entered into the unsaved required-scopes field.

The inspected create form exposes **Release**, not a separate create-unreleased action. Opening that type=button control displayed **“Release this new version?”**, an optional version message, Cancel and a final Release submit. The final submit was **not invoked**. The dialog was cancelled and the unsaved form abandoned. The final Versions view still displayed only `insignia-1 — Active`.

This observed interface cannot satisfy the brief's ordered create-unreleased → inspect-created-version → conditional-release procedure through the controls inspected. It is not proof that Shopify has no supported alternative anywhere. No hidden input modification, internal API or alternative deployment route was attempted. The separate installation-impact prerequisite also remains unestablished: the exact-app overview exposes a seven-day install-event chart, not a current installation inventory identifying store ownership. Its one install event and zero uninstall events cannot establish absence of external merchant installations.

The affected release/auth/read branch stopped. No new version, release, rollback, auth exchange or fixed Admin read occurred. Access was **not restored or verified**. This useful native route/confirmation evidence returns one docs/evidence PR; the principal must adjudicate the procedural prerequisite before further remote work.

## Authority and merge

The attributed [PR-035 external approval](PR-035-principal-review.md) covers base/effective base `9dc728b21d58a1687fae7221e64225373bbbbecb`, head `39fce0b00b625fe0f5869058ec44093213a4ffc5`, tree `f4fd4ed878547bb17d96d3b3187c7d125dd4abd1`. All ten exact-head workflows were SUCCESS, attempt 1; the clean worktree, live refs, permitted merge-commit method and external verdict matched immediately before merge. No approval commit or native approval was fabricated.

Actual normal merge **`34c78b56df98cc049adca842653ad6f9ae23b2a8`** has ordered parents:

1. `9dc728b21d58a1687fae7221e64225373bbbbecb`
2. `39fce0b00b625fe0f5869058ec44093213a4ffc5`

Tree **`f4fd4ed878547bb17d96d3b3187c7d125dd4abd1`** matches approval. GitHub's merge readback and fetched remote main agree. The new branch `feat/m5-008-product-access` starts from that verified merge. [Premerge checks](evidence/m5-008/pr35-premerge.json), [merge receipt](evidence/m5-008/pr35-merge.json). No squash/rebase, force push or protection bypass. Final successor refs belong in the PR packet after commit.

The [M5-008 brief](prompts/M5-008-DEVELOPMENT-PRODUCT-ACCESS-RESTORATION.md) explicitly supersedes R4's nine-scope proposal with `write_products` only. This is a bounded development qualification scope, not the production scope catalog. Actual root/integrator/operator is GPT-6.1-sol/high; fresh scoped reviewers use the same model/effort with restricted read-only sessions. Repository-pinned writing-for-agents, diagnosing-bugs, code-review and handoff are applied. No defect implementation or new harness was needed.

## Native prestate, form and impact evidence

[Selected public observations](evidence/m5-008/ui-observations.json) preserve actual rendered text and selected public form controls, not a raw browser snapshot, account URL, request/response body, session or extension export. Existing Admin tab remained available; a separate collaborative browser tab opened the exact-app Dashboard without login or consent. The root is the sole remote operator. One ambiguous Versions locator failed before successful specific navigation; this was a navigation-only tool failure, not an app creation/release attempt. Final page readiness was explicitly awaited before recording the version list.

| Criterion | Actual observation | Limit |
| --- | --- | --- |
| App/organization | Native `/dashboard/200969036/apps/429028933633`, displayed Insignia/Optidigi | No fresh OAuth client/Shop GID query; retain earlier exact mapping |
| Active release | `insignia-1`, version `1146748534785`, Active and Released | Native displayed release time has unspecified timezone |
| Create source | `/versions/new`: “This form is pre-populated from version insignia-1.” | No newly created version exists to inspect |
| Required/optional | Public textareas initially explicit empty strings; required field alone typed `write_products` | Unsaved local form value is not remote configuration or a grant |
| URL/embedded/legacy/redirects | `https://example.com`, true, false, empty | Explicit selected form values, consistent with active detail/R4 |
| Webhook API | `2026-07` displayed | No webhook operation |
| Other form configuration | Empty preferences URL, POS embedded false, unselected proxy prefix and empty proxy subpath/URL | Unedited; no interpretation as a complete raw app module export |
| Create/release control | Only visible create-form terminal control Release; native confirmation says “Release this new version?” | No separate unreleased save exposed; final submit not invoked |
| Extension preservation | Official documented create-page inheritance contract + exact displayed source version | Handles/count/binary manifest NOT_OBSERVED; no actual new-version inheritance tested |
| Installation impact | Seven-day overview: 1 install event, 0 uninstall events | Current inventory/ownership/external merchant impact NOT_OBSERVED/NOT_BOUNDED |
| Final version list | Sole displayed row `insignia-1 — Active` after leaving unsaved form | No new version ID or current grant claim |

Shopify documents that the Dev Dashboard version-create route carries configuration on that page plus the current active extensions; this supports choosing the route, not bypassing the ordered verification requirement. [Official app-version documentation](https://shopify.dev/docs/apps/launch/deployment/app-versions). Its scope guidance says a write scope includes read and discusses own-organization approval; neither statement establishes this app's current installation impact. [Official scope guidance](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes). [Research provenance](M5-008-RESEARCH-NOTES.md).

## Accounting, final state and preservation

[Closed register](evidence/m5-008/register.json): new versions **0/1**, new-version releases **0/1 conditional**, structural-mismatch rollback **0/1 conditional**, existing-route client-credentials exchanges **0/1 conditional**, fixed Admin GraphQL identity/scope reads **0/1 conditional**. Post-release verification is NOT_RUN because release never qualified. No mutation document/helper was prepared or dispatched. Owner credential files were not read or statted. Zero Shopify CLI, scripted Admin/Partner/App Events call, token request, product/Function/billing/commerce action, preview or grant repair.

Native UI navigation has ordinary background traffic; this is not a zero-network or total HTTP-packet count. Only form editing and opening/dismissing a confirmation occurred. No browser storage, hidden auth fields, network interception or raw screenshot/session material was retained. No scope/URL/extension/preview/install/subscription/product change or resource cleanup was performed. The unsaved dialog/form was left and no remote cleanup is required for an unsubmitted form. Unused conditional allowances do not authorize a retry or automatic continuation.

[Named historical records](evidence/m5-008/preservation.json) still match the retained reference hashes: M5-004/M5-005 closed registers, R2 lost error, R3 failure, R4 consumed register/export and earlier reports/reviews are preserved. The prior global CLI installation is untouched, unused and unresolved. Shared infrastructure, old fixtures, nine historical development grants, billing resources and stopped previews were not operated on. No claim is made that historical grants equal current grants. Architecture v1.4, operative TOML, production source, dependencies, SQL, tests and CI remain unchanged.

## One proposed next decision

**Principal disposition of the actual native create-and-release interface, contingent on authoritative owner-controlled installation-impact evidence.** The principal can supply a supported separate unreleased-create route for the same extension-preserving Dashboard path, or revise the ordered procedure to permit native combined creation/release only after exact pre-submit configuration/inheritance and installation-impact conditions are proved. The current brief grants neither procedural substitution nor release on an unbounded installation inventory. An owner-supplied sanitized authoritative current installation/ownership record is acceptable evidence for adjudication; a seven-day chart is insufficient.

Do not execute that proposal, infer permission from `write_products` in the abandoned form, run another capture, restore nine scopes, deploy the local extension tree or invoke M5-004. Public-merchant authentication and production readiness remain unchanged. Production still requires RELEASE_BOUND; no complete M5/G6/G7/gate or launch result follows.

## Verification and review

Focused documentation/JSON/link/manifest/sensitive-data/Git checks, fresh complete scoped GPT-6.1-sol/high Spec/correctness and Standards/security reviews and applicable automatic final-head CI are recorded in the PR packet. They review this documentary change, not repeat production implementation or authenticate the private UI session. No unchanged root/PostgreSQL/100-case stress/benchmark suite is manually repeated solely for this checkpoint. Automatic CI remains intact and is reported at the final head. Return the same single outcome PR and stop for principal review; no successor merge, activation, M6/M7 or release authorization.
