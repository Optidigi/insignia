# M5-007R — source-reviewed CLI launch boundary

## Result

**BLOCKED before authenticated CLI capture.** The new installed-source audit and independent restricted launch review establish a pre-CI device-authorization route that the prescribed environment cannot prevent. Startup also permits same-account external plugin hooks whose registry is outside the permitted inspection paths. No Shopify invocation, authenticated request, browser view or credential/cache-content inspection occurred. All three logical capture slots remain NOT_RUN (0/3, no reservations); no version-context/capture directory or TOML was created. This is a concrete new execution prerequisite, not a scope-access observation.

The [brief](prompts/M5-007R-CLI-CAPTURE-CONTINUATION.md) authorizes this docs/evidence handback when the launch safety gate cannot close. No production/operator/test/TOML/dependency/CI/migration/architecture change is proposed. M5-004/005 registers remain closed; this result does not authorize replay or grant repair.

## PR #33 normal merge

Immediately before merge, GitHub and the clean worktree matched target `main`, base/effective merge base `3aa67ef95154a07b3100a5f2042d9173bbe1f6eb`, approved head `3265e9715ea42eaf0d09ae4c1010242dd8cd9206`, tree `3e2c3caa0f58f9af377347f089455308143c68a4`. Ten exact-head workflows completed SUCCESS at attempt 1. [External principal approval](PR-033-principal-review.md) covers those refs; no native approval was manufactured.

Executed `gh pr merge 33 --repo Optidigi/insignia --merge --match-head-commit 3265e9715ea42eaf0d09ae4c1010242dd8cd9206`. GitHub readback, fetched Git object and remote main verified merge **`8ec0b62526a1f8c115c2f8b9d38057a5e61b8cdb`**, at 2026-10-02T12:37:11Z, with ordered parents:

1. `3aa67ef95154a07b3100a5f2042d9173bbe1f6eb`
2. `3265e9715ea42eaf0d09ae4c1010242dd8cd9206`

Resulting tree **`3e2c3caa0f58f9af377347f089455308143c68a4`** matches approval. Reviewed head unchanged; normal merge only, no squash/rebase/force/bypass. This branch, `feat/m5-007r-cli-launch-boundary`, starts at that verified merge. [Merge receipt](evidence/m5-007r/pr33-merge.json); [approved-head checks](evidence/m5-007r/approved-head-ci.json). Final successor refs/checks belong in the PR packet after commit, not this self-referential report.

## Actual installed checks

| Check | Actual result |
|---|---|
| Neutral supplied-package extraction / manifest | SHA-256 `50e9d801d593d299718f1c064ef1b7d4df8fe998b504d1a5e455a50ebe88da22`; all 7 supplied manifest entries match |
| Isolated executable/package | `.bin/shopify` resolves to `/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/bin/run.js`; manifest reports 4.8.2 |
| Pinned Node | Exact `/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node --version` returned v24.21.0; no Shopify version/help probe |
| Principal source anchors | KANWS6HC `66ccd85d7ab66455d1e7724e1618891cbec7409990c8cf1cc9bc65331215d811`; ESTXKKAB `c75a0d473ba3325862e9455717d14b8892e1c30428d8adf20c53310f1d687ef8`; both match |
| Installed lifecycle audit | Root read entry/bootstrap, Oclif loading, init/prerun/postrun, both commands, app selection/context/config writing, auth and update/analytics paths; [25 file hashes](evidence/m5-007r/launch-policy.json) |
| Fresh launch review | Actual gpt-6.1-sol/high, separate read-only/no-approval CLI session; **BLOCKED**; [full report](evidence/m5-007r/launch-security-result.md), [observable same-launch settings](evidence/m5-007r/launch-security-settings.json) |
| Three authenticated logical commands | 0/3; all NOT_RUN, no reservations; [accounting](evidence/m5-007r/capture-state.json) |
| Current session validity / deadline / descendant handling | NOT_TESTED / NOT_EXERCISED; no Shopify process launched |

These are static installed-source facts, not a claim that a protected launch worked. No provider-private attestation is requested. Root model/effort comes from trusted T3 runtime metadata; reviewer model/effort/sandbox comes from selected same-launch `turn_context` fields. Fresh scoped Spec and Standards/security reviews of this complete docs change and applicable automatic final-head CI are recorded separately in the PR packet. The launch safety BLOCKED verdict is preserved even if those documentary reviews pass.

## Why the gate stays closed

### Pre-CI authentication request

`chunk-MJ3WNVMQ.js` AppManagementClient `session()` calls `zDt()` without `noPrompt:true`. `chunk-NYHGIWKZ.js` `yu()` defaults `noPrompt:false`. A missing/invalid session, or a particular failed refresh, can enter `fce()` → `Nse()` → POST `/oauth/device_authorization`. **The CI check follows that POST.** It prevents verification-code display, browser opening and polling, but does not prevent initiating the new authentication route. Closed stdin and a process timeout cannot prevent a preceding HTTP request. No session cache was opened to assert which branch today's session would take. Existing-session renewal permission does not justify silently treating the full-auth branch as renewal.

### External plugin hooks

`chunk-GZKEIUJT.js` constructs ShopifyConfig with a package root but no `userPlugins:false`. `chunk-CTNBSUVU.js` default `loadUserPlugins` can load user/link entries from the same-account Oclif registry and run their lifecycle hooks. Removing environment overrides and using an empty project does not disable that registry. Its presence and contents were not inspected outside the named package/worktree/evidence read boundary. This is **unverified**, not evidence that an unsafe plugin exists or executed.

### Established guarded behavior

The prescribed fresh allowlist explicitly sets CI=1 and SHOPIFY_CLI_NO_ANALYTICS=1 and omits inherited force-upgrade, SHOPIFY_FLAG_*, token/auth-route, proxy, loader, plugin and debug overrides. It retains original same-account HOME plus ordinary runtime settings. Installed source shows the known updater cannot be selected with CI true and force override absent; CI also suppresses notification subprocesses, and analytics opt-out suppresses transmission. These controls do not disable unknown plugin hooks or make the auth path read-only. They have **not been exercised** in a Shopify process in this slice.

Under the proposed empty/single-public-input scratch assumptions, built-in explicit-client routes resolve only the designated existing client. No interactive app creation, remote deploy/release, resource registration or dependency install is called by those command bodies. Expected official local side effects include directory-scoped selection/context preferences, `.shopify/project.json`, metadata/credential renewal caches and Node compile cache; the proposal never authorizes changing persistent auto-upgrade preferences. The [root note](evidence/m5-007r/launch-root-note.md) and independent report retain these limits.

## Capture and scope comparison

There is no generated configuration to classify or bind to a version bracket. Client/scopes/optional scopes/URL/embedded/legacy/webhook fields and remote active version are **NOT_OBSERVED by M5-007R**. Source inspection of `kE/Zo` versus `UW` establishes how a future CLI output could be mapped or defaulted; it supplies no current field values. A capture would be transformed configuration, not raw provider JSON or a complete released-extension manifest. Before/after version reads would be temporal corroboration, not an atomic lock.

[M5-005](M5-005-REPORT.md)'s explicit empty scopes and [M5-006](M5-006-REPORT.md)'s Active/Released `insignia-1` / `1146748534785` retain their original timestamps/provenance. The expected target remains app429028933633/client1443cf6d03d39edae7c101a943c5c684/DevOrg200969036. Preview/extensions remain NOT_OBSERVED here. No cause or historical scope-change time is inferred. The nine retained dev grants remain historical retained state, not a fresh observation or repair target.

## One proposed next decision

**Principal/owner disposition of a narrowly revised official-CLI launch envelope is the decisive prerequisite.** It must explicitly decide whether the installed 4.8.2 noninteractive pre-CI device-authorization request may be attempted and immediately stopped, without displaying a code, browser, polling or consent; it must also permit a narrow read-only inspection of the source-resolved Oclif plugin registry metadata and any referenced hook code, or specify a supported reviewed isolation mechanism preserving the original authentication/cache route. Neither exception is assumed or executed here. This is one bounded launch-policy decision, not a request to login, install, repair grants, change CLI versions or weaken host security.

The experiment's baseline/target and original three fixed-client operations stay unchanged. No development-access repair can yet specify remote changed/preserved fields, extension-preservation mechanism, installed-store impact, preview/consent dependencies or rollback from a configuration that was never captured. Those are explicitly unknown, not license to improvise a release. If a subsequent launch is authorized, abort on failure and preserve the bracket/output; only the principal can authorize the following development-access remedy.

## Preservation and final state

The earlier M5-007 global npm install remains an unauthorized deviation: installer-reported 4.8.3 is not adoption, and exact global footprint remains unresolved owner-controlled host follow-up. It was untouched and unused. The prior security review's overbroad filename-only `/tmp` discovery limitation stays preserved; this slice confined package inspection to named paths and did not repeat it.

[M5-004](evidence/m5-007r/m5-004-preserved.json) and [M5-005](evidence/m5-007r/m5-005-preserved.json) canonical registers match historical byte hashes; no replay. Old worktree remains clean at PR33 approved head. Shared infrastructure, old fixtures, nine grants, billing resources, stopped previews and orders #1001–#1006 were not accessed or changed. No Shopify process, install/updater or browser operator was launched; the fresh launch reviewer exited 0. Native agent listing showed only the root. Final scoped reviewer exits/process state and automatic CI belong in the final packet.

No manual unchanged root/PostgreSQL/stress/benchmark rerun. Focused diff/JSON/redaction/path/integrity checks passed for the changed docs. The pinned Node existing `scripts/boundaries/check-secrets.mjs` invocation exited 1 because the fresh docs worktree lacks unchanged `apps/storefront/dist/insignia-storefront.js`; it did not complete the artifact scan. No build/suite rerun was added to supply those artifacts. Applicable automatic CI runs the unchanged full check after building; its result must be reported separately. Automatic workflows remain intact. Source, schemas, production auth and RELEASE_BOUND readiness are unchanged. No gate pass, activation, M6/M7 or launch is claimed. **Stop for principal review; no successor merge or resumed CLI capture is delegated.**
