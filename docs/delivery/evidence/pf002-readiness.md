# PF-002 readiness evidence

24 September 2026 UTC. Scope: PF-002 only. M0-001 and G1–G8 remain unauthorized/NOT_RUN.

| Outcome | Observation and evidence | Remaining action | Owner | Earliest affected slice |
|---|---|---|---|---|
| Restricted execution and model | **VERIFIED** for explicit `gpt-6-sol`/`high` CLI launches after distro `bubblewrap` installation: app-server config resolution, fresh file/skill reads, scratch write/test and policy canary denials below. | Use the recorded explicit flags until project config trust/loading is separately resolved; repeat a fixed-ref review for each later PR. | Local orchestrator; host maintainer only if sandbox regresses. | M0-001 execution and local review. |
| Native Rust and Wasm | **VERIFIED** using pinned Rust 1.98.1, local Zig 0.16.0 linker, `cargo test`, executed build script/proc macro and generic Wasm compile. | Supply the explicit linker environment for later host builds; normal `cc` remains absent. | Local orchestrator; host maintainer only if a system default compiler is desired. | M0-001 host harness. |
| Existing Shopify app | **CLI APP/CLIENT ID VERIFIED; DASHBOARD BINDING OWNER-ATTESTED** at resource `427859050497`: OAuth client ID `942e6668fd1177524c0fc48b104b0ac3`. CLI says **NO_EXISTING_INSTALL** on staging; requested scopes are empty. Distribution remains **UNVERIFIED**: the owner reports no Distribution section. | Obtain a supported distribution-status read or narrow owner evidence if available. A later separately authorized setup slice may set required scopes and install; PF-002 does neither. | App owner for distribution status; future authorized implementer for setup. | M0-001 setup and non-Plus interpretation. |

## Predecessor and repository

- Principal external verdict: `PR-001-principal-review.md` supplied by the user, SHA-256 `23a00cb5a46b25744b9419c7357ce3de0ae302a44f1f4346dfc05a1719210e90`. APPROVED for documentation/configuration bootstrap only at `Optidigi/insignia` PR #1, base/effective merge base `38a711ad46aec63b8f410519f30352a88e4113c7`, head `722afb3990468b7963407f9c6706127974d7a8fd`. Native GitHub approve and comment both returned HTTP 403, so no native review was posted. User/maintainer retains merge authority.
- PR #1 was OPEN and unmerged at the start of PF-002. Its reviewed head was unchanged. The user then explicitly delegated authority to merge that exact PR. Immediately before merge, GitHub reported target `main`, base `38a711ad46aec63b8f410519f30352a88e4113c7`, head `722afb3990468b7963407f9c6706127974d7a8fd`, and `MERGEABLE`; remote `main` and head refs matched. `gh pr merge 1 --repo Optidigi/insignia --merge --match-head-commit 722afb3990468b7963407f9c6706127974d7a8fd` exited 0 with no bypass or branch deletion. GitHub reports PR state `MERGED`, merged by `shimmy-aga` at `2026-09-24T20:18:39Z`, merge commit `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb`. Freshly fetched remote `main` is that commit, whose two parents are exactly the approved base and reviewed head. PF-002 branch `docs/pf-002-readiness-closure` was created from that fetched remote commit. This is a normal merge of the externally approved change; no native approval was fabricated.
- GitHub read identified `Optidigi/insignia` as rewrite and `Optidigi/insignia-legacy` as storefront visual reference. The original architecture plan and ledger retain SHA-256 `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d` and `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`.

## 1. Restricted execution and model configuration

- Installed `codex-cli 0.156.1`, provider `openai`. Current project `.codex/config.toml` requests `model="gpt-6-sol"`, `model_reasoning_effort="high"`, `[features] multi_agent=false`. Plain `codex doctor --json` from the rewrite clone reported model `<default>` and no feature override, so loading of that project layer is NOT_VERIFIED. The user config has trust entry for `/home/serveradmin`; its effect on this nested clone is not established. No trust/global config was changed.
- Explicit one-off launch overrides were resolved by `codex -c 'model="gpt-6-sol"' -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false' doctor --json`: model `gpt-6-sol`, provider `openai`, `multi_agent=false`. A same-CWD app-server `config/read` under `--strict-config` resolved model `gpt-6-sol` and effort `high`; both origins were `sessionFlags`. Without overrides, `config/read` returned neither value, corroborating that the project config is not currently loaded. A fresh `codex exec --ephemeral --json -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false'` with a no-tool `READY` prompt returned `READY`, exit 0, no reported fallback. This first probe isolated model launch from the then-broken sandbox; it was not treated as a file-read pass.
- After sandbox repair, one **same-process** app-server probe started with `--strict-config` and explicit `model="gpt-6-sol"`, `model_reasoning_effort="high"`, `approval_policy="never"`, `features.multi_agent=false`, `features.apps=false`, `features.plugins=false`. In that process, `config/read` returned `gpt-6-sol`/`high`; `thread/start` returned model `gpt-6-sol`, `reasoningEffort="high"`, sandbox `readOnly` with `networkAccess=false`, and approval `never`. A fresh run after reviewer feedback asserted those exact values, successful command read events with nonempty output for AGENTS, the active PF-002 prompt and the selected skill, `turn/completed`, line citations in the final response, and no surfaced fallback/failure event metadata. It exited 0 for thread `01a0d52d-6041-7350-9ed5-0eae035f6f75`; the response cited AGENTS.md:7, PF-002:12 and writing-for-agents SKILL.md:78. Provider-internal routing remains unexposed. The full nonsecret [probe driver](#same-launch-app-server-probe) below reproduces the config-read/thread-start/turn-start sequence. Provider-internal routing was not exposed or required.
- Before host remediation, `codex sandbox -P :read-only -- /bin/true` and `codex sandbox -P :workspace -C /home/serveradmin/insignia-pf002-agent-scratch -- /bin/true` each exited 1 before command execution with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. `/usr/bin/bwrap` was absent; `unshare --user --map-root-user /bin/true` failed writing `/proc/self/uid_map` with `Operation not permitted`. Userns clone and max namespaces sysctls allowed namespaces numerically, while AppArmor restricted unprivileged userns. `/etc/apparmor.d/bwrap-userns-restrict` exists and names `/usr/bin/bwrap`.
- The user reported installing Ubuntu's distribution package. Read-only inspection found `/usr/bin/bwrap`, `bubblewrap 0.11.1`, package `0.11.1-1ubuntu0.3`. The same direct `:read-only` and `:workspace` `/bin/true` probes then exited 0. No AppArmor/userns policy was relaxed and this agent changed no global configuration.
- Direct canaries used files owned by `serveradmin`, mode 664 and host-writable. In `:read-only`, an append to `/home/serveradmin/insignia-pf002-agent-scratch/reviewer-canary.txt` exited 2, `Read-only file system`; SHA-256 stayed `1d82110d3f8a257eb1b8d64d2409a62814323fc8c6f78b3701d764b28f08b84c`. In `:workspace` rooted at the scratch directory, writing `writer-ok.txt` succeeded, while appending to `/home/serveradmin/outside-writer-canary.txt` exited 2 with the same filesystem denial and unchanged SHA-256. The positive write and negative write tested different policy zones; neither denial was a Unix ownership error.
- A fresh `codex exec --ephemeral --json --strict-config -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'approval_policy="never"' -c 'features.multi_agent=false' -c 'features.apps=false' -c 'features.plugins=false'` session from the PF-002 branch read root AGENTS, the ledger, active PF-002 prompt, state/operating model and pinned writing-for-agents skill from disk. It cited active authorization at `docs/delivery/prompts/PF-002-readiness-closure.md:12`, locked stack/domain decision at `docs/architecture/decision-ledger.md:10`, retention decision at `:24`, and the selected skill's single-source-of-truth rule at `.agents/skills/writing-for-agents/SKILL.md:78`. Its canary append returned `Read-only file system`; the file stayed unchanged. This is a successful enforced fresh sequential reviewer path, with local shell sandbox enforcement and no mutation-capable apps/plugins or configured MCP servers in that invocation.
- A separate fresh `codex exec --ephemeral --json --strict-config -s workspace-write --add-dir /home/serveradmin/insignia-pf002-agent-scratch` session used the same explicit model/effort/approval/feature overrides from the rewrite repository. It read AGENTS and PF-002 from disk, cited authorization, created `writer-proof.txt` in the designated scratch root, and passed an exact-content shell assertion. Its outside-root append returned `Read-only file system`; the outside file hash and repository status were unchanged. An independent host read confirmed the proof bytes were exactly `PF002_WRITER_OK` plus newline. This demonstrates a bounded writer route for harmless scratch work, not app implementation readiness or connector sandboxing.
- Official Codex guidance: https://learn.chatgpt.com/docs/sandboxing and https://learn.chatgpt.com/docs/config-file/config-basic . The former recommends distribution `bubblewrap` on Linux and a loaded profile where required; it does not prove the package alone will fix this host. The latter makes CLI overrides highest precedence and loads project config only for trusted projects.
- **Current result:** restricted writer/reviewer execution, live instruction/skill reads and client model/effort acceptance are VERIFIED for these explicit launch routes. Native parallel agents remain disabled. A final fixed-ref local review of the PF-002 commit is recorded after committing; shell isolation does not by itself restrict separately credentialed network/MCP tools.

The repeatable shell boundary probes, from the rewrite clone, were:

```sh
codex sandbox -P :read-only -C /home/serveradmin/insignia-rewrite-20260924 -- /bin/true
codex sandbox -P :workspace -C /home/serveradmin/insignia-pf002-agent-scratch -- /bin/true
codex sandbox -P :read-only -C /home/serveradmin/insignia-rewrite-20260924 -- /bin/sh -c 'printf "UNEXPECTED\n" >> /home/serveradmin/insignia-pf002-agent-scratch/reviewer-canary.txt'
codex sandbox -P :workspace -C /home/serveradmin/insignia-pf002-agent-scratch -- /bin/sh -c 'printf "WRITER_OK\n" > /home/serveradmin/insignia-pf002-agent-scratch/writer-ok.txt'
codex sandbox -P :workspace -C /home/serveradmin/insignia-pf002-agent-scratch -- /bin/sh -c 'printf "UNEXPECTED\n" >> /home/serveradmin/outside-writer-canary.txt'
```

The fresh CLI routes used the same explicit model/effort and disabled mutation-capable apps/plugins. The reviewer invocation was `codex exec --ephemeral --json --strict-config -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'approval_policy="never"' -c 'features.multi_agent=false' -c 'features.apps=false' -c 'features.plugins=false'` with a prompt naming the four required files, line citations, and one canary append. The writer invocation replaced `-s read-only` with `-s workspace-write --add-dir /home/serveradmin/insignia-pf002-agent-scratch` and requested an exact scratch write/test plus an outside-root append. Both ran from `/home/serveradmin/insignia-rewrite-20260924` and exited 0 as conversations; the deliberately denied tool actions exited nonzero and left their targets unchanged. The effective model/effort read used `codex app-server --stdio --strict-config` with the same three model/effort/multi-agent overrides and JSON-RPC `initialize`, `initialized`, then `config/read` for that CWD; `config/read` returned `model="gpt-6-sol"`, `model_reasoning_effort="high"` and `sessionFlags` origins.

## 2. Native Rust linker/test/build-script/procedural-macro

- Pinned isolated Rust 1.98.1 and wasm32 target from PF-001R reused, with `CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo` and `RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup`.
- Disposable dependency-free Cargo workspace: `/home/serveradmin/insignia-pf002-rust-smoke`, containing a `pf002_macro` proc macro returning `42_u32`, and a `pf002_consumer` with `build.rs` setting `pf002_build_script` plus one unit test asserting both the cfg and macro result. No app source or repository configuration was created.
- Default `cargo test --workspace --offline` failed `linker cc not found`. Bundled `rust-lld` without a host driver linked an executable lacking `_start`; its build script crashed SIGSEGV. These failures were not counted as passes.
- Installed official Zig 0.16.0 **only** under `/home/serveradmin/insignia-pf002-tools/zig`, with archive URL `https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz`, SHA-256 `70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00` matching the official download index. `zig cc --version` returned Clang 21.1.0, target `x86_64-unknown-linux7.0.0-gnu2.43.0`. No global package/profile changed; Rust version unchanged.
- Scratch wrapper `cc-zig` contains `#!/bin/sh` and `exec /home/serveradmin/insignia-pf002-tools/zig/zig-x86_64-linux-0.16.0/zig cc "$@"`. `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/home/serveradmin/insignia-pf002-rust-smoke/cc-zig` with the isolated Rust env and a fresh target directory made `cargo test --workspace --offline` exit 0: one test passed, host `build.rs` executed, and the proc macro `.so` was built/loaded. `file` identified the build script as an x86-64 ELF executable and proc macro as an x86-64 ELF shared object. This validates the chosen explicit linker route; a default `cargo test` still fails until a host `cc` is installed or project launch passes this linker setting.
- Repeated `rustc --edition 2024 --target wasm32-unknown-unknown --crate-type cdylib /tmp/insignia-pf001r-rust/smoke.rs -o /home/serveradmin/insignia-pf002-rust-smoke/smoke.wasm` with the isolated Rust env: exit 0, WebAssembly MVP, SHA-256 `106d831c24abac91747a75b38e97285c182caf9ffea3f490bfe36143e08dc93f`. This generic artifact is not a Shopify Function or gate pass.

## 3. Existing Shopify app and access

- Pinned Shopify CLI 4.8.2 and account login reused. `shopify app config link --path /home/serveradmin/insignia-pf002-shopify-import` ran in an empty mode-700 scratch directory; interactive selections were organization `My Store` ID `212732011`, **No, connect it to an existing app**, and exact app `insignia`. Exit 0; the only scratch file was `shopify.app.toml`. No app scaffold, creation, installation, deploy or remote configuration change occurred.
- Imported config and authenticated `shopify app info --path ... --json` agree: app name `insignia`, organization ID `212732011`, OAuth client ID `942e6668fd1177524c0fc48b104b0ac3`. The imported TOML SHA-256 is `3937ccfd707a4a59717b0ecea779740937cb9ccfd56bb4ba2b7c228628411845`; the TOML remains outside Git. The interactive list showed one `insignia` choice in this organization. Dashboard numeric resource `427859050497` is not the OAuth client ID; the URL came from the user and the CLI did not return that numeric resource. The owner explicitly confirmed that Settings → Credentials at `https://dev.shopify.com/dashboard/212732011/apps/427859050497` shows the same Client ID. The CLI independently proves the named app/client ID association; the exact numeric Dashboard binding is owner-attested, not independently read by this agent. No secret was requested or recorded.
- Imported requested scopes are empty (`scopes=""`, `optional_scopes=[]`), and no extensions are listed. The config has an example application URL. These are configuration observations, not distribution or install evidence.
- Read-only `shopify app execute --path /home/serveradmin/insignia-pf002-shopify-import --store insignia-staging.myshopify.com --query 'query PF002ReadShop { shop { id myshopifyDomain } }'` exited 1: `App is not installed on insignia-staging.myshopify.com`. No Admin API response, installation, or scope grant occurred. Direct `store auth list --json` previously showed no sessions. Classify `NO_EXISTING_INSTALL / SETUP_REQUIRED`; a later separately authorized slice must establish app configuration/scopes and install before its store-facing proof.
- `shopify app versions list --path ... --json` was a read-only call and returned two version records, one active and one inactive. This shows app version metadata only, not installation or distribution.
- The imported config and `app info` do not expose distribution. The user reports **no Distribution section** on this app's Dev Dashboard Home; this does not itself distinguish Public, Custom or Unselected. Distribution remains **UNVERIFIED pending a supported read-only status route or narrow owner evidence**. Do not infer a mode from store plan, app version, UI absence or TOML shape. Shopify documents a Distribution card in the Dev Dashboard at https://shopify.dev/docs/apps/launch/distribution/select-distribution-method ; the observed user UI differs, and no setting was changed.

## Fixed-ref local review status

A fresh Codex `-s read-only` reviewer with explicit `gpt-6-sol`/`high`, disabled apps/plugins and the pinned code-review skill examined base `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb` against first PF-002 commit `d41ce6dde2fe6d2ce33b8fb3c8391d39fd51ff3b`. It found no scope or apparent secret issue, but identified two evidence gaps: the lack of a same-launch resolved model/effort record, and the unverified Dashboard numeric app binding/distribution. The same-process `config/read` → `thread/start` → restricted `turn/start` probe above closes the former. The owner subsequently compared the nonsecret Client ID at the exact Dashboard URL, closing the identity gap at owner-attested scope; distribution remains unknown. The first reviewer's attempted parallel child launch failed locally; it continued its own sequential sandboxed read-only review. A second sequential read-only review of base `bd4b0c12dc6d6c38e155ec6a1ce40fc215b4d6bb` and head `1c26e8d5c0de2b5c26e4d848d5454e5514d61f20` identified that the probe could exit 0 without checking successful disk-read events or surfaced fallback. The executed driver below now asserts completed command read events with exit 0 and nonempty output for all three files, turn completion, line citations and no surfaced fallback/failure metadata. Neither reviewer reran external Shopify, GitHub or Rust probes. Final current-head review belongs in PR metadata/external handoff to avoid self-referential commits.

## Reused evidence and boundaries

PF-001/PF-001R Git, Node/TypeScript, pnpm, developer MCP schema, browser, generic Wasm, Shopify CLI and staging-store identity checks were reused only at their recorded scope. PostgreSQL is not required for the minimal fixed-input DB-free M0-001; R2 and billing are later prerequisites. No production access, app/store mutation, billing action, deployment, repository protection change or M0/G1–G8 work occurred.

## Reproducible native smoke sources and commands

`Cargo.toml`:

```toml
[workspace]
members = ["consumer", "pf002_macro"]
resolver = "2"
```

`pf002_macro/Cargo.toml`:

```toml
[package]
name = "pf002_macro"
version = "0.1.0"
edition = "2024"

[lib]
proc-macro = true
```

`pf002_macro/src/lib.rs`:

```rust
use proc_macro::TokenStream;

#[proc_macro]
pub fn answer(_input: TokenStream) -> TokenStream {
    "42_u32".parse().expect("literal parses")
}
```

`consumer/Cargo.toml`:

```toml
[package]
name = "pf002_consumer"
version = "0.1.0"
edition = "2024"

[dependencies]
pf002_macro = { path = "../pf002_macro" }
```

`consumer/build.rs`:

```rust
fn main() {
    println!("cargo:rustc-cfg=pf002_build_script");
    println!("cargo:rustc-check-cfg=cfg(pf002_build_script)");
}
```

`consumer/src/lib.rs`:

```rust
pub fn answer() -> u32 { pf002_macro::answer!() }

#[cfg(test)]
mod tests {
    #[test]
    fn build_script_and_macro_work() {
        assert!(cfg!(pf002_build_script));
        assert_eq!(super::answer(), 42);
    }
}
```

`cc-zig`:

```sh
#!/bin/sh
exec /home/serveradmin/insignia-pf002-tools/zig/zig-x86_64-linux-0.16.0/zig cc "$@"
```

Run from `/home/serveradmin/insignia-pf002-rust-smoke` after verifying the pinned Zig archive:

```sh
CARGO_HOME=/home/serveradmin/insignia-pf001-tools/rust/cargo \
RUSTUP_HOME=/home/serveradmin/insignia-pf001-tools/rust/rustup \
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/home/serveradmin/insignia-pf002-rust-smoke/cc-zig \
CARGO_TARGET_DIR=/home/serveradmin/insignia-pf002-rust-smoke/target-cargo-linker \
/home/serveradmin/insignia-pf001-tools/rust/cargo/bin/cargo test --workspace --offline
```

Result: exit 0; one consumer unit test passed, both host build script and proc macro executed. The wrapper is scratch-only. The pinned Zig archive checksum is recorded above; it has not been added to the repository.

## Same-launch app-server probe

Executed with `python3 /home/serveradmin/insignia-pf002-draft/appserver_same_launch_probe.py` (exit 0 after the completion and response assertions). This is the exact nonsecret driver used above:

```python
import json
import queue
import re
import subprocess
import threading
import time

cwd = '/home/serveradmin/insignia-rewrite-20260924'
cmd = [
    'codex', 'app-server', '--stdio', '--strict-config',
    '-c', 'model="gpt-6-sol"',
    '-c', 'model_reasoning_effort="high"',
    '-c', 'approval_policy="never"',
    '-c', 'features.multi_agent=false',
    '-c', 'features.apps=false',
    '-c', 'features.plugins=false',
]
proc = subprocess.Popen(
    cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL, text=True, bufsize=1,
)
all_events = []
lines = queue.Queue()

def read_stdout():
    for line in proc.stdout:
        lines.put(line)
    lines.put(None)

threading.Thread(target=read_stdout, daemon=True).start()

def send(value):
    proc.stdin.write(json.dumps(value) + '\n')
    proc.stdin.flush()

def receive_until(request_id=None, methods=(), timeout=15):
    end = time.monotonic() + timeout
    events = []
    while time.monotonic() < end:
        try:
            line = lines.get(timeout=max(0, end - time.monotonic()))
        except queue.Empty:
            break
        if line is None:
            raise EOFError('app-server stdout closed')
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        all_events.append(value)
        events.append(value)
        if request_id is not None and value.get('id') == request_id:
            return value, events
        if value.get('method') in methods:
            return value, events
    raise TimeoutError(f'No response for id={request_id} methods={methods}')

try:
    send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'pf002-same-launch-probe', 'version': '1'}}})
    init, _ = receive_until(1)
    assert 'result' in init, init.get('error')
    send({'method': 'initialized', 'params': {}})
    send({'id': 2, 'method': 'config/read', 'params': {'cwd': cwd, 'includeLayers': False}})
    config, _ = receive_until(2)
    assert 'result' in config, config.get('error')
    resolved = config['result']['config']
    assert resolved.get('model') == 'gpt-6-sol', resolved.get('model')
    assert resolved.get('model_reasoning_effort') == 'high', resolved.get('model_reasoning_effort')
    send({'id': 3, 'method': 'thread/start', 'params': {'cwd': cwd, 'sandbox': 'read-only', 'approvalPolicy': 'never', 'ephemeral': True}})
    started, _ = receive_until(3)
    assert 'result' in started, started.get('error')
    thread = started['result']
    assert thread.get('model') == 'gpt-6-sol', thread.get('model')
    assert thread.get('reasoningEffort') == 'high', thread.get('reasoningEffort')
    assert thread.get('approvalPolicy') == 'never', thread.get('approvalPolicy')
    assert thread.get('sandbox', {}).get('type') == 'readOnly', thread.get('sandbox')
    thread_id = thread['thread']['id']
    print('config', {'model': resolved.get('model'), 'effort': resolved.get('model_reasoning_effort')})
    print('thread_start', {'model': thread.get('model'), 'effort': thread.get('reasoningEffort'), 'sandbox': thread.get('sandbox'), 'approval': thread.get('approvalPolicy'), 'thread_id': thread_id})
    prompt = 'Read AGENTS.md, docs/delivery/prompts/PF-002-readiness-closure.md, and .agents/skills/writing-for-agents/SKILL.md from disk. Cite file:line for current authorization and one skill rule. Do not edit files or call external services.'
    send({'id': 4, 'method': 'turn/start', 'params': {'threadId': thread_id, 'input': [{'type': 'text', 'text': prompt}]}})
    turn, _ = receive_until(4, timeout=15)
    assert 'result' in turn, turn.get('error')
    deadline = time.monotonic() + 180
    methods = []
    final = None
    while time.monotonic() < deadline:
        event, _ = receive_until(methods=('turn/completed', 'turn/failed', 'item/completed', 'codex/event/agent_message'), timeout=max(1, deadline - time.monotonic()))
        method = event.get('method')
        methods.append(method)
        if method == 'item/completed':
            item = event.get('params', {}).get('item', {})
            if item.get('type') == 'agentMessage':
                final = item.get('text')
        if method in ('turn/completed', 'turn/failed'):
            break
    print('turn_event', methods[-1] if methods else None, 'event_methods_seen', sorted(set(methods)))
    print('agent_message', final[:1800] if final else None)
    command_items = [e.get('params', {}).get('item', {}) for e in all_events if e.get('method') == 'item/completed' and e.get('params', {}).get('item', {}).get('type') == 'commandExecution']
    required = ('AGENTS.md', 'docs/delivery/prompts/PF-002-readiness-closure.md', '.agents/skills/writing-for-agents/SKILL.md')
    read_results = {}
    for path in required:
        matches = [item for item in command_items if any(action.get('type') == 'read' and action.get('path') == cwd + '/' + path for action in item.get('commandActions', []))]
        assert matches, f'No completed disk read for {path}'
        assert any(item.get('status') == 'completed' and item.get('exitCode') == 0 and item.get('aggregatedOutput') for item in matches), f'Read failed or empty for {path}'
        read_results[path] = len(matches)
    print('completed_disk_reads', read_results)
    assert methods and methods[-1] == 'turn/completed', methods
    assert final and 'AGENTS.md:7' in final and 'PF-002-readiness-closure.md:12' in final and re.search(r'SKILL\.md:\d+', final), final
    surfaced_failures = [event for event in all_events if 'fallback' in str(event.get('method', '')).lower() or 'fallback' in str(event.get('error', '')).lower() or 'fallback' in str(event.get('params', {}).get('reason', '')).lower()]
    assert not surfaced_failures, 'Fallback reported in event metadata'
    assert not any(event.get('method') == 'turn/failed' for event in all_events), 'Turn failed'
finally:
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
```
