# M5-006 — released-configuration checkpoint

## Outcome

Obtain the missing exact-app Dashboard observations needed to choose the smallest development-access remedy. This is **read-only inspection and evidence**, not another implementation project. Current token, installation, REST and requested/optional scopes already agree at empty in M5-005. Repeating those API requests does not answer which released/development configuration is active.

Authority requires the owner-forwarded launch and verified normal merge of PR #31 at base `6687e443baf97ee8bf179db61a1e4450f903f8eb`, head `dc9db629559d5fa7049de2d0d3fed28d53a08fb4`, tree `aeb12dba4944b5934fc33c5494992c6ad5ca87dd`. External verdict: `PR-031-principal-review.md`. The launch does not authorize a repair, app release, consent flow or availability retry.

## 1. Verify the merge; check the browser prerequisite first

Recheck live PR/main refs, applicable successful checks and the external verdict. Keep PR #31's reviewed head unchanged. On mismatch or an unmet native protection/approval, stop without bypassing it. After the owner-authorized normal merge, verify actual ordered parents (base then approved head) and approved tree; a synthetic test-merge is not the receipt.

Before building anything or creating a successor branch, check whether the established shared browser is connected to an **already authenticated** Dev Dashboard session. Use its documented capability/status check and, only if the host requires it, the single normal open attempt. An explicit no-host/do-not-retry response ends this inspection attempt. Return the verified merge receipt and `BROWSER_PREREQUISITE_MISSING`; identify that the owner must reconnect the existing browser. Do not create a new harness or a successor PR solely to repeat the already-known unavailability. Keep the approval package for the next evidence branch.

This task grants no authority to install browser tooling, modify host settings, create another browser profile/session, read browser storage, or complete a login/consent challenge. Browser-tool names containing “preview” do not authorize a Shopify application preview.

Completion: exact merge verified and an available existing-session browser established, or a precise early stop without new Shopify work.

## 2. Inspect only two view scopes

Only the root operator may perform the inspection, using the existing exact-app navigation. Match **App `gid://shopify/App/429028933633` / Client `1443cf6d03d39edae7c101a943c5c684`**, not merely a familiar app label. The designated store is `insignia-rewrite-dev.myshopify.com`, Shop `gid://shopify/Shop/105501393179`, with historical installation `gid://shopify/AppInstallation/1054356963611`.

Before opening each view scope, record its purpose, target and time in a small local observation note. Ordinary Markdown/JSON is sufficient; no new accounting engine is needed. The two permitted scopes are:

| View scope | Capture only directly displayed facts |
|---|---|
| **Versions → currently active/released version details** | App identity; explicit active/released designation; exact version name and ID when displayed; release time; required and optional scope declarations; app URL, embedded flag and API version; extension list/identities when displayed on that same detail view. |
| **App/development overview** | Exact app/store identity and explicit development-preview status/target, when displayed. Distinguish an active preview, no preview explicitly shown, and status not exposed by the view. |

Normal navigation to the current version, scrolling and expanding read-only detail sections within these two scopes are permitted. An app name, newest row, local TOML, cached screenshot or missing preview banner is not proof of an active version or absence of a preview. An explicit empty scope declaration differs from an unrendered/hidden/absent field. Record missing fields as NOT_OBSERVED. Do not open create-version/edit/settings-secret screens to expose missing data.

The permission envelope is **two view scopes total; zero scripted authenticated API requests; zero token/refresh exchanges; zero Shopify CLI commands; zero business, configuration, scope, consent, installation or release mutations**. Incidental UI background requests are not individually accounted and must not be described as zero total network traffic. No network interception, internal Dashboard API replay, credential-file access, embedded app launch, product/Function/billing inspection, preview launch/cleanup, or M5-004/M5-005 operator rerun is allowed. A visible action button is not permission to click it.

Record only relevant visible text and, when useful, tightly cropped/redacted screenshots. Remove account/user details, tokens, query strings and unrelated data. Preserve values used to distinguish active release versus draft/preview. `OBSERVATION-TEMPLATE.json` is an optional blank capture template, not observed evidence or a schema requiring implementation.

Completion: each view has one observation with time/provenance or an explicit NOT_OBSERVED reason. No source/remote state is changed to obtain a preferred result.

## 3. Return an evidence-backed recommendation, not an executed repair

Compare the observations to M5-005 and the retained M5-002R/PR-028R3 history. Use these branches without deciding the result in advance:

- **Active released scopes explicitly empty, no preview explicitly active:** supports a current released-declaration explanation for the direct-context result. Propose the smallest development-only configuration/consent change, with exact existing version and fields to preserve. Do not claim this proves historical timing or execute the proposal.
- **Active released scopes nonempty:** preserve the disagreement with the earlier API observation. Separate time/context differences from an actual provider inconsistency. Propose one discriminating next action rather than overwriting scopes.
- **Preview active or competing/unattributable state:** preserve it; do not stop, clean or overwrite another operator's work. Escalate ownership/context.
- **Current active version or declaration not visible:** report the precise missing evidence. Do not infer empty from absence or request broad account access.

Any later app-version change must account for extension preservation: Shopify versions configuration and extensions together. This checkpoint is not an authorization to deploy the repository, release its Functions, change public-merchant authentication, or remove the nine-grant guard. A proposed remedy must identify prerequisites and verification/rollback needs without promising that a scope change alone will produce usable grants.

Completion: one short factual comparison, strongest supported interpretation and exactly one proposed subsequent action with its required owner authority.

## 4. Preserve and hand back

After obtaining useful new evidence, create one **docs/evidence-only branch** from the verified merge. Preserve newer work and stop if the baseline has moved. Allowed repository changes: this prompt, `docs/delivery/PR-031-principal-review.md`, a concise `M5-006-REPORT.md`, minimal sanitized `docs/delivery/evidence/m5-006/` observations/merge receipt, and short AGENTS/state/tooling pointers where needed. No application, operator, test, dependency, TOML, migration, CI or architecture-plan changes.

One writer; fresh independent actual GPT-6.1-sol/high Spec and Standards/security reviewers assess the **complete documentation/evidence change**, source attribution and permission compliance. Do not mislabel that as rerunning or rereviewing unchanged production implementation. Use existing relevant document/security checks and all applicable checks triggered or required on the new exact head. Do not alter path filters or weaken checks. Do not manually rerun the unchanged PostgreSQL, 100-case stress or 100001-row benchmark merely for screenshots; retain their prior exact-ref provenance and report any automatically triggered new runs separately.

Return one evidence PR if new useful observations were obtained, with exact refs, full scoped reviews, applicable CI, two-view consumption and unchanged-source confirmation. Stop for principal adjudication. If neither view can be inspected, return the early blocker and local note instead of manufacturing a redundant implementation/blocked-evidence PR. Partial useful evidence can be submitted with explicit limits.

The current approval is not permission to merge this successor. M5-004 remains blocked and its cases NOT_RUN. All admission, release-bound/recovery, G7, M6/M7 and launch boundaries remain unchanged.

## Suggested skills and references

Read repository-pinned `writing-for-agents` and `handoff`; use `code-review` for the two scoped local review axes. The existing `diagnosing-bugs` discipline applies to separating observations from falsifiable interpretations. No TDD/code work or baseline grilling is needed because no new executable behavior or product decision is authorized. Repository operating-model authority overrides skill defaults.

Read the current AGENTS/ledger/operating-model and [M5-005 report](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/docs/delivery/M5-005-REPORT.md), including its native-views/register evidence; follow its references to M5-002R and PR-028R3 rather than duplicating their histories.

Public primary documentation checked on 2 October 2026 (platform context, not store evidence):
- https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration — local development configuration versus deployed configuration.
- https://shopify.dev/docs/apps/launch/deployment/app-versions — configuration and extensions are versioned together.
- https://shopify.dev/docs/apps/launch/deployment/deploy-app-versions — current-version inspection and release boundaries.
- https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes — declaration versus granted scopes.
