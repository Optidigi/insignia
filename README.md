# Insignia

Insignia lets Shopify merchants sell customized products. Merchants configure artwork placements,
decoration methods, and prices in Shopify admin. Buyers upload artwork and review a quote in the
storefront Designer. Shopify Functions apply the signed price to the cart and validate it at checkout.

The app uses TypeScript, Astro, and Preact. PostgreSQL stores application data, pg-boss runs
background jobs, and Rust implements the Shopify Functions.

## Where the code lives

```text
apps/
  web/          Embedded merchant app and buyer API
  storefront/   Theme integration, Designer host, and cart operations
  worker/       Webhook processing, recovery, and background jobs
frontend/       Merchant UI, buyer Designer, and translations
extensions/     Shopify theme extension and Function entrypoints
crates/         Rust Functions and cart authorization
packages/       Pricing, application logic, and PostgreSQL and Shopify adapters
```

## Start locally

Use the Node version in [.node-version](.node-version) and Corepack with the pnpm version in
[package.json](package.json). The full checks also use the pinned [Rust toolchain](rust-toolchain.toml).

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm dev:admin
```

Open the URL printed by `dev:admin`. It serves the merchant app on loopback with read-only fixture
data. For the buyer Designer demo, run `corepack pnpm dev:ui:customer` and open `/scenarios` on the
printed URL. See the [frontend guide](frontend/README.md) for UI ownership and preview options.

## Quick commands

| Command | What it checks |
| --- | --- |
| `corepack pnpm build` | Build the workspace. Run this first before checks that consume compiled packages. |
| `corepack pnpm check:types` | Type-check the workspace projects. |
| `corepack pnpm test:unit` | Run the core package and worker tests. |
| `corepack pnpm test:browser` | Run the web and storefront suites. See the [browser setup](frontend/README.md#checks). |
| `corepack pnpm test:runtime` | Run the offline Shopify restore replay and runtime entry checks. |
| `corepack pnpm test:database:isolated` | Run migrations and tests on a disposable [PostgreSQL 18 fixture](packages/database/README.md). |
| `corepack pnpm check` | Run the full workspace checks, including Rust and browser coverage. |

## Project references

- [Specification](docs/architecture/implementation-plan.md) for app behavior and architecture
- [Current assignment](docs/delivery/state.md#active-assignment) for release status and open work
- [Shopify review checklist](docs/delivery/shopify-review-resubmission.md) for live review fixtures and evidence
- [Deployment runbook](deployment/m5-runtime/README.md) for production operation and recovery
- [Repository guidance](AGENTS.md) for engineering workflow and conventions
