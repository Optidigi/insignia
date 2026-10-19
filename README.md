# Insignia

Shopify product customization with a merchant App Home editor, buyer storefront, signed whole-quote authorization and independent checkout validation. The current shipping scope is Lean V1; production rollout remains owner-held.

Start with [agent instructions](AGENTS.md), [implementation and acceptance](docs/architecture/implementation-plan.md), [decisions](docs/architecture/decision-ledger.md) and [delivery state](docs/delivery/state.md). The [operating model](docs/delivery/operating-model.md) governs implementation and integration; deployment and remaining resource gates are linked from current state.

Use the pinned Node, pnpm and Rust versions. Run `corepack pnpm install --frozen-lockfile`, `corepack pnpm build` and the relevant checks. `corepack pnpm check` is the integrated verification route; PostgreSQL, Function runner and browser prerequisites retain their explicit environment limits. `corepack pnpm check:types` compiles maintained projects, while `corepack pnpm check:source` rejects unapproved language/coverage drift. The explicit migration inventory is unfinished work, never a typing exemption or completion verdict.
