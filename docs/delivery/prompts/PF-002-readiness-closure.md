# PF-002 — close the three remaining M0 prerequisites

Principal-issued: 24 September 2026.
Local orchestrator: sol-6-high; observed project mapping to verify is `gpt-6-sol` with `high` effort.

## Outcome

Establish an executable restricted agent/review path, native Rust build/test readiness, and the identity/distribution of the existing designated Shopify app. Return one focused readiness/evidence PR. This is not another full preflight, architecture audit, application scaffold or development-gate slice.

PR #1 is principal-approved for the documentation/configuration bootstrap at base/merge base `38a711ad46aec63b8f410519f30352a88e4113c7`, head `722afb3990468b7963407f9c6706127974d7a8fd`. The user retains merge authority. Native approval and comment submission by the principal both failed with HTTP 403; the accompanying principal record is an external verdict, not a native GitHub review.

Only PF-002 is newly authorized. M0-001 and G1–G8 remain unauthorized and NOT_RUN until a subsequent principal prompt.

## 1. Resume and preserve approved state

Read root AGENTS, the ledger, operating model, tooling register, PF-001R report/probes, this prompt and the companion principal review. Use the pinned writing-for-agents skill for document changes and diagnosing-bugs for the actual runtime failure; their default steps remain subordinate to this slice.

Verify Git status and current remote PR/base/head before acting. The approved rewrite is `Optidigi/insignia`, GitHub repository ID `1386102402`; its local path was `/home/serveradmin/insignia-rewrite-20260924`. The old repository is `Optidigi/insignia-legacy`, ID `1208037734`, for storefront visual reference only. Do not repeat already answered destination/authentication questions or treat the neutral source workspace as the rewrite.

Keep the reviewed PR #1 head unchanged. After the maintainer merges it, record the actual merge result, fetch main and branch from that real remote state. A squash/rebase merge can produce different commits; inspect the merged content rather than assuming original commits must be ancestors. Do not merge the PR yourself, reset user work, force-push, or change protections. While waiting for the merge, independent read-only diagnosis and permitted scratch probes can continue without editing PR #1.

Reuse passing PF-001/PF-001R checks within their demonstrated scope. Recheck capabilities affected by changed host packages, executable resolution, project trust or launch context. Preserve both architecture files byte-for-byte. Record the principal verdict as an attributed external review; never manufacture a native approving review under the author's identity.

**Complete when:** the working context, predecessor review and branch state are unambiguous and the approved branch has not been changed.

## 2. Runtime: make a bounded fresh execution path work

The observed failure is `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, before repository reads. The reported host lacked `/usr/bin/bwrap`; unprivileged user-namespace creation also failed. Confirm the current facts before fixing anything.

Use installed-version help and official sandbox/config guidance. Inspect executable resolution and relevant namespaced/AppArmor diagnostics without dumping credentials, whole configuration files or unrestricted environment output. A distribution bubblewrap install is a reasonable host-maintainer starting action, not a guaranteed diagnosis or cure. The user/host maintainer must perform or explicitly authorize elevated package operations and machine-level policy changes. Do not disable AppArmor/user-namespace restrictions, request a privileged container, or switch to danger-full-access as a substitute for passing the test. If normal package setup is insufficient, provide the exact observed failure and smallest supported host remedy; continue independent work.

Verify the actual chosen execution path, not merely a separate CLI installed next to the active host. Check project trust, configuration precedence and the effective launch settings. If the parent host cannot expose its settings, use its supported settings/diagnostics or move the future orchestrator launch to a verified local client with the user's chosen model; do not silently substitute a different model/provider. Project/user trust changes need the owner's consent; explicit per-invocation overrides are an acceptable bounded interim mechanism when confirmed effective.

Model acceptance is **observable client configuration and execution**, not private provider telemetry. Record the actual launch command/profile and resolved client/session/request metadata for model `gpt-6-sol` and effort `high`, with a successful fresh response and no reported fallback. A documented explicit launch plus its actual resolved client configuration is sufficient even when JSON conversation events omit provider-internal model routing. Do not use model self-identification as evidence, intercept secrets, or demand impossible server-side attestation. Distinguish configured values, observed launch values and information not exposed. Verify child settings only before using those children.

Run a fresh restricted session that actually reads from disk:
- root `AGENTS.md`;
- `docs/architecture/decision-ledger.md`;
- this active PF-002 prompt;
- one pinned selected skill.

Have it cite the active authorization and two locked decisions using real file/line references. Demonstrate restrictions with harmless canary controls in an explicitly designated scratch location. Use a path denied by the tested policy rather than assuming every temporary directory is denied. A failed write counts only if the denial is attributable to the intended sandbox, not an unrelated ownership error. Never test by modifying a real user file. Check before/after tree status and clean any canary created if the negative test unexpectedly succeeds; an unexpected success is a failed enforcement test, not a reason to hide the observation.

Before implementation, also demonstrate the chosen writer path can write/test in its designated scratch workspace while staying within its approved boundary. A working reviewer alongside an unrestricted writer does not establish a bounded execution workflow. Scope credential-bearing/network tools separately: a shell sandbox is not evidence that all MCP or connector actions are sandboxed. Review sessions should not receive mutation-capable services unnecessarily.

Native subagents may stay disabled. A functioning fresh, sequential read-only review is sufficient for this first slice. If isolation is still broken, label that path FAILED and do not relabel an unrestricted advisory review as independent enforced review.

**Complete when:** the actual writer/reviewer execution routes can perform their permitted harmless work, the restricted reviewer reads the correct files, policy denial is exercised safely, and the chosen model/effort is supported by observable same-launch client evidence.

## 3. Rust: verify the host side, not only Wasm output

Keep the isolated pinned toolchain from PF-001R unless a concrete compatibility failure requires a reported change. Use its required CARGO_HOME/RUSTUP_HOME and executable paths explicitly. The previous direct Wasm compile remains a valid result but does not prove native linking; the record explicitly says `cc` is missing.

Inspect available supported linkers/C toolchains. The host maintainer can install the distribution build-tool package when needed; on the reported Ubuntu host, Rust's official installation guide identifies `build-essential`. Do not install global packages or alter profiles without permission.

In disposable scratch space, run a minimal native `cargo test`, execute a harmless host build script and build/use a minimal procedural macro. Use a tiny dependency-free harness where practical; this is toolchain evidence, not an excuse to initialize the application workspace or Shopify Function. Record linker selection, target, full commands, versions and results. Re-run the generic Wasm target check after any relevant toolchain change. Preserve the smoke source and invocation in sanitized evidence so another reviewer can reproduce it.

**Complete when:** native compilation/linking and test execution, host build-script/procedural-macro support, and the Wasm target work under the intended execution setup. Formatting/clippy alone is insufficient.

## 4. Shopify: read the existing app through the narrowest route

Use the already designated resources; do not ask the user to designate them again:

- Organization ID: `212732011`.
- Existing app display name supplied by the user: `insignia`.
- Designated Dashboard resource: `https://dev.shopify.com/dashboard/212732011/apps/427859050497`.
- Staging store: `insignia-staging.myshopify.com`, reported shop ID `gid://shopify/Shop/78935261342`, Basic development store.

The Dashboard number `427859050497` is a resource identifier, **not an established OAuth client ID**. Account-level `store info` success and direct store-auth sessions are different observations; neither by itself proves app installation or granted Admin API scopes.

PF-002 explicitly permits using the pinned CLI's documented **existing-app configuration import/link** in a fresh scratch directory. Verify help first, select only the designated existing app, fetch its configuration and use nonmutating app-info reads where supported. Do not choose a new-app option. Do not use `--force` over existing work. Creating that scratch configuration is allowed; creating an application scaffold, new app, installation, Function, theme, app version, scope change, distribution change or other remote resource is not.

Imported configuration stays outside the repository. Commit only the necessary sanitized identity/access observations. Confirm the actual OAuth client ID and its binding to the named Dashboard app; inspect distribution separately through a supported read or a sanitized owner-provided Dashboard view where the CLI cannot expose it. Do not infer distribution from Basic-plan store metadata, app name, config shape or future intent. If distribution is currently unselected, record UNSELECTED; any selection needs its own authorized step rather than being guessed.

Record existing scopes and installation state where readable. If an authorized installed-app credential is already available, make the narrow harmless Admin API read required to establish its shop/install context without exposing the token. If the app is not installed or needs first-install scopes, record NO_EXISTING_INSTALL / SETUP_REQUIRED and specify the minimal future installation/access step. **Lack of a first installation is not permission to install during PF-002, nor an impossible prerequisite for authorizing a later slice that explicitly includes installation.** Do not confuse unrelated store/admin credentials with this app's installation.

When a Dashboard field is genuinely inaccessible after the existing-config route, request only the missing nonsecret field/view from the owner. Never request client secrets, access tokens, device codes, broad Dashboard exports or unredacted account screenshots. Reuse the already valid staging identity evidence unless an observation contradicts it.

**Complete when:** the existing app/resource/client ID binding is independently evidenced, distribution state is observed, and access/installation state is truthfully classified with a concrete next-step permission envelope. A Basic dev-store test is not proof of production non-Plus availability.

## 5. Persist a short readiness delta and return for review

Allowed repository changes: this prompt and companion attributed principal record under `docs/delivery/`; minimal AGENTS/current-slice routing; the delivery-state and tooling delta; reproducible sanitized evidence; narrowly necessary project-local runtime configuration. Existing code/architecture, production settings, app configs/deployments and billing remain outside scope.

Record the new-versus-legacy repository identity in the operational pointer so old pre-rename URLs cannot send agents to the wrong source. Historical transfer manifests and reports remain historical; do not overwrite their hashes to pretend operational edits were present at transfer. Link the actual PR/review and prior reviewed head. Final current-head hashes belong in PR metadata or external output rather than causing self-referential commit churn.

Use one evidence document for the three outcomes, not another duplicate full preflight. A bounded status table should give observation, evidence, remaining action, owner and earliest affected slice. PostgreSQL, R2, billing resources, every possible subagent role, CI infrastructure and provider-private wire attestation are not new blockers for the smallest DB-free M0 harness. Application CI will accompany the authorized implementation work; do not build a workflow platform here.

Run the available fresh fixed-ref local review and document its actual execution mode. If unavailable, disclose that and submit the evidence rather than fabricating a pass. Finish all independent safe checks before batching remaining owner-only actions. Commit only scoped work and open one readiness PR after PR #1 has been merged. The principal reviews the actual head; local success is not permission to begin M0.

Return PR URL, full base/head/effective merge-base, source PR #1 merge result, three-outcome evidence table, unchanged plan/ledger hashes, and any exact owner-only actions. Distinguish implementation readiness, principal approval, native GitHub review status and merge status.

**Stop after this handoff.** Do not start M0-001, execute G1–G8, install/deploy the app, change scopes/distribution, process orders, create billing events, merge, or mutate production resources.

## Official references

These establish tool capabilities, not a passed local result. Check installed-version behavior first.

- Codex sandbox: `https://developers.openai.com/codex/sandboxing`
- Codex configuration/trust/precedence: `https://developers.openai.com/codex/config-basic`
- Rust installation/linker requirements: `https://doc.rust-lang.org/book/ch01-01-installation.html`
- Shopify existing configuration import: `https://shopify.dev/docs/api/shopify-cli/app/app-config-link`
