# PF-001R sanitized probe record

24 September 2026. Source checkpoint: `7f7fbabbfb60bd0e3d693d332e2b7da59693b9dd`. All paths here are local evidence locations, not an approved rewrite destination. No credential values or buyer data are recorded.

## Reused passing PF-001 checks

The original `docs/delivery/evidence/pf001-probes.md` records commands and results for Git/worktree, Node 24.21.0, TypeScript 7.0.2, pnpm 12.6.0, Shopify Dev MCP 1.15.4 schema validation, and Playwright Chromium 153.0.8010.12 interaction/screenshot. No changed executable path or configuration affects those disposable probes. Developer MCP is documentation/schema access only. Their recorded scope is reused; none is a real-store gate result.

The original archive manifest passed before PF-001 edits. The supplied zip and current files have identical bytes for `docs/architecture/implementation-plan.md` (SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d`) and `docs/architecture/decision-ledger.md` (`0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`). The transfer manifest is intentionally preserved as a source snapshot; it is not a current-worktree manifest.

## Host and sandbox

- `git rev-parse HEAD` at resumption: `7f7fbabbfb60bd0e3d693d332e2b7da59693b9dd`; branch `local/pf-001-preflight`, clean, zero remotes. Original patch exists outside the tree. No newer work was reset.
- `codex --version`: 0.156.1, standalone Linux x86_64. `codex doctor --json`: provider `openai`, model `<default>`, active thread overrides `not inspected`, zero local MCP servers. The active API thread's declared sandbox/approval is `danger-full-access`/`never`; the CLI doctor invocation reported restricted filesystem/network and `OnRequest`. These are different runtimes.
- User-level trust list contains `/home/serveradmin`; no global model override. The project-local `.codex/config.toml` requests `gpt-6-sol`, `high`, and `multi_agent=false`, but `codex doctor --json` from this repository still reported model `<default>` and no feature override. Thus effective loading of this project config is **NOT_VERIFIED**. A launched session was explicitly given `-m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false'`; its JSON events did not expose effective wire model/effort. Neither this parent session nor child inheritance can be certified as sol-6-high from runtime diagnostics. Do not rely on the local file alone.
- `codex debug prompt-input` from the repo included root `AGENTS.md` and four discovered project skills (`writing-for-agents`, `tdd`, `code-review`, `diagnosing-bugs`). `handoff` has upstream `disable-model-invocation: true` and is available by file but not automatically injected. Prompt discovery does not establish shell-readable skill access in an isolated fresh session.
- A fresh `codex exec --ephemeral --json -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false'` was asked to read AGENTS, ledger, PF-001R prompt, and a selected skill and cite lines. Session `01a0d495-4e02-7311-a4e6-2cad520c64ed` exited 0 as a conversation, but its file read failed before opening a file: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. It declined to invent line references. The requested fresh file-reading check is **FAILED**; no read-only reviewer may be claimed from this invocation.
- Host diagnosis: Ubuntu 26.04.1 LTS; `/usr/bin/bwrap` absent; `unshare --user --map-root-user /bin/true` failed writing `/proc/self/uid_map` with `Operation not permitted`. `/proc/sys/kernel/unprivileged_userns_clone=1`, `/proc/sys/user/max_user_namespaces=125271`, `/proc/sys/kernel/apparmor_restrict_unprivileged_userns=1`; `/etc/apparmor.d/bwrap-userns-restrict` exists and names `/usr/bin/bwrap`. `codex sandbox -P :read-only -- /bin/true` exited 1 with the same loopback error. Candidate system package `bubblewrap` is not installed; installation/policy changes require host owner authorization. Installing it is a proposed first diagnostic step, not a proven cure. Do not disable AppArmor or the sandbox.
- The earlier fresh local review used a collaboration child under the API thread's `danger-full-access` runtime. It found no apparent scope or secret issue at the PF-001 checkpoint, then noted that the commit/patch and probe record were supplied. It had no enforced read-only sandbox and no remote base/head. It is useful feedback but does not satisfy fixed-ref isolated review.

## Isolated toolchains

- Before installation, no `rustc`, `cargo`, `rustfmt`, `rustup`, clippy, Wasm target or `shopify` executable was on PATH. No profile or global config was edited.
- Official `rustup-init` 1.29.1 binary from `static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init`; its SHA-256 `dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71` matched the official `.sha256` file. Installed with `--yes --no-modify-path --profile minimal --default-toolchain 1.98.1 --component rustfmt,clippy --target wasm32-unknown-unknown` and isolated `CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo`, `RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup`. Installation exit 0. These environment variables are required for later invocations; omitting them produced an expected `rustup` “no default configured” error.
- With those variables: `rustc 1.98.1`, `cargo 1.98.1`, `rustfmt 1.9.0-stable`, `clippy 0.1.98`; installed targets `wasm32-unknown-unknown` and `x86_64-unknown-linux-gnu`. `rustfmt --check /tmp/insignia-pf001r-rust/smoke.rs` exited 0. `rustc --edition 2024 --target wasm32-unknown-unknown --crate-type cdylib /tmp/insignia-pf001r-rust/smoke.rs -o /tmp/insignia-pf001r-rust/smoke.wasm` exited 0; `file` identified WebAssembly MVP; output SHA-256 `106d831c24abac91747a75b38e97285c182caf9ffea3f490bfe36143e08dc93f`. Disposable Cargo crate `cargo clippy --manifest-path /tmp/insignia-pf001r-rust/clippy/Cargo.toml --all-targets -- -D warnings` exited 0. Installer warned that a system `cc` linker is absent; native C-linked crates remain untested. This generic Wasm compile is not a Function or gate proof.
- Official `@shopify/cli@4.8.2` package inspected and installed with `npm install --prefix /home/serveradmin/insignia-pf001-tools/shopify --save-exact --ignore-scripts --no-audit --no-fund @shopify/cli@4.8.2` (exit 0). Downloaded tarball SHA-256 `0b1c01d1ebf1f1265826a4ffa78ea94bc4c2eb8a36beb9b2f5fb305ef30231ff`; package registry integrity `sha512-jAz3Pa9n5J/VWGvKGMiNoC3C3c/Oix3MvCPR2XFBkESGLG/NURrl8eRF41f/2aWUuyCKhq526j3LqVWLcIyzMQ==`. `SHOPIFY_CLI_NO_ANALYTICS=1 .../node_modules/.bin/shopify version` returned `4.8.2`; help/auth help passed. `shopify store auth list --json` returned exit 0 with zero sessions. No app/store identity request was possible without designated resources and existing credentials; no login or store mutation was attempted.

## Destination and scope

- `git remote -v`: empty. `gh auth status`: exit 1, “not logged into any GitHub hosts.” Connected GitHub app can read several Insignia-related repositories, but no exact rewrite `owner/repo` and base were approved. The user has indicated they will provide exact repository/branch and Shopify app/store identifiers; these have not yet been supplied. No remote write, PR, or ruleset check.
- PostgreSQL client/isolated DB access remains missing, but is **NOT_YET_REQUIRED** for the fixed-input, DB-free M0-001 lifecycle spike. It remains necessary for DB-dependent later work. R2 and Partner/App Pricing are later prerequisites. G1–G8 remain **NOT_RUN**.

## Exact repeat probes after fixed-ref review feedback

The following nonmutating or disposable commands were rerun from the neutral workspace on 24 September 2026. Each returned exit status 0 unless stated. The prior review of head `297002a948a065a76d6e9698758df4f4c26b2f11` identified abbreviated command paths; this section closes that evidence gap. The artifact at `/tmp/insignia-pf001r-rust/smoke.rs` is a generic two-integer add export, not application code.

```sh
CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup /home/serveradmin/insignia-pf001-tools/rust/cargo/bin/rustfmt --check /tmp/insignia-pf001r-rust/smoke.rs
CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup /home/serveradmin/insignia-pf001-tools/rust/cargo/bin/rustc --edition 2024 --target wasm32-unknown-unknown --crate-type cdylib /tmp/insignia-pf001r-rust/smoke.rs -o /tmp/insignia-pf001r-rust/smoke.wasm
CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup /home/serveradmin/insignia-pf001-tools/rust/cargo/bin/cargo clippy --manifest-path /tmp/insignia-pf001r-rust/clippy/Cargo.toml --all-targets -- -D warnings
SHOPIFY_CLI_NO_ANALYTICS=1 /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify version
SHOPIFY_CLI_NO_ANALYTICS=1 /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify help
SHOPIFY_CLI_NO_ANALYTICS=1 /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify auth --help
SHOPIFY_CLI_NO_ANALYTICS=1 /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify store auth list --json
```

Rust formatting and compile commands emitted no output; clippy reported completion with no warnings. CLI version was `4.8.2`; help identified Node `24.21.0`; store auth list returned `sessions: []`. No store identifiers or credentials were present in that JSON.

Exact fresh restricted-session command, also from the neutral workspace:

```sh
codex exec --ephemeral --json -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false' 'Read AGENTS.md, docs/architecture/decision-ledger.md, docs/delivery/prompts/PF-001R-remediation.md, and .agents/skills/writing-for-agents/SKILL.md. Give file and line references for current authorization and two locked decisions. Do not edit or call external services.'
```

The CLI conversation exited 0, session `01a0d495-4e02-7311-a4e6-2cad520c64ed`; its file-read tool failed with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, and the model explicitly refused to supply unverified line references. `codex features list` showed `multi_agent=true` from this neutral project; `codex --disable multi_agent features list` showed `false` for that explicit invocation. This reinforces that the project file is not proven effective.

## User-designated rewrite repository and local authentication

After the user designated `https://github.com/Optidigi/insignia` and completed local `gh` login, these read-only commands were run on 24 September 2026:

```sh
gh auth status --hostname github.com
gh repo view Optidigi/insignia --json nameWithOwner,defaultBranchRef,isEmpty,isPrivate,viewerPermission,url --jq '{nameWithOwner,defaultBranchRef,isEmpty,isPrivate,viewerPermission,url}'
gh api repos/Optidigi/insignia --jq '{full_name,default_branch,size,private,permissions,archived,disabled}'
gh api repos/Optidigi/insignia/branches --jq '[.[].name]'
gh api repos/Optidigi/insignia/rulesets --jq '[.[]|{id,name,enforcement,target}]'
GIT_TERMINAL_PROMPT=0 git ls-remote --symref https://github.com/Optidigi/insignia.git HEAD
GIT_TERMINAL_PROMPT=0 git ls-remote --heads https://github.com/Optidigi/insignia.git
```

All returned exit 0. The authenticated account was `shimmy-aga`; repository `viewerPermission` was `ADMIN`, and permissions included push. The repository was public, active and empty (`size: 0`, `isEmpty: true`). REST metadata named `main` as default branch, but GraphQL `defaultBranchRef.name` was blank. The branch and ruleset arrays and both Git ref listings were empty. Thus `main` has no actual commit SHA and cannot be a PR base yet. The actual rewrite clone at `/home/serveradmin/insignia-rewrite-20260924` has `origin=https://github.com/Optidigi/insignia.git` and an unborn local `main`; no file was copied or remote write made. The authenticated account's identity is verified by API metadata; the push path itself is **NOT_TESTED** until an authorized branch exists. No token was recorded.

## Authorized initial base and designated Shopify names

The user explicitly authorized a minimal first `main` commit. A three-line README was the only file in commit `38a711ad46aec63b8f410519f30352a88e4113c7`. It was pushed without force and without a global Git configuration change:

```sh
git -c user.name='Codex PF-001R' -c user.email='codex-pf001r@localhost' commit -m 'docs: initialize Insignia rewrite base'
GIT_TERMINAL_PROMPT=0 git -c credential.https://github.com.helper='!gh auth git-credential' push --set-upstream origin main
gh repo view Optidigi/insignia --json defaultBranchRef,isEmpty,viewerPermission --jq '{defaultBranchRef,isEmpty,viewerPermission}'
gh api repos/Optidigi/insignia/branches/main --jq '{name,sha:.commit.sha,protected}'
GIT_TERMINAL_PROMPT=0 git ls-remote --symref origin HEAD
```

Commit and push exited 0. GitHub and Git both returned `38a711ad46aec63b8f410519f30352a88e4113c7` for `main`; `defaultBranchRef.name` became `main`, `isEmpty` became false and `protected` was false. This verifies the actual base and push path, not PR publication or independent review enforcement. The user remains merge operator; no protection was altered.

The user designated Shopify app name `insignia` and the `insignia-staging` development store. The following read-only CLI probes did not authenticate or mutate a store:

```sh
SHOPIFY_CLI_NO_ANALYTICS=1 /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify store auth list --json
CI=1 SHOPIFY_CLI_NO_ANALYTICS=1 timeout 25s /home/serveradmin/insignia-pf001-tools/shopify/node_modules/.bin/shopify organization list --json
```

The store auth list exited 0 with `sessions: []`; the organization list exited 1 and said credentials are required in a noninteractive environment. App ID, exact store domain, distribution, plan and development privileges remain unverified. No store domain was inferred from the display name, no login was initiated, and no resource setting was changed.

## Final repository path instruction and skill repeat

After copying only the intended tracked docs/config/evidence from neutral source commit `768a2023676e11ce08340686115a513cf17cad60` to the approved clone's local docs branch, the installed Codex CLI was probed from `/home/serveradmin/insignia-rewrite-20260924`. `codex debug prompt-input` included root AGENTS as a user instruction with the PF-001R authorization pointer, and listed four project skills: writing-for-agents, tdd, code-review and diagnosing-bugs. The handoff skill remains user-invoked by its upstream frontmatter. `codex doctor --json` still reported provider `openai`, model `<default>`, no feature override and active-thread overrides uninspected; `codex features list` still showed `multi_agent=true`. Thus project config loading and effective sol-6-high are not verified in the approved clone.

The required fresh restricted-session read was repeated from the approved clone with this command:

```sh
codex exec --ephemeral --json -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false' 'Read AGENTS.md, docs/architecture/decision-ledger.md, docs/delivery/prompts/PF-001R-remediation.md, and .agents/skills/writing-for-agents/SKILL.md from disk. Give file and line references for current authorization and two locked decisions. Do not edit or call external services.'
```

Conversation session `01a0d4e2-8eba-76c1-9afc-a65ac2faea10` exited 0 but its shell read failed before opening any file with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. It gave no invented line references and reported no edits or external calls. The fresh-session file/skill read remains **FAILED** in the final repository location; an unrestricted local reviewer cannot be substituted for this check.
