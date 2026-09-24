# PF-001 local probe record

All commands ran 24 September 2026 in a neutral local workspace or disposable `/tmp` path. Exit status is reported only for the invoked check; no application gate ran.

| Probe | Invocation | Observed result |
|---|---|---|
| Transfer integrity | `sha256sum -c MANIFEST.sha256` before edits | Exit 0; 16 supplied records OK. |
| Workspace | `git -C /home/serveradmin rev-parse --show-toplevel`; `find /home/serveradmin -maxdepth 3 -type d -name .git` | Git returned 128, not a repository; find returned no local `.git` at that depth. |
| Git scratch worktree | `git init`; empty commit; `git worktree add/list/remove` under `/tmp/insignia-pf001-git-probe` | Exit 0; worktree listed at `/tmp/insignia-pf001-git-worktree` then removed. |
| GitHub CLI | `gh auth status` | Exit 1; no logged-in GitHub host. Connected GitHub app separately returned login `Optidigi-AK` and candidate metadata/READMEs. |
| Host diagnostics | `codex --version`; `codex doctor --json`; `codex debug models --bundled`; `codex debug prompt-input` | CLI 0.156.1; provider `openai`; no local MCP servers; `gpt-6-sol` catalog entry supports `high`. Prompt input included root AGENTS and four model-invoked project skills. |
| Fresh read-only CLI | `codex exec --ephemeral --skip-git-repo-check -m gpt-6-sol -c 'model_reasoning_effort="high"' -s read-only …` | Invocation accepted; two attempts could not read files because `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. Effective wire model/effort not emitted. |
| Child smoke | Read-only task to locate active slice and two locked rules | Returned `docs/delivery/state.md:11` and ledger `:8,:26`, with no edits. Child runtime reported `danger-full-access`, `never`; model/effort not exposed. |
| Node | `node --version`; temporary JavaScript assertion | v24.21.0; assertion passed. |
| pnpm | `corepack pnpm --version`; `corepack pnpm --dir /tmp/insignia-pf001-toolchain run smoke` | 12.6.0; disposable script printed `pnpm smoke ok`, exit 0. |
| TypeScript | Existing `/home/serveradmin/component-catalog/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2024 /tmp/insignia-pf001-toolchain/smoke.ts` | TypeScript 7.0.2; exit 0. No rewrite package scripts exist. |
| Rust/Wasm | `cargo --version`, `rustc --version`, `rustfmt --version`, `cargo clippy --version`, `rustup target list --installed` | Executables not found; no compilation. |
| Shopify developer MCP | Pinned `@shopify/dev-mcp@1.15.4` stdio client: `listTools`, `learn_shopify_api(functions,2026-07)`, `search_docs_chunks`, `validate_graphql_codeblocks` | Docs result included `https://shopify.dev/docs/api/functions/2026-07/cart-transform`. Valid `query Input { cart { lines { id quantity } } }` returned VALID. Invalid `query Input { cart { definitelyInvalidPf001Field } }` returned INVALID: `Cannot query field "definitelyInvalidPf001Field" on type "Cart"`. No store call. |
| Shopify authenticated | `shopify version`; relevant non-secret environment variable names and local `shopify.app*.toml` search | CLI not found; no designated local app/store configuration. |
| Browser | `node /tmp/insignia-pf001-browser.cjs` then `LD_LIBRARY_PATH=/home/serveradmin/component-catalog/.pw-libs node /tmp/insignia-pf001-browser.cjs` | First launch failed loading `libatk-1.0.so.0`. Retry exit 0; Chromium 153.0.8010.12; `observed: clicked`, `consoleMessages: ["clicked"]`; [screenshot](pf001-browser.png). |
| PostgreSQL | `psql --version`; dedicated database context search | `psql` not found; no designated DB/credentials. |
| Current hashes | `sha256sum -c docs/delivery/evidence/pf001-current-sha256.txt` | Exit 0 for listed current files. This list is generated after operational edits and is separate from the original transfer manifest. |

The original transfer archive remains at `/home/serveradmin/.t3/userdata/attachments/81292d0a-995f-4c06-8ce7-7d7cd419bc4a-ba802f63-f705-4c8a-ab8e-357ff8327bbc-zip.zip`. Probe scripts and package installs under `/tmp` were disposable; this Markdown records the observed outputs without secrets or buyer data.
