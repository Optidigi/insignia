# Insignia — Developer Setup Guide

## Prerequisites

- Node.js 20+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) (`npm install -g @shopify/cli`)
- PostgreSQL 14+ (or Docker)
- A [Shopify Partner account](https://partners.shopify.com) with an app registered
- Cloudflare R2 bucket (for image storage)

---

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment Variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|----------|-----------------|
| `SHOPIFY_API_KEY` | Shopify Partner Dashboard → App → Client credentials |
| `SHOPIFY_API_SECRET` | Same as above |
| `DATABASE_URL` | PostgreSQL connection string (default works with Docker below) |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 → Manage R2 API tokens |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API token |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token |
| `R2_BUCKET_NAME` | Your R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for your R2 bucket |

`SHOPIFY_APP_URL` is auto-populated by the Shopify CLI dev server — leave it blank.

## 3. Start PostgreSQL

If you don't have PostgreSQL running locally, use Docker:

```bash
docker-compose up -d
```

## 4. Run Database Migrations

```bash
npx prisma migrate deploy
```

## 5. Link to Your Shopify App

The `shopify.app.toml` is pre-configured. If you're connecting to a **new** Shopify app (not the original), run:

```bash
shopify app config link
```

Follow the prompts to select your Partner org and app.

## 6. Launch the Dev Server

```bash
npm run dev
```

The CLI will:
- Start the React Router dev server on port 3000
- Create a cloudflared tunnel (public HTTPS URL)
- Open the Shopify admin to install the app

Press `P` to open the app URL. On first load, Shopify OAuth installs the app.

### Cloudflared Conflict Warning

If you have a `~/.cloudflared/config.yml` from another project (e.g. a named Cloudflare Tunnel), it will hijack the Shopify quick tunnel and return 404s. Fix:

```bash
mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak
# Restore after: mv ~/.cloudflared/config.yml.bak ~/.cloudflared/config.yml
```

---

## Key Commands

```bash
npm run dev          # Dev server (tunnel + theme extension)
npm run build        # Production build
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npx prisma migrate dev --name <name>  # Create a new DB migration
```

---

## Project Structure

```
app/
  routes/          # app.* = admin, apps.insignia.* = storefront proxy
  components/      # storefront/ = customer modal components
  lib/services/    # Backend services (*.server.ts)
extensions/
  insignia-theme/  # Theme app extension (blocks only, NO templates dir)
prisma/
  schema.prisma    # Database schema (13 models)
docs/
  AGENT_ENTRY.md   # Start here for codebase navigation
  core/            # Canonical specs (read before touching related code)
```

See `CLAUDE.md` for full architectural context and mandatory development rules.

---

## AI-Assisted Development

This project is configured for Claude Code:
- `.mcp.json` — MCP servers (Shopify Dev API, Playwright, etc.)
- `CLAUDE.md` — Codebase rules and conventions for the AI assistant
- `docs/superpowers/plans/` — Implementation plans for pending features

Open the project in Claude Code (`claude`) and it will load all context automatically.

---

## Storage (Cloudflare R2)

The app uses Cloudflare R2 (S3-compatible) for logo assets and view images.

| Variable | Value |
|----------|-------|
| `R2_ACCOUNT_ID` | Your Cloudflare account ID (found in R2 dashboard URL) |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret key |
| `R2_BUCKET_NAME` | Your R2 bucket name (e.g. `insignia-assets`) |
| `R2_PUBLIC_URL` | Optional: public URL for your bucket (e.g. `https://assets.yourdomain.com`) |

The R2 endpoint is automatically constructed as `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

**CORS not required**: The app uses server-side uploads — the Node server receives files from the browser and uploads to R2 directly. No CORS configuration is needed on the R2 bucket for the storefront upload flow.

---

## Production Deployment

The app is deployed as a Docker container behind a reverse proxy.

### Environment

- `SHOPIFY_APP_URL` must be set to your public HTTPS domain (e.g. `https://insignia.yourdomain.com`)
- This URL must also be configured in the Shopify Partner Dashboard:
  - **App URL**: `https://insignia.yourdomain.com`
  - **Allowed redirection URLs**: `https://insignia.yourdomain.com/auth/callback`, `https://insignia.yourdomain.com/auth/shopify/callback`, `https://insignia.yourdomain.com/api/auth/callback`

### Docker deployment

```bash
# Build and start all services (app + PostgreSQL)
docker compose up -d

# Run database migrations
docker compose exec app npx prisma migrate deploy
```

The `app` service in `docker-compose.yml` reads all environment variables from `.env` via `env_file`. Never commit `.env` to source control.

### Reverse proxy (nginx or Caddy)

The app runs on port 3000 internally. Configure your reverse proxy to:
- Terminate TLS on port 443
- Forward to `localhost:3000`
- Pass `X-Forwarded-Proto: https` header (required by Shopify's OAuth flow)

Example Caddyfile:
```
insignia.yourdomain.com {
  reverse_proxy localhost:3000
}
```
