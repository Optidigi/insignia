# M5-007 — read-only configuration capture, stopped before authentication

## Exact authority and merge

The owner authorized only PR #32's normal merge at base/effective base `dbaa7488780ddf8fd01991bf5a76a909e07b34e0`, head `4e67cde30707ae5e55cad7a7d1344bb3f733f388`, tree `52d6b462dfd3e145e2eab9c6e0911c8ddefd2c7d`, followed by the [M5-007 brief](prompts/M5-007-READONLY-CONFIGURATION-CAPTURE.md). The [PR-032 verdict](PR-032-principal-review.md) is attributed external approval, not a native GitHub review. All seven supplied manifest entries passed. [Authority and archive hashes](evidence/m5-007/authority.json).

Immediately before merge: live PR/main/head/tree/effective base matched, old worktree was clean at approved head, normal merge was permitted, PR was CLEAN/MERGEABLE and all ten applicable approved-head workflows were SUCCESS on attempt 1. No pre-merge commit, squash/rebase, force push, native approval or protection bypass.

Actual remote normal merge: **`3aa67ef95154a07b3100a5f2042d9173bbe1f6eb`**. Ordered parents: `dbaa7488780ddf8fd01991bf5a76a909e07b34e0` then `4e67cde30707ae5e55cad7a7d1344bb3f733f388`; tree `52d6b462dfd3e145e2eab9c6e0911c8ddefd2c7d`. Remote main and fetched Git object matched. [Receipt](evidence/m5-007/pr32-merge.json), [approved-head CI](evidence/m5-007/approved-head-ci.json). The evidence branch was created afterward from this verified merge, after concrete new blockers were observed. No prior work was overwritten.

## Installed-tool outcome and unintended side effect

The existing isolated official executable is `/home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify`, package `@shopify/cli` **4.8.2**. Three preliminary local commands were run with `SHOPIFY_CLI_NO_ANALYTICS=1`: `shopify version`, `shopify app config link --help`, and `shopify app versions list --help`. Both help commands exited 0 and exposed the intended client/path/file-name or config/json flags. Entry source for both commands and the version command was read; this is **partial inspection**, not a completed context-loading/transport safety audit.

**The version probe unexpectedly triggered an automatic global upgrade.** After printing 4.8.2, the CLI announced `npm install -g @shopify/cli@latest`; its inherited output reported 49 changed packages and a successful upgrade to 4.8.3. The process finished before the attempted interrupt. This was an unintended, out-of-envelope local side effect; it is not represented as an authorized installation or a harmless read. No remaining identified upgrade process was found. The isolated project-local package still reports 4.8.2 by package-file inspection. No default `shopify` executable was found on this shell's PATH, so the exact global destination/resulting executable was **NOT_OBSERVED**; the 4.8.3 conclusion above is the installer output, not an independent binary invocation.

The operator stopped all further CLI work under the brief's unsupported-behavior rule. No manual rollback, global auto-upgrade setting change, additional CLI version probe, authenticated command, account switch, login or consent was attempted. The built-in upgrade's public package/network activity is disclosed; this is not a zero-network claim. [Installed check and source hashes](evidence/m5-007/cli-installed-check.json).

Installed `dist/chunk-KANWS6HC.js` confirms the npm global-upgrade path. Its auto-upgrade decision returns without upgrading when its imported CI guard is true (unless `SHOPIFY_CLI_FORCE_AUTO_UPGRADE=1` takes precedence). The installed guard in `dist/chunk-ESTXKKAB.js` reads `process.env.CI`. The force flag was not enabled in this launch. A process-local `CI=1` launch is a **source-supported proposal**, not exercised evidence; no such second launch was made. Complete command-context hooks and noninteractive behavior still require local verification before any newly authorized authenticated invocation.

## Capture and command accounting

| Intended operation | Result |
|---|---|
| Fixed-client versions list before capture | NOT_RUN |
| Fixed-client config link into empty capture | NOT_RUN |
| Exact repeated versions list after capture | NOT_RUN |
| Authenticated logical CLI invocations | **0 of at most 3** |
| Generated TOML/configuration fields | **NOT_CREATED / NOT_OBSERVED** |
| Current active-version before/after bracket | NOT_OBSERVED |

A uniquely named mode-0700 `/tmp` capture directory was created empty, outside repository/worktrees/parent app projects; no discoverable ancestor app TOML existed. It remains empty, with no historical scopes, environment, extensions, dependency or credential/cache seed. No version-context input was prepared because the CLI branch had already stopped. [Capture state](evidence/m5-007/capture-state.json). No authenticated invocation was reserved or attempted; the preliminary local version/help checks are counted separately, not relabelled as the three permitted app reads.

There is no new configuration artifact to interpret. The prior nine-scope TOML remains local historical input, not a newly downloaded declaration. No inference about released extensions follows from an empty scratch directory. The brief's required transformed/default/fallback attribution remains outstanding rather than invented.

## One independent existing-session native view

After recording one view reservation, the already connected shared browser opened the known designated Admin store root `https://admin.shopify.com/store/insignia-rewrite-dev`, using its existing authenticated session. The native title was `insignia-rewrite-dev · Home · Shopify` and the designated store slug was visible. No login/consent was needed.

No visible native **Dev Console** control was exposed by the page snapshot or focused read-only inspection of visible links/buttons. Under the brief's unavailable-control stop rule, the operator ended that view without guessing an internal endpoint, launching the embedded app/preview, navigating settings, clicking cleanup/uninstall, or selecting another app/store.

| Console fact | Result |
|---|---|
| Logical view scopes consumed | **1** |
| Dev Console opened | No — native control unavailable |
| Console exact app/client and shop GID | NOT_OBSERVED; store slug only confirmed |
| Explicit preview status/target | NOT_OBSERVED |
| Connection/update information, preview extensions/owner | NOT_OBSERVED |

[Sanitized reservation/outcome](evidence/m5-007/console-observation.json). Missing controls do **not** establish no preview, zero extensions or released-version equivalence. Snapshot tooling incidentally returned unrelated native page/diagnostic data; only the narrow facts above were retained, with no screenshot, actor/account data, private URL, browser storage or network/console trace exported. Ordinary native UI background traffic is not counted as scripted API activity or claimed zero.

## Supported interpretation and one next decision

[M5-005](M5-005-REPORT.md)'s five explicit EMPTY API/token scope surfaces remain time-specific direct evidence. [M5-006](M5-006-REPORT.md) identifies Active/Released `insignia-1` / `1146748534785`, but scope lists/extensions/explicit preview state were NOT_OBSERVED. M5-007 adds **a concrete local execution prerequisite and an authenticated native-control limitation**, not a new declaration or preview-state observation. The released/development-context working explanation is neither proved nor disproved; no provider defect, revocation or historical change time is inferred.

**One proposed next decision:** authorize a revised, strictly bounded continuation of the same three official CLI capture reads using the retained isolated 4.8.2 executable with **process-local `CI=1`**, after verifying its full command/context hooks and noninteractive existing-account path. Keep the explicit client, empty private capture, 120-second deadlines and once-only three-command ceiling; reject login/consent or remote writes. Do not change the host's persistent auto-upgrade setting or silently use the reported new global executable. This proposed launch suppresses the inspected upgrade branch without changing global policy, but has not been run and does not promise successful authentication/capture.

That is the decisive safe-launch permission/prerequisite before the missing configuration source can be acquired. It is **not** an access amendment, repair or renewed console attempt. No current evidence supports specifying a nine-scope release. A later remedy must separately account for every installed store, preservation of actual released extensions and competing previews; an unqualified local deploy is inappropriate while that manifest remains unknown. No automatic scope change, reauthorization or M5-004 replay follows from future nonempty fields.

## Preservation, verification and boundary

Actual root/operator is GPT-6.1-sol/high; repository-pinned writing-for-agents, handoff and code-review were read. Root is the sole writer/operator; fresh restricted same-model/high reviewers will assess the **complete documentation/evidence change**, not unchanged production source. Local JSON/redaction/path/Git checks and automatically triggered applicable exact-head CI are reported separately in the PR packet. No unchanged root/PostgreSQL/stress/benchmark suite is manually rerun for this inspection.

Closed M5-004/M5-005 canonical files remain byte-identical ([004 receipt](evidence/m5-007/m5-004-preserved.json), [005 receipt](evidence/m5-007/m5-005-preserved.json)); no replay or budgets reopened. Historical source/evidence, operative TOML, architecture, operators, tests, dependencies, migrations and CI are unchanged. No harness/internal API client was added. Owner credential files were not manually read, printed, copied or modified. There were no authenticated app CLI invocations, scripted Shopify API/token requests, remote resource writes, preview/release/repair, commerce/Function/billing operations or cleanup actions. The unexpected global npm side effect is explicitly excepted from local-preservation claims above; no remote state restoration is claimed from inspection alone.

M5-004 remains BLOCKED and its cases NOT_RUN. Public-merchant authentication, production readiness and RELEASE_BOUND are unchanged. Return this one concrete-prerequisite docs/evidence PR and stop for principal review. No successor merge, activation, M6/M7, gate pass or launch is authorized.
