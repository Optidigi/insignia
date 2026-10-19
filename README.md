# Insignia

Shopify product customization: a merchant App Home editor, separate buyer storefront, signed whole-quote authorization and independent checkout validation. The [current specification](docs/architecture/implementation-plan.md) defines Lean V1. [Current state](docs/delivery/state.md) distinguishes integrated source, deployed artifacts, known defects and owner-held production gates.

## Start locally

Use Node **24.21.0**, Corepack with **pnpm12.6.0** (`package.json`) and Rust **1.98.1** (`rust-toolchain.toml`). Rustfmt, Clippy and the `wasm32-unknown-unknown` target are declared by that file. Git, the platform linker toolchain (`cc` on Linux) and network access to the pinned package/tool registries are installation prerequisites; a normal local check needs no Shopify or production credentials.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm check:types
corepack pnpm test:unit
corepack pnpm check:boundaries
corepack pnpm check:secrets
```

Build first: package export boundaries and secret checks inspect actual compiled package/storefront output. `check:types` checks the effective strict compiler projects listed in `scripts/boundaries/source-policy.json`; `check:source` rejects unapproved languages, uncovered source, broken current links and obsolete command/config targets. Generated JavaScript is output, not a second maintained implementation.

## Preview merchant screens

After `corepack pnpm build`, run `corepack pnpm dev:admin`. It starts a loopback-only preview of actual SSR with explicit synthetic read-only fixtures, no production credentials and no provider effects. Use `INSIGNIA_PREVIEW_STATE=normal|empty|denied|unavailable|loading` to inspect supported controlled states. These fixtures are local UI evidence, not native authentication or write acceptance.

## Focused and integration checks

Use the relevant package's test command or a specific `node --test` file for iteration. `corepack pnpm check` is comprehensive local verification: style, builds, types, unit/runtime/operations, source/security boundaries, real Rust/Function vectors and browser behavior. It downloads verified pinned public Function tools when absent; no Shopify CLI/provider operation is part of this command.

Browser checks require Chromium: `corepack pnpm --filter @insignia/web exec playwright install chromium` (Linux may need Playwright's documented system libraries or `--with-deps`). `corepack pnpm test:browser` covers web/storefront behavior with explicit local doubles. Native merchant authentication and provider mutations require their actual separate grants; synthetic fixtures never establish native acceptance.

PostgreSQL qualification is separate. Install PostgreSQL18 server/client tools (`initdb`, `pg_ctl`, `createdb`, `psql`, `pg_dump`, `pg_restore`) and run `corepack pnpm test:database:isolated` as a non-root user. The [database adapter guide](packages/database/README.md) documents its owned temporary Unix-socket cluster, ambient-credential isolation, cleanup and focused commands. It migrates twice and runs database regression without selecting a native endpoint. Never point local tests at the deployed database. Runtime image/process checks additionally need a Docker daemon and their declared disposable artifact inputs; required CI preserves those boundaries.

## Find the current responsibility

- [AGENTS](AGENTS.md): engineering entry, contracts and scoped skills.
- [Current specification](docs/architecture/implementation-plan.md): complete Lean behavior, architecture, contracts, rationale and merchant source inventory.
- [Operating model](docs/delivery/operating-model.md): delivery conventions and effective resource permissions.
- [Current state and action checklist](docs/delivery/state.md): deployed components, next assignment, defects and exact owner/operator obligations.
- [Runtime/deployment procedure](deployment/m5-runtime/README.md): current image/Compose/recovery responsibilities and real resource gates.

Maintained tools live under responsibility-named `scripts/{boundaries,ci,database,functions,lifecycle,operations,privacy,release,runtime,worker}`. Project skills live in `.agents/skills`; select their project paths explicitly when the host also advertises generic account skills. A fresh session should confirm its intended checkout/base and project skill paths before editing. Preserve other dirty worktrees and actual service dependencies.

Merchant UI is **owner-unaccepted** and assigned to the fresh UI agent for presentation rebuild. Current component/runtime checks and earlier internal visual observations do not establish owner acceptance. The source inventory is in the specification; the action checklist owns the assignment.

Superseded development records remain in Git history. Necessary current effect/retention records and curated fixtures retain their explicit purpose; no historical prompt needs to be replayed to start work.
