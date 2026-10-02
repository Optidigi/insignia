# M5-007 — read-only configuration capture

## Outcome and authority

Obtain a useful, provenance-labelled representation of the active app configuration through the **existing official Shopify CLI**, and inspect the designated store's explicit preview state through its native **Dev Console**. Return a concrete proposed access remedy, or the one precise remaining source/permission prerequisite. This is observation and documentation, not another implementation or repair slice.

Requires owner-forwarded launch and verified normal PR #32 merge from base `dbaa7488780ddf8fd01991bf5a76a909e07b34e0`, head `4e67cde30707ae5e55cad7a7d1344bb3f733f388`, tree `52d6b462dfd3e145e2eab9c6e0911c8ddefd2c7d`. External verdict: `PR-032-principal-review.md`. A merge does not itself confer Shopify permission.

One actual GPT-6.1-sol/high root writer/operator. Fresh independent same-model/high reviewers later assess only the resulting complete docs/evidence change. Read the repository's AGENTS, ledger, operating model and M5-004/005/006 reports. Use pinned writing-for-agents, handoff and scoped code-review. The diagnosis discipline separates observations from causes; no baseline grilling, TDD project, new skill or new execution framework is needed.

## 1. Verify merge and the installed read path

Reverify PR/main refs, successful applicable checks and the external verdict. Keep the reviewed head unchanged. A mismatch or unmet native approval/protection stops the merge; no bypass. Verify the actual merge's ordered parents (base then approved head) and approved tree.

Before authenticated commands, record the installed Shopify CLI version and inspect its local help/source for the two commands below. Confirm the explicit-client branch resolves the existing app, never offers creation/relinking, and config link writes only local configuration/preferences. Check context-loading hooks as well as the command entry. Public upstream source is useful comparison, not proof of the installed version's behavior. See `RESEARCH-NOTES.md`.

Use the already-established CLI account/session for this same organization and exact app. No installation/upgrade, new login, device authorization, account switching or consent flow is authorized. Unsupported command semantics, an interactive auth requirement, or a need for a remote resource write is an early stop with the exact prerequisite. Do not replace the CLI with a custom/internal-API client.

Completion: exact merge verified and installed read-only command paths understood, or a precise early blocker without a new harness/PR merely recording the same lack of access.

## 2. Capture configuration without inheriting old scopes

Fixed target: App `gid://shopify/App/429028933633`, Client `1443cf6d03d39edae7c101a943c5c684`, Dev Dashboard organization context `200969036`. Expected active version: `insignia-1` / `1146748534785`. Target identity or active-version disagreement stops this fixed experiment rather than selecting a different app/version.

Use private, uniquely named scratch directories **outside the repository, worktrees and any parent app project**. Preserve all existing TOML, .shopify preferences, source and closed registers. If version listing needs a linked local app file, put only an already-tracked public configuration for this exact client in a separate `version-context` directory. Record that file as local input, not evidence. Copy no `.env`, credentials, extensions, dependencies or private caches.

A distinct `capture` directory must start empty, with no app configuration discoverable in its ancestors. Do not seed it with the historical nine-scope TOML. This prevents local settings from surviving the CLI's merge and masquerading as downloaded values.

Reserve each invocation's purpose, target, command and start time in one ordinary private Markdown/JSON note before running it. **At most three authenticated logical CLI invocations, serially, once each:**

| Order | Permitted command | Required treatment |
|---|---|---|
| 1 | `shopify app versions list --client-id 1443cf6d03d39edae7c101a943c5c684 --path <version-context> --config <public-config-name> --json` | Save a sanitized current/active version designation and ID. Resolve flags using installed help. |
| 2 | `shopify app config link --client-id 1443cf6d03d39edae7c101a943c5c684 --path <empty-capture> --file-name m5-007` | Explicit existing-client branch only. Create a new local capture file; no overwrite or default-workspace switch outside this scratch context. |
| 3 | Repeat the exact version-list read from step 1 once | Verify the active version is still the same; record an intervening change rather than attributing capture to the old version. |

Omit `--config` only when installed behavior demonstrably uses the intended scratch default without prompting. Flags above describe the approved operation, not authority to guess incompatible flag meanings. Prepare/validate the local contexts first. A failed authenticated invocation consumes its slot and ends further CLI work; there is no manual retry, fallback command, app selection or creation. Use a 120-second process deadline per invocation; interrupt only that package-owned process if it stalls and retain its unresolved result.

Owner permission includes the official CLI's normal same-account credential-cache use and automatic token renewal, remote metadata reads, and ordinary built-in bounded retries necessary for these invocations. It does **not** authorize manual token issuance, copying/printing CLI credentials, `server.env` access, alternate auth routes or app-grant changes. Count logical invocations honestly; do not claim three commands equal three HTTP requests or zero auth traffic. Existing CLI transport behavior is not a new wire-budget implementation task.

Run without verbose/debug tracing, `--reset`, `--force`, deployment flags or arbitrary hooks. Local scratch writes and the CLI's normal authentication cache are the only permitted non-evidence local side effects. No remote app/configuration/extension/store resource mutation is authorized.

Completion: one CLI-produced configuration artifact, installed-tool provenance and before/after version observations, or an explicit stopped result. Bracketing reads provide temporal corroboration, not an atomic remote lock or proof against an unseen switch-and-revert.

## 3. Interpret the artifact; observe the store console once

Inspect only relevant public configuration fields: client identity, required/optional scopes, URL, embedded flag, legacy install flow, webhook API and any other public fields necessary to specify preservation. Keep source distinction for each value: generated CLI field, direct prior API observation, native displayed field or unavailable. Defaults/fallbacks/omissions stay qualified.

The official configuration loader selects and transforms configuration modules and may fall back to other app properties; generated TOML is **not** a raw server payload or complete released-extension export. Inspect the installed mapping for access-scope defaults. An empty generated field may support the explanation but cannot be labelled an explicit raw remote empty field unless its provenance supports that statement. The earlier five explicit API empties remain independent earlier observations, not a new probe.

One additional **existing-session native Dev Console view scope** is permitted in Shopify Admin for `insignia-rewrite-dev.myshopify.com`, Shop `gid://shopify/Shop/105501393179`, and the exact app above. Reserve it before opening. Use an existing visible native navigation/control, not a guessed internal endpoint. Inspect explicit preview status, target and connection/update information; note whether ownership is attributable without exporting personal account details. Any preview extension list is preview evidence, not the active released manifest.

Do not launch the embedded app or a preview to expose the console. A login requirement, unavailable native control or ambiguous app/store identity ends that view with NOT_OBSERVED. No cleanup, uninstall, start/stop preview, release, install or other action button may be used. Absence of a banner/row is not an explicit no-preview statement. Incidental UI requests are not individually budgeted or claimed absent.

The CLI and console portions are independently useful read paths; failure of one permits only the other already-authorized portion, not another attempt or a new route. An identity mismatch ends all authenticated work. Preserve any competing preview unchanged.

Completion: source-labelled configuration and one explicit preview observation or its specific limitation. A full released-extension inventory unavailable through these paths remains unavailable; do not invent it or write another tool to obtain it.

## 4. Return a decision, not a recursive investigation

Compare the new evidence with M5-005 and M5-006. Where supported, give **one smallest development-access amendment proposal** with exact target/baseline, fields to change and preserve, extension-preservation mechanism, store/preview impact, consent assumptions, verification and rollback conditions. This is a proposal only. Do not insist on proving an unobservable historical scope-change time before specifying a safe forward action.

Any proposed app-version operation must account for all installed stores, not assume that an app-wide release affects only the named development store. Local Functions must not be incidentally deployed. If the released manifest is unknown, reject an unqualified local deploy; describe the remaining prerequisite or a supported extension-preserving mechanism as a separately reviewable proposal. Explicitly distinguish public documentation of such a mechanism from verification of this app's resources.

If the new information cannot support a remedy, identify the **one decisive missing source/permission** and its consequence. Do not propose another identical overview or repeat the exhausted same-bearer scope experiment. Useful owner-supplied sanitized evidence may be cited if actually provided, never assumed to exist.

No access repair, scope amendment, grant relaxation, reauthorization/reinstall, app-version creation/release, preview operation, fixture/product/Function/billing/commerce work, M5-004/M5-005 replay or production activation is authorized even if the observations now show nine scopes.

## 5. Preserve and hand back

Retain a minimal sanitized result. Keep personal actors, tokens, headers, raw auth bodies, browser storage, private URLs/query strings and raw session/network logs out of Git and the handoff. Record hashes/provenance of sanitized artifacts without implying they are original remote bytes. Leave original closed-run registers untouched; record local preservation checks, not a fabricated new execution receipt.

After obtaining useful new evidence or a concrete new prerequisite, create one docs/evidence-only branch from the verified merge. Allowed changes: imported `docs/delivery/PR-032-principal-review.md`, this prompt, `M5-007-REPORT.md`, minimal `docs/delivery/evidence/m5-007/`, and short AGENTS/state/tooling pointers. Generated capture TOML belongs only as clearly labelled sanitized evidence, never as the application's operative configuration. No source/operator/test/dependency/CI/migration/architecture changes or new harness.

Fresh independent actual GPT-6.1-sol/high Spec and Standards/security reviewers assess the complete docs/evidence change, attribution, command path and permission compliance. Use existing JSON/redaction/path checks and all applicable exact-head CI. Do not manually rerun unchanged root/integration/stress/benchmark suites merely for this capture or alter existing checks. Automatically triggered suites remain separately reported.

Return exact refs, complete scoped reports, CI, command/view accounting, installed CLI version, observation limitations and one proposed next decision, then stop for principal review. When no new evidence/prerequisite is obtained, return the local blocker note instead of a redundant PR. No successor merge, complete M5/gate pass, M6/M7, RELEASE_BOUND authority or launch follows.
