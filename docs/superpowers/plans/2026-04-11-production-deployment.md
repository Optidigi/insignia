# Insignia Production Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Insignia to `https://insignia.optidigi.nl` on a self-hosted Ubuntu 24.04 VPS using Docker Compose, Nginx Proxy Manager, Cloudflare R2, and GitHub Container Registry.

**Architecture:** Single-instance Docker Compose stack. NPM handles TLS via Let's Encrypt. App container image is built by GitHub Actions and pushed to GHCR. PostgreSQL runs as a sidecar container with data persisted at `/srv/data/prod/insignia/postgres`. NPM communicates with the app via a shared Docker network (no host port binding needed).

**Tech Stack:** Docker 29 + Compose v5, Ubuntu 24.04, GitHub Actions, GHCR (`ghcr.io`), Nginx Proxy Manager, Cloudflare R2 + DNS, Shopify CLI 3.x, Prisma 6, React Router 7

---

## ⚠️ App Store Prerequisites — Out of Scope for This Plan

Since this targets the Shopify App Store, these **must be completed before App Store submission** but are tracked separately:

1. **Order webhooks** (`orders/create`, `orders/paid`): Commented out in `shopify.app.toml`. Require [Shopify Protected Customer Data approval](https://shopify.dev/docs/apps/build/privacy-security/protected-customer-data) via Partner Dashboard → App → API access. Handlers are fully implemented — it's a toml change + `shopify app deploy` re-run after approval.

2. **GDPR data export**: `customers/data_request` webhook currently only logs (stub). App Store compliance requires sending the customer's data to the merchant. Needs a separate implementation plan.

---

## ⚠️ Cloudflare DNS Requirement

`insignia.optidigi.nl` DNS record **must be DNS-only (grey cloud ☁️)** in Cloudflare, **not proxied (orange cloud 🟠)**. If Cloudflare proxies the traffic it will break Shopify App Proxy HMAC signature validation, silently killing the storefront modal for all customers. NPM handles TLS with Let's Encrypt — Cloudflare's proxy is not needed for SSL.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile` | Modify | Multi-stage build, Prisma generate at build time, non-root user |
| `package.json` | Modify | Remove `prisma generate` from `docker-start` (moved to build stage) |
| `app/routes/api.health.tsx` | Create | `GET /health` resource route for Docker healthcheck + Uptime Kuma |
| `.github/workflows/docker-publish.yml` | Create | Build + push to GHCR on `main` push and version tags |
| `shopify.app.toml` | Modify | Link new Partner app, set production `application_url` + `redirect_urls` |
| `/srv/prod/infra/stacks/insignia/compose.yaml` | Create (server) | Production Docker Compose — app + db + shared proxy network |
| `/srv/prod/infra/stacks/insignia/.env` | Create (server) | Production secrets — never committed to git |

---

## Task 1: Dockerfile — Multi-Stage Build + Non-Root User

**Why:** Current Dockerfile installs only prod deps, then runs `npm run build` in the same layer. This works today (all build tooling is in `dependencies`, not `devDependencies`) but is fragile. Multi-stage separates build from runtime, reduces attack surface, adds a non-root user, and moves `prisma generate` to build time.

**Files:**
- Modify: `Dockerfile`
- Modify: `package.json` (scripts section only)

- [ ] **Step 1: Replace Dockerfile with multi-stage version**

```dockerfile
# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

# Install ALL deps (including devDeps) so build toolchain is available
RUN npm ci

COPY . .

# Build the React Router app
RUN npm run build

# Generate the Prisma client into node_modules (copied to runner)
RUN npx prisma generate

# Strip devDependencies from node_modules — leaves only runtime deps
RUN npm prune --omit=dev


# ─── Stage 2: Production Runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Create a non-root system user
RUN addgroup --system --gid 1001 appgroup && \
    adduser  --system --uid 1001 --ingroup appgroup appuser

# Copy only what the app needs at runtime
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/build       ./build
COPY --from=builder --chown=appuser:appgroup /app/public      ./public
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=builder --chown=appuser:appgroup /app/prisma      ./prisma

ENV NODE_ENV=production

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["npm", "run", "docker-start"]
```

- [ ] **Step 2: Update `docker-start` in `package.json` — remove `prisma generate` (already done at build time)**

Find this in `package.json` scripts:
```json
"setup": "prisma generate && prisma migrate deploy",
"docker-start": "npm run setup && npm run start",
```

Replace with:
```json
"setup": "prisma migrate deploy",
"docker-start": "npm run setup && npm run start",
```

- [ ] **Step 3: Verify the build succeeds locally**

```bash
docker build -t insignia-test:local .
```

Expected: build completes, two stages visible in output (`builder` → `runner`), final image created. No errors.

- [ ] **Step 4: Confirm non-root user and image size**

```bash
docker run --rm insignia-test:local whoami
docker images insignia-test:local
```

Expected output for `whoami`: `appuser`
Expected image size: ~400–600 MB (significantly smaller than single-stage which included all devDeps)

- [ ] **Step 5: Run typecheck and lint to confirm no regressions**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors (pre-existing warnings are acceptable)

- [ ] **Step 6: Commit**

```bash
git add Dockerfile package.json
git commit -m "build: multi-stage Dockerfile with non-root user and build-time Prisma generate"
```

---

## Task 2: Health Check Endpoint

**Why:** Docker's `HEALTHCHECK` directive (added in Task 1) calls `GET /health`. The endpoint also powers the Uptime Kuma monitor. It checks DB connectivity so container orchestration knows if the app is truly healthy, not just running.

**Files:**
- Create: `app/routes/api.health.tsx`

- [ ] **Step 1: Create the health check route**

```typescript
// app/routes/api.health.tsx
//
// GET /health
//
// Resource route (no default export) — used by Docker HEALTHCHECK and Uptime Kuma.
// Returns 200 with { status: "ok" } when the app and database are reachable.
// Returns 503 with { status: "error" } if the DB ping fails.
// No authentication required — this is intentionally public.

import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  try {
    // Lightweight DB liveness check — no table scan
    await db.$queryRaw`SELECT 1`;

    return new Response(
      JSON.stringify({ status: "ok", db: "ok", timestamp: new Date().toISOString() }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[/health] DB ping failed:", error);
    return new Response(
      JSON.stringify({ status: "error", db: "unreachable", timestamp: new Date().toISOString() }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
```

- [ ] **Step 2: Verify the route loads correctly with typecheck**

```bash
npm run typecheck
```

Expected: 0 new errors

- [ ] **Step 3: Test the endpoint against the running dev server**

```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

Expected:
```json
{
  "status": "ok",
  "db": "ok",
  "timestamp": "2026-04-11T..."
}
```

- [ ] **Step 4: Commit**

```bash
git add app/routes/api.health.tsx
git commit -m "feat: add GET /health endpoint for Docker healthcheck and monitoring"
```

---

## Task 3: GitHub Actions — Build and Push to GHCR

**Why:** Automates image publication. On every push to `main`, GitHub builds the image and pushes `latest` + a SHA tag. On a version tag (`v*.*.*`), it also pushes the version tag. The server compose references the image tag to control what version is running.

**Files:**
- Create: `.github/workflows/docker-publish.yml`

**Prerequisites:** The GitHub repository must have `packages: write` permission for GHCR. This is automatic for `GITHUB_TOKEN` when the repo is owned by the org/user pushing to GHCR.

- [ ] **Step 1: Create the workflow file**

Replace `YOUR_GITHUB_ORG` with your actual GitHub organization or username (e.g. `optidigi`).

```yaml
# .github/workflows/docker-publish.yml
#
# Builds the Insignia Docker image and pushes it to GitHub Container Registry.
# Triggers:
#   - Push to main branch  → pushes :latest and :sha-{short_sha}
#   - Version tag (v*.*.*)  → pushes :v1.2.3, :1.2, :1, and :latest

name: Publish Docker Image

on:
  push:
    branches:
      - main
    tags:
      - "v*.*.*"

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: YOUR_GITHUB_ORG/insignia-app

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            # Push :latest on main branch
            type=raw,value=latest,enable={{is_default_branch}}
            # Push :sha-{short_sha} on main branch
            type=sha,prefix=sha-,enable={{is_default_branch}}
            # Push :v1.2.3, :1.2, :1 on version tags
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Commit and push — verify the workflow runs**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add GitHub Actions workflow to build and push Docker image to GHCR"
git push origin main
```

Then open `https://github.com/YOUR_GITHUB_ORG/insignia-app/actions` and confirm the workflow runs without errors.

Expected: workflow completes, image visible at `https://github.com/YOUR_GITHUB_ORG/insignia-app/pkgs/container/insignia-app`.

- [ ] **Step 3: Set the GHCR package visibility to public (or private)**

Navigate to `https://github.com/YOUR_GITHUB_ORG/insignia-app/pkgs/container/insignia-app` → Package settings → Change visibility.

- **Public**: Anyone can pull the image. Fine for open-source projects.
- **Private**: Only authenticated users/tokens can pull. For private repos, choose this and add a deploy token (see Task 5, Step 3).

---

## Task 4: shopify.app.toml — Link New Partner App + Production URLs

**Why:** The current `shopify.app.toml` has placeholder URLs (`shopify.dev/apps/default-app-home`) and a test `client_id`. Production requires a new app registered in the Shopify Partner Dashboard with the real domain.

**Files:**
- Modify: `shopify.app.toml`

**Prerequisites — do these BEFORE the code steps:**

- [ ] **Step 1: Create the production app in Shopify Partner Dashboard**

1. Go to [partners.shopify.com](https://partners.shopify.com) → Apps → Create app
2. Choose **Public app** (App Store distribution)
3. App name: `Insignia Print-on-Demand` (or your preferred name)
4. App URL: `https://insignia.optidigi.nl`
5. Allowed redirection URL(s): `https://insignia.optidigi.nl/api/auth`
6. After creation, note down:
   - **API key** (= `SHOPIFY_API_KEY`)
   - **API secret key** (= `SHOPIFY_API_SECRET`)

- [ ] **Step 2: Link the local project to the new Partner app**

Run this in the project root (dev machine):

```bash
npx shopify app config link
```

When prompted, select the new app you just created. This updates `shopify.app.toml` with the new `client_id`.

- [ ] **Step 3: Verify and complete shopify.app.toml**

After `config link`, the file should have the new `client_id`. Manually verify/update these fields:

```toml
client_id = "<new-client-id-from-partner-dashboard>"
name = "Insignia Print-on-Demand App"
application_url = "https://insignia.optidigi.nl"
embedded = true

[build]
automatically_update_urls_on_dev = true

[webhooks]
api_version = "2026-04"

  [webhooks.privacy_compliance]
  customer_deletion_url = "/webhooks/gdpr/customer-deletion"
  customer_data_request_url = "/webhooks/gdpr/data-request"
  shop_deletion_url = "/webhooks/gdpr/shop-deletion"

  [[webhooks.subscriptions]]
  topics = ["app/uninstalled"]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = ["app/scopes_update"]
  uri = "/webhooks/app/scopes_update"

  # orders/create and orders/paid intentionally omitted —
  # require Shopify Protected Customer Data approval before enabling.
  # See: https://shopify.dev/docs/apps/build/privacy-security/protected-customer-data

[access_scopes]
scopes = "write_products,read_products,read_orders,write_orders,write_app_proxy,write_publications,write_inventory"

[auth]
redirect_urls = ["https://insignia.optidigi.nl/api/auth"]

[app_proxy]
url = "https://insignia.optidigi.nl"
subpath = "insignia"
prefix = "apps"
```

- [ ] **Step 4: Update SCOPES in local .env to match toml**

```bash
# In your local .env, verify SCOPES matches exactly:
SCOPES=write_products,read_products,read_orders,write_orders,write_app_proxy,write_publications,write_inventory
SHOPIFY_APP_URL=https://insignia.optidigi.nl
```

- [ ] **Step 5: Commit the updated toml**

```bash
git add shopify.app.toml
git commit -m "config: link production Shopify Partner app and set insignia.optidigi.nl as app URL"
```

---

## Task 5: Server Infrastructure — Docker Network + Directories

**Why:** All services (NPM + app + db) communicate over a shared Docker network. Data directories are created before the stack starts so Docker doesn't create them as root-owned.

**Where:** All commands run over SSH on the VPS.

- [ ] **Step 1: SSH into the VPS**

```bash
ssh serveradmin@<vps-ip>
```

- [ ] **Step 2: Find your NPM container name and its network**

```bash
docker ps --format "table {{.Names}}\t{{.Networks}}" | grep -i proxy
docker network ls
```

Note the network name that NPM is connected to. Common names: `npm_default`, `proxy`, `nginx-proxy-manager_default`. You will use this name in Step 3.

- [ ] **Step 3: Create or reuse the shared proxy network**

If NPM is already on a network called (for example) `npm_default`, you can use that. Otherwise, create a new `proxy` network and connect NPM to it.

**Option A — NPM already on an existing network (use it):**
```bash
# Note the existing network name from Step 2 — use it in compose.yaml (Task 6)
echo "NPM network: <name-from-step-2>"
```

**Option B — Create a new shared network and connect NPM:**
```bash
docker network create proxy
# Get the exact NPM container name from Step 2, then:
docker network connect proxy <npm-container-name>
```

> Note: For NPM to persist across restarts on the `proxy` network, also add `proxy` to NPM's own `compose.yaml` under `networks:`. Otherwise, `docker compose up` for NPM will disconnect it from `proxy`. This is a one-time NPM compose change.

- [ ] **Step 4: Create data and stack directories**

```bash
sudo mkdir -p /srv/data/prod/insignia/postgres
sudo mkdir -p /srv/prod/infra/stacks/insignia
sudo chown -R serveradmin:serveradmin /srv/data/prod/insignia
sudo chown -R serveradmin:serveradmin /srv/prod/infra/stacks/insignia
```

- [ ] **Step 5: Verify directory structure**

```bash
ls -la /srv/data/prod/
ls -la /srv/prod/infra/stacks/
```

Expected:
```
/srv/data/prod/insignia/postgres/   (owned by serveradmin)
/srv/prod/infra/stacks/insignia/    (owned by serveradmin)
```

---

## Task 6: Server compose.yaml

**Why:** The server-side compose pulls the GHCR image by tag, mounts the DB volume, joins the proxy network, and waits for the DB healthcheck before starting the app.

**Where:** Create on the VPS at `/srv/prod/infra/stacks/insignia/compose.yaml`.

- [ ] **Step 1: Create the compose file on the server**

Replace `YOUR_GITHUB_ORG` with your GitHub org/username. Replace `PROXY_NETWORK_NAME` with the network name from Task 5 Step 2/3.

```yaml
# /srv/prod/infra/stacks/insignia/compose.yaml

name: insignia

services:

  app:
    image: ghcr.io/YOUR_GITHUB_ORG/insignia-app:${APP_VERSION:-latest}
    container_name: insignia-app
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    networks:
      - proxy       # shared with NPM — NPM forwards to insignia-app:3000
      - internal    # private db communication
    env_file: .env
    environment:
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  db:
    image: postgres:16-alpine
    container_name: insignia-postgres
    restart: unless-stopped
    networks:
      - internal    # NOT on proxy — db is never reachable from outside the stack
    volumes:
      - /srv/data/prod/insignia/postgres:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5

networks:
  proxy:
    external: true
    name: PROXY_NETWORK_NAME   # ← replace with actual name from Task 5
  internal:
    internal: true             # no external routing; db is invisible outside this stack
```

- [ ] **Step 2: Verify the compose file is valid**

```bash
cd /srv/prod/infra/stacks/insignia
docker compose config
```

Expected: prints the resolved config with no errors.

---

## Task 7: Server .env — Production Secrets

**Why:** All secrets live in `.env` on the server, never in the image or git. The compose references `.env` via `env_file`.

**Where:** Create on the VPS at `/srv/prod/infra/stacks/insignia/.env`.

- [ ] **Step 1: Create the .env file with production values**

```bash
nano /srv/prod/infra/stacks/insignia/.env
```

Paste and fill in all values:

```env
# ── Shopify ──────────────────────────────────────────────────────────────────
SHOPIFY_API_KEY=<from Partner Dashboard — new production app>
SHOPIFY_API_SECRET=<from Partner Dashboard — new production app>
SCOPES=write_products,read_products,read_orders,write_orders,write_app_proxy,write_publications,write_inventory
SHOPIFY_APP_URL=https://insignia.optidigi.nl

# ── Database (used by the app at runtime) ────────────────────────────────────
# "db" is the Docker service name — reachable by the app container on the internal network
DATABASE_URL=postgresql://insignia:<STRONG_PASSWORD>@db:5432/insignia

# ── Database (used by the db service itself to initialise) ───────────────────
POSTGRES_USER=insignia
POSTGRES_PASSWORD=<STRONG_PASSWORD>    # must match the password in DATABASE_URL above
POSTGRES_DB=insignia

# ── Cloudflare R2 ────────────────────────────────────────────────────────────
R2_ACCOUNT_ID=<from Cloudflare dashboard>
R2_ACCESS_KEY_ID=<R2 API token access key>
R2_SECRET_ACCESS_KEY=<R2 API token secret>
R2_BUCKET_NAME=insignia-assets
# Stable public URL for placeholder logos (set up in Task 8)
R2_PUBLIC_URL=https://assets.optidigi.nl

# ── Deployment ───────────────────────────────────────────────────────────────
APP_VERSION=latest    # update to e.g. "v1.0.0" when deploying a specific release

# ── Optional ─────────────────────────────────────────────────────────────────
# SHOP_CUSTOM_DOMAIN=
```

- [ ] **Step 2: Lock down file permissions**

```bash
chmod 600 /srv/prod/infra/stacks/insignia/.env
```

Expected: only `serveradmin` can read the file.

- [ ] **Step 3: Generate a strong password for POSTGRES_PASSWORD if you don't have one**

```bash
openssl rand -base64 32
```

Paste the output as both `POSTGRES_PASSWORD` and in `DATABASE_URL`.

---

## Task 8: Cloudflare — DNS + R2 Bucket + Asset Domain

**Where:** Cloudflare dashboard at [dash.cloudflare.com](https://dash.cloudflare.com).

### Part A — DNS record for the app (grey cloud — mandatory)

- [ ] **Step 1: Create an A record for `insignia.optidigi.nl`**

In Cloudflare DNS for `optidigi.nl`:

| Type | Name | Content | Proxy status |
|------|------|---------|-------------|
| A | insignia | `<VPS public IP>` | **DNS only** (grey cloud) ☁️ |

⚠️ **Do NOT enable the orange cloud proxy** for this record. See the top of this plan for why.

### Part B — R2 bucket creation

- [ ] **Step 2: Create the R2 bucket**

1. Cloudflare dashboard → R2 Object Storage → Create bucket
2. Bucket name: `insignia-assets`
3. Location: choose closest to your VPS (or auto)
4. Leave all other settings as default

- [ ] **Step 3: Create an R2 API token**

1. Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API token
2. Permissions: **Object Read & Write**
3. Specify bucket: `insignia-assets`
4. Note down:
   - Account ID (visible in R2 overview, top-right)
   - Access Key ID
   - Secret Access Key

Fill these into the `.env` on the server (Task 7).

### Part C — Public domain for assets (placeholder logos need a stable URL)

- [ ] **Step 4: Enable a custom domain for the R2 bucket**

1. Cloudflare R2 → `insignia-assets` → Settings → Custom Domains → Connect Domain
2. Enter: `assets.optidigi.nl`
3. Cloudflare automatically creates a CNAME and SSL cert. This domain **can** be orange-cloud proxied — it's just serving static assets, not Shopify App Proxy traffic.

This gives you `R2_PUBLIC_URL=https://assets.optidigi.nl` for placeholder logos.

- [ ] **Step 5: Verify R2 credentials work from the server**

```bash
# Install AWS CLI temporarily for testing (or use curl with SigV4)
docker run --rm -e AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID> \
  -e AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY> \
  amazon/aws-cli s3 ls \
  s3://insignia-assets/ \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  --region auto
```

Expected: empty listing (new bucket) with no auth errors.

---

## Task 9: Nginx Proxy Manager — Proxy Host

**Why:** NPM routes `insignia.optidigi.nl` → `insignia-app:3000` on the shared Docker network, and obtains a Let's Encrypt certificate.

**Where:** NPM admin UI, typically at `http://<vps-ip>:81`.

- [ ] **Step 1: Verify the DNS record resolves before creating the proxy host**

```bash
# Run on VPS
curl -s https://dns.google/resolve?name=insignia.optidigi.nl&type=A | python3 -m json.tool
```

Expected: the answer contains your VPS public IP. If not, wait for DNS propagation (usually < 5 min for Cloudflare DNS-only).

- [ ] **Step 2: Create the proxy host in NPM**

1. NPM admin → Proxy Hosts → Add Proxy Host
2. **Domain Names**: `insignia.optidigi.nl`
3. **Scheme**: `http`
4. **Forward Hostname / IP**: `insignia-app` (the Docker container name — reachable via the shared proxy network)
5. **Forward Port**: `3000`
6. **Websockets Support**: ✅ Enable (App Bridge uses websockets)
7. **Block Common Exploits**: ✅ Enable

- [ ] **Step 3: Configure SSL on the proxy host**

1. SSL tab → Request a new SSL certificate
2. ✅ Force SSL
3. ✅ HTTP/2 Support
4. Email for Let's Encrypt notifications: `<your email>`
5. ✅ I Agree to Terms

- [ ] **Step 4: Add the required `X-Forwarded-Proto` header**

Shopify OAuth requires the app to know it's being served over HTTPS. Without this header, the OAuth flow will redirect to `http://` and fail.

1. Advanced tab in the proxy host
2. Paste into the Custom Nginx Configuration box:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Real-IP         $remote_addr;
```

- [ ] **Step 5: Save and verify SSL is issued**

After saving, wait ~30 seconds for Let's Encrypt. The proxy host should show a green lock. Test:

```bash
curl -I https://insignia.optidigi.nl/health
```

Expected: `HTTP/2 200` (the app isn't running yet but NPM should respond, possibly with a 502 Bad Gateway until the app starts — that's fine at this stage).

---

## Task 10: First Deployment + Smoke Test

**Where:** VPS over SSH.

- [ ] **Step 1: If GHCR package is private, create a pull token**

On GitHub: Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → New token.
Scopes: `read:packages`. Copy the token.

On the VPS:
```bash
echo "<GITHUB_PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

(Skip this step if the GHCR package is public.)

- [ ] **Step 2: Pull the image and start the stack**

```bash
cd /srv/prod/infra/stacks/insignia
docker compose pull
docker compose up -d
```

- [ ] **Step 3: Watch the startup logs**

```bash
docker compose logs -f app
```

Expected sequence:
1. `Running migration: ` (Prisma applies any pending migrations)
2. `react-router-serve` starts
3. No errors

- [ ] **Step 4: Health check**

```bash
curl -s https://insignia.optidigi.nl/health | python3 -m json.tool
```

Expected:
```json
{
  "status": "ok",
  "db": "ok",
  "timestamp": "2026-04-11T..."
}
```

- [ ] **Step 5: Verify Docker healthcheck status**

```bash
docker inspect --format='{{.State.Health.Status}}' insignia-app
```

Expected: `healthy` (may show `starting` for the first 60 seconds).

---

## Task 11: shopify app deploy

**Why:** This command registers the app's webhooks, theme extension, app proxy, and scopes with Shopify. It reads `shopify.app.toml` and pushes the configuration to the Partner Dashboard. Must be run from the dev machine after the production URL is live.

**Where:** Dev machine (project root).

**Prerequisites:** The app must be reachable at `https://insignia.optidigi.nl` (Task 10 complete).

- [ ] **Step 1: Set production credentials in local .env for the deploy command**

The `shopify app deploy` command authenticates against the Partner Dashboard using the app's credentials. Your local `.env` should already have the production app's key/secret from Task 4.

```env
SHOPIFY_API_KEY=<production app key>
SHOPIFY_API_SECRET=<production app secret>
SHOPIFY_APP_URL=https://insignia.optidigi.nl
```

- [ ] **Step 2: Run the deploy**

```bash
npx shopify app deploy
```

When prompted:
- Select the production app
- Confirm the configuration push

Expected output:
- Webhooks registered: `app/uninstalled`, `app/scopes_update`, GDPR compliance URLs
- Theme extension deployed
- App proxy registered at `https://insignia.optidigi.nl/apps/insignia`

- [ ] **Step 3: Verify in Partner Dashboard**

Go to partners.shopify.com → Apps → Insignia → Configuration. Confirm:
- Application URL: `https://insignia.optidigi.nl`
- Redirect URLs: `https://insignia.optidigi.nl/api/auth`
- App proxy: URL `https://insignia.optidigi.nl`, subpath `insignia`, prefix `apps`
- Webhooks listed

- [ ] **Step 4: Install on a development store and test the full flow**

1. Partner Dashboard → Apps → Test on development store
2. Install the app
3. Create a decoration method + product config with one placement
4. Navigate to the product storefront
5. Click Customize
6. Verify modal loads and "Add to cart" completes successfully

---

## Task 12: Database Backup Integration

**Why:** The VPS already runs an automated backup for `dashboard-mysql-*` files. Insignia's PostgreSQL needs to be included in the same rotation.

**Where:** VPS — wherever the existing backup script lives (likely `/srv/ops/infra/scripts/`).

- [ ] **Step 1: Find the existing backup script**

```bash
ls /srv/ops/infra/scripts/
cat /srv/ops/infra/scripts/backup*.sh 2>/dev/null || cat /srv/ops/infra/scripts/*.sh 2>/dev/null | head -60
```

- [ ] **Step 2: Add PostgreSQL dump to the backup script**

Add the following command alongside the existing MySQL dump. The pattern mirrors `dashboard-mysql-YYYYMMDD.sql`:

```bash
# PostgreSQL dump for Insignia
docker exec insignia-postgres pg_dump \
  -U insignia \
  --clean \
  --if-exists \
  insignia \
  > /srv/backup/db/insignia-postgres-$(date +%Y%m%d).sql
```

`--clean --if-exists` adds `DROP TABLE IF EXISTS` statements before `CREATE TABLE`, making restores idempotent.

- [ ] **Step 3: Verify the dump works manually**

```bash
docker exec insignia-postgres pg_dump -U insignia --clean --if-exists insignia \
  > /srv/backup/db/insignia-postgres-test.sql && \
  echo "Dump OK: $(wc -l < /srv/backup/db/insignia-postgres-test.sql) lines" && \
  rm /srv/backup/db/insignia-postgres-test.sql
```

Expected: `Dump OK: N lines` where N > 0.

---

## Task 13: Uptime Kuma Monitor

**Why:** The VPS already runs Uptime Kuma (`/srv/data/ops/uptime-kuma`). A monitor for Insignia's `/health` endpoint gives you push notifications when the app goes down.

**Where:** Uptime Kuma UI.

- [ ] **Step 1: Add an HTTP(s) monitor**

1. Uptime Kuma → Add New Monitor
2. Monitor Type: `HTTP(s)`
3. Friendly Name: `Insignia App`
4. URL: `https://insignia.optidigi.nl/health`
5. Heartbeat Interval: `60` seconds
6. Retries: `3`
7. Accepted Status Codes: `200`

- [ ] **Step 2: Add a notification channel if not already configured**

Configure email/Slack/Telegram notifications under Uptime Kuma → Settings → Notifications, then assign to the Insignia monitor.

---

## Deployment Workflow Going Forward

After this plan is complete, the process for deploying a new version is:

```bash
# 1. On dev machine — tag a release
git tag v1.1.0
git push origin v1.1.0
# GitHub Actions builds and pushes ghcr.io/YOUR_ORG/insignia-app:v1.1.0

# 2. On VPS — update the version and restart
cd /srv/prod/infra/stacks/insignia
sed -i 's/APP_VERSION=.*/APP_VERSION=v1.1.0/' .env
docker compose pull
docker compose up -d
docker compose logs -f app   # watch for successful migration + startup
```

---

## App Store Checklist (Post-Deployment, Separate Work)

- [ ] Apply for Shopify Protected Customer Data access (required for `orders/create` + `orders/paid` webhooks)
- [ ] Once approved: uncomment webhook subscriptions in `shopify.app.toml`, run `shopify app deploy`
- [ ] Implement GDPR `customers/data_request` data export (separate implementation plan required)
- [ ] Create App Store listing: icon, screenshots, description, pricing model
- [ ] Submit for Shopify review
