# Insignia — Shopify Logo Customization App

Insignia is an embedded Shopify app that lets customers place their own logo on products at checkout. Merchants configure decoration methods (embroidery, print, etc.), product views, and placement zones in the admin dashboard. Customers upload artwork and position it via a storefront modal.

**Built by [Optidigi](https://optidigi.nl)**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Router 7 + React 18 |
| UI (admin) | Shopify Polaris v13 |
| Canvas | Konva.js (placement editor + storefront preview) |
| Backend | Node.js + Express (custom server) |
| Database | PostgreSQL via Prisma |
| Storage | Cloudflare R2 (S3-compatible) |
| Shopify | Admin GraphQL API 2026-04, App Proxy, Theme Extension |
| Deployment | Docker + GitHub Actions → VPS |

---

## Local Development

### Prerequisites

- Node.js ≥ 20.19
- PostgreSQL running locally (`localhost:5432`)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)

### Setup

```bash
npm install
npx prisma migrate dev    # create local DB + run migrations
```

Copy `.env.example` to `.env` and fill in your values (see `docs/backend/README.md` for the full list).

### Start dev server

```bash
# Against the demo Shopify app (safe — isolated from production)
shopify app dev --config insignia-demo

# Against the production Shopify app (use with care)
shopify app dev --config insignia
```

The CLI creates a Cloudflare tunnel and auto-updates the app URL on the dev store.

### Shopify app configs

| File | Purpose | Use with |
|---|---|---|
| `shopify.app.insignia.toml` | Production app | `--config insignia` |
| `shopify.app.insignia-demo.toml` | Demo app (local dev) | `--config insignia-demo` |

Corresponding env files: `.env` (prod) and `.env.demo` (demo, gitignored).

---

## Project Structure

```
app/
  routes/              # React Router routes
                       #   app.*          → admin dashboard
                       #   apps.insignia.* → storefront proxy (modal)
                       #   api.*          → internal REST API
  components/          # React components
                       #   storefront/    → modal UI (no Polaris)
  lib/
    services/          # Backend services (*.server.ts)
    storefront/        # Client-side storefront utilities
  shopify.server.ts    # Shopify app init + authenticate
  db.server.ts         # Prisma singleton

extensions/
  insignia-theme/      # Theme app extension (customize button block)

prisma/
  schema.prisma        # Database schema (18 models)

docs/                  # Full specs and contracts (start at docs/AGENT_ENTRY.md)
```

---

## Deployment

The app ships as a Docker image, built by GitHub Actions on every push to `main`.

```bash
# Build image locally
docker build -t insignia-shopify-app .

# Run with docker compose (includes Postgres)
docker compose up
```

### Production (VPS)

```bash
# On the VPS — pull latest image and restart
cd /srv/saas/infra/stacks/insignia
docker compose pull app && docker compose up -d app
```

### Deploy Shopify config (app URL, scopes, webhooks)

```bash
shopify app deploy --config insignia
```

Run this after changing `shopify.app.insignia.toml`.

---

## Key Commands

```bash
npm run dev           # Start dev server (via Shopify CLI)
npm run build         # Production build
npm run typecheck     # react-router typegen + tsc --noEmit
npm run lint          # ESLint
npm run setup         # prisma migrate deploy (used in Docker entrypoint)
npx prisma migrate dev --name <description>   # Create a new migration
npx prisma validate   # Validate schema
```

---

## Docs

Full specs and contracts live in `docs/`. Start at **[docs/AGENT_ENTRY.md](docs/AGENT_ENTRY.md)** for navigation.

Key documents:
- `docs/core/architecture.md` — system overview and trust boundaries
- `docs/core/api-contracts/` — admin, storefront, and webhook API contracts
- `docs/core/variant-pool/` — non-Plus pricing model (variant pool)
- `docs/admin/` — admin dashboard specs
- `docs/storefront/` — storefront modal specs

For AI-assisted development see **[CLAUDE.md](CLAUDE.md)**.

---

## Troubleshooting

**Modal stays on "Loading…"**
The storefront modal loads via App Proxy. Ensure `SHOPIFY_APP_URL` is set and the product has the Insignia Customize block added in the theme editor.

**"Config failed: 500" or "Query does not contain a signature value"**
Open the modal from the storefront (product page → Customize button), not by visiting the tunnel URL directly. The config endpoint requires a valid App Proxy signature.

**"admin.shopify.com refused to connect"**
Never navigate the embedded app iframe to `myshopify.com/admin/*` URLs — those pages have `X-Frame-Options: SAMEORIGIN`. Use `window.open(url, "_top")` instead (already implemented for the theme editor button).

**CORS errors on script files**
Vite dev server is configured with `server.cors: true`. Restart after any `vite.config.ts` changes. Always start via `shopify app dev`, not `npm run dev` directly.

**Prisma engine error on Windows ARM64**
```bash
PRISMA_CLIENT_ENGINE_TYPE=binary
```
