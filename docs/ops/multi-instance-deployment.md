# Multi-Instance Deployment — Ops Runbook

This document covers running a second (or Nth) hosted Insignia app instance on the same VPS.
The public production instance is called **public**; additional instances are called **custom**.
Adjust domain names, usernames, and credentials throughout.

---

## 1. Architecture overview

### Why one image works for all instances

The Docker image is domain-agnostic:

- Vite builds assets with **relative paths** (`/assets/xyz.js`), not absolute (`https://domain/assets/xyz.js`).
- `root.tsx` injects `<base href="https://your-app-domain.com/">` as the **first element in `<head>`**,
  before `<Links />` and `<Scripts />`, derived at runtime from `X-Forwarded-Proto` + `Host` headers
  that Nginx Proxy Manager forwards.
- The browser resolves `/assets/xyz.js` → `https://your-app-domain.com/assets/xyz.js` via the `<base>` tag. ✓
- CORS in `server.mjs` allows any `.myshopify.com` origin — the storefront that loads the modal. ✓
- `SHOPIFY_APP_URL` is still a required **runtime** env var (used by `shopify.server.ts` for OAuth
  callbacks and by `server.mjs` for CORS), but it is no longer baked into the built image.

### Isolation model

| Concern | Isolated? | How |
|---------|-----------|-----|
| Shopify credentials | ✓ | Separate Partner Dashboard app record, separate `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` |
| App URL / domain | ✓ | Separate DNS record, NPM proxy host, `SHOPIFY_APP_URL` runtime env |
| Database | ✓ | Separate Postgres container, volume path, `DATABASE_URL` |
| R2 storage | ✓ (recommended) | Separate bucket, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` |
| Docker containers | ✓ | Different container names (`insignia-custom-app`, `insignia-custom-postgres`) |
| Compose project | ✓ | Different project name (`insignia-custom`) prevents name collisions |
| Cron | ✓ | Separate cron entries pointing at separate URL + separate `CRON_SECRET` |
| Docker image | Shared | Same `ghcr.io/optidigi/insignia-app:latest` (domain-agnostic) |
| Code / theme extension | Shared | Same codebase, same theme extension deployment |

### App proxy subpath

Both instances use `subpath = "insignia"` (→ `myshopify.com/apps/insignia/*`). This is safe because:

- Public app and custom app target **different merchants** — same-store installation is not supported.
- Changing the subpath would require updating the Liquid block and all `proxyUrl("/apps/insignia/…")`
  calls in the storefront components.
- **Known limitation:** If a store installs BOTH the public and custom apps simultaneously, the
  last-registered App Proxy wins. Do not support that scenario — it is not tested.

---

## 2. Pre-requisites

Before starting:

- [ ] VPS already running the public Insignia instance (in `/srv/saas/infra/stacks/insignia/`)
- [ ] Nginx Proxy Manager running and reachable (port 81)
- [ ] `proxy` Docker network exists: `docker network ls | grep proxy`
- [ ] DNS access for the new domain
- [ ] Shopify Partner account

---

## 3. Step 1 — Create the Shopify app in Partner Dashboard

1. Go to [partners.shopify.com](https://partners.shopify.com) → **Apps** → **Create app**.
2. Choose **"Create app manually"**.
3. Name it (e.g. "Insignia Custom") — shown on the OAuth consent screen.
4. After creation, go to **App setup**:
   - **App URL**: `https://insignia-custom.optidigi.nl` (your custom domain)
   - **Allowed redirection URL(s)**: `https://insignia-custom.optidigi.nl/auth/callback`
5. Go to **App setup** → **App Proxy**:
   - **Subpath prefix**: `apps`
   - **Subpath**: `insignia`
   - **Proxy URL**: `https://insignia-custom.optidigi.nl/apps/insignia`
6. Go to **App setup** → **Webhooks** → add:
   - `app/uninstalled` → `https://insignia-custom.optidigi.nl/webhooks/app/uninstalled`
   - Privacy compliance webhook URLs → same domain pattern
7. Copy the **API key** (`SHOPIFY_API_KEY`) and **API secret key** (`SHOPIFY_API_SECRET`) for later.
8. Set **Distribution** to "Custom" (App setup → Distribution).

To register the full config via CLI (recommended — registers scopes, webhooks, App Proxy URL):

```bash
# Fill in client_id in shopify.app.insignia-custom.toml first, then:
shopify app deploy --config insignia-custom
```

> **Admin deep link note:** `merchant-notifications.server.ts` builds a Shopify admin deep link as
> `https://admin.shopify.com/store/{store}/apps/insignia`. The URL path uses the Shopify app handle,
> which defaults to the slugified app name. If your custom app's handle differs from `insignia`,
> update the deep link in `app/lib/services/merchant-notifications.server.ts`.

---

## 4. Step 2 — DNS

Add a DNS record for the custom app domain. **Must be DNS-only (grey cloud in Cloudflare)** —
Cloudflare proxy breaks Shopify App Proxy HMAC validation.

| Type | Name | Content | Proxy status |
|------|------|---------|-------------|
| AAAA | insignia-custom | `<your VPS IPv6>` | **DNS only** |
| A | insignia-custom | `<your VPS IPv4>` | **DNS only** |

Find your VPS IPs:

```bash
# On VPS:
curl -6 ifconfig.me   # IPv6
curl -4 ifconfig.me   # IPv4
```

---

## 5. Step 3 — Cloudflare R2 bucket (recommended: separate bucket)

Using a separate bucket gives independent cost tracking, CORS policy, and backup schedule.

1. Cloudflare Dashboard → **R2** → **Create bucket** → name it `insignia-custom-assets`.
2. Set up a **Custom Domain** for public asset serving (or use the `r2.dev` subdomain).
3. Configure **CORS** (bucket → Settings → CORS):

```json
[
  {
    "AllowedOrigins": [
      "https://insignia-custom.optidigi.nl",
      "https://*.myshopify.com",
      "https://*.shopify.com"
    ],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Create an **R2 API Token** (R2 → Manage R2 API Tokens → Create API token):
   - Permissions: Object Read & Write
   - Bucket: select your new bucket
   - Copy `Access Key ID` and `Secret Access Key`.

---

## 6. Step 4 — VPS: create stack folder and config files

```bash
# On VPS:

# 1. Create directories
sudo mkdir -p /srv/data/saas/insignia-custom/postgres
sudo mkdir -p /srv/saas/infra/stacks/insignia-custom
sudo chown -R serveradmin:serveradmin \
    /srv/data/saas/insignia-custom \
    /srv/saas/infra/stacks/insignia-custom

# 2. Copy compose file (from repo)
cp deploy/compose.custom.example.yaml \
    /srv/saas/infra/stacks/insignia-custom/compose.yaml

# 3. Copy env template and fill in secrets
cp deploy/.env.custom.example \
    /srv/saas/infra/stacks/insignia-custom/.env
chmod 600 /srv/saas/infra/stacks/insignia-custom/.env
nano /srv/saas/infra/stacks/insignia-custom/.env   # fill in all values
```

Minimum values to fill in:

```
SHOPIFY_API_KEY=<from Partner Dashboard>
SHOPIFY_API_SECRET=<from Partner Dashboard>
SHOPIFY_APP_URL=https://insignia-custom.optidigi.nl
DATABASE_URL=postgresql://insignia_custom:YOUR_STRONG_PW@db:5432/insignia_custom
POSTGRES_USER=insignia_custom
POSTGRES_PASSWORD=YOUR_STRONG_PW   # must match DATABASE_URL exactly
POSTGRES_DB=insignia_custom
R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<from R2 API token>
R2_SECRET_ACCESS_KEY=<from R2 API token>
R2_BUCKET_NAME=insignia-custom-assets
R2_PUBLIC_URL=https://assets-custom.optidigi.nl
CRON_SECRET=<openssl rand -hex 32>
APP_VERSION=latest
```

---

## 7. Step 5 — Pull image and start stack

```bash
cd /srv/saas/infra/stacks/insignia-custom

# Pull the image
docker compose pull

# First start — Prisma migrations run automatically (docker-start → prisma migrate deploy)
docker compose up -d

# Watch logs until the server is up
docker compose logs -f app
```

Expected startup line:

```
[react-router-serve] http://localhost:3000 (http://0.0.0.0:3000)
```

Healthcheck (should show `healthy` after ~60 s):

```bash
docker compose ps
```

---

## 8. Step 6 — Nginx Proxy Manager

In NPM admin (port 81) → **Proxy Hosts** → **Add Proxy Host**:

| Field | Value |
|-------|-------|
| Domain Names | `insignia-custom.optidigi.nl` |
| Forward Hostname | `insignia-custom-app` ← exact Docker container name |
| Forward Port | `3000` |
| Websockets Support | ✓ |
| SSL | Let's Encrypt, Force SSL, HTTP/2 |

**Advanced tab** (Custom Nginx Configuration):

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Real-IP         $remote_addr;
```

Verify after saving:

```bash
curl -I https://insignia-custom.optidigi.nl/api/health
# Expected: HTTP/2 200
```

---

## 9. Step 7 — Install the app on a store

For custom/private apps, send the install URL to the merchant:

```
https://admin.shopify.com/oauth/install?client_id=<SHOPIFY_API_KEY>
```

Or use Partner Dashboard → Apps → [your custom app] → "Select stores".

---

## 10. Step 8 — Set up cron on the VPS

Read the secret from the env file to avoid copy-paste errors:

```bash
CRON_SECRET_CUSTOM=$(grep ^CRON_SECRET /srv/saas/infra/stacks/insignia-custom/.env | cut -d= -f2)
```

Test endpoints before enabling cron:

```bash
curl -v -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-slots \
  -H "Authorization: Bearer $CRON_SECRET_CUSTOM"
# Expected: {"freedSlots":0,"expiredConfigs":0,"timestamp":"2026-..."}

curl -v -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-drafts \
  -H "Authorization: Bearer $CRON_SECRET_CUSTOM"
# Expected: {"deletedDrafts":0,"deletedUploadSessions":0,"timestamp":"2026-..."}
```

Add to crontab (`crontab -e`) — substitute the actual secret value:

```cron
# Insignia CUSTOM app cleanup cron jobs
*/5 * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer PASTE_CRON_SECRET_HERE" | logger -t insignia-custom-cron

0   * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer PASTE_CRON_SECRET_HERE" | logger -t insignia-custom-cron
```

View logs:

```bash
journalctl -t insignia-custom-cron -n 50
```

---

## 11. Deploying a new version

Both instances update from the same image:

```bash
# Public instance
cd /srv/saas/infra/stacks/insignia
sed -i 's/APP_VERSION=.*/APP_VERSION=v1.x.x/' .env
docker compose pull && docker compose up -d

# Custom instance
cd /srv/saas/infra/stacks/insignia-custom
sed -i 's/APP_VERSION=.*/APP_VERSION=v1.x.x/' .env
docker compose pull && docker compose up -d
```

Each instance runs `prisma migrate deploy` on startup automatically.

To canary-test on the custom instance first:

```bash
cd /srv/saas/infra/stacks/insignia-custom
sed -i 's/APP_VERSION=.*/APP_VERSION=v1.x.x/' .env
docker compose pull && docker compose up -d
docker compose logs -f app
# Verify healthy, then update the public instance
```

To hold an instance at an older version, pin `APP_VERSION=v1.x.x` in its `.env` and do not run
`docker compose pull` for it.

---

## 12. Backup and recovery

### Database backup

```bash
docker exec insignia-custom-postgres \
  pg_dump -U insignia_custom insignia_custom \
  > /srv/data/backups/insignia-custom-$(date +%Y%m%d).sql
```

### Restore

```bash
# Stop app to avoid writes during restore
docker compose -f /srv/saas/infra/stacks/insignia-custom/compose.yaml stop app
docker exec -i insignia-custom-postgres \
  psql -U insignia_custom insignia_custom \
  < /srv/data/backups/insignia-custom-YYYYMMDD.sql
docker compose -f /srv/saas/infra/stacks/insignia-custom/compose.yaml start app
```

---

## 13. Known limitations

1. **Same-store App Proxy conflict:** If a merchant installs BOTH the public app and the custom app,
   both register `apps/insignia` as their App Proxy subpath. Only one proxy can be active per
   prefix+subpath per store — last install wins. Do not support both apps on the same store.

2. **Shared release cycle:** Both instances upgrade together when you run `docker compose pull`.
   To hold the custom instance at an older version, pin `APP_VERSION` in its `.env`.

3. **Admin email deep link:** `app/lib/services/merchant-notifications.server.ts` builds a Shopify
   admin deep link using the app handle `insignia`. If your custom app's Partner Dashboard handle
   differs, update that file's deep link URL.

4. **Theme extension is shared:** Both instances deploy the same `customize-button.liquid` block.
   There is no per-instance theme extension variant.

5. **Rate limiter is in-process:** `server.mjs` uses `express-rate-limit` with in-process memory.
   Limits are independent per container — each instance has its own state.

---

## 14. Environment variable reference

| Variable | Required | Notes |
|----------|----------|-------|
| `SHOPIFY_API_KEY` | ✓ | From Partner Dashboard — **different per instance** |
| `SHOPIFY_API_SECRET` | ✓ | From Partner Dashboard — **different per instance** |
| `SCOPES` | ✓ | Must match `shopify.app.*.toml` `[access_scopes]` exactly |
| `SHOPIFY_APP_URL` | ✓ | Full HTTPS URL of this instance — **different per instance** |
| `DATABASE_URL` | ✓ | Points to this stack's `db` service — **different per instance** |
| `POSTGRES_USER` | ✓ | Must match `DATABASE_URL` username |
| `POSTGRES_PASSWORD` | ✓ | Must match `DATABASE_URL` password |
| `POSTGRES_DB` | ✓ | Must match `DATABASE_URL` database name |
| `R2_ACCOUNT_ID` | ✓ | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | ✓ | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | ✓ | R2 API token secret |
| `R2_BUCKET_NAME` | ✓ | Recommend **different bucket per instance** |
| `R2_PUBLIC_URL` | ✓ | Public CDN URL for the bucket |
| `CRON_SECRET` | ✓ | Random hex secret for cron auth — **different per instance** |
| `APP_VERSION` | ✓ | Docker image tag (`latest` or `v1.x.x`) |
| `SENTRY_DSN` | optional | Leave empty to disable Sentry |
| `RESEND_API_KEY` | optional | Leave empty to disable email notifications |
| `SHOP_CUSTOM_DOMAIN` | optional | For shops on custom Shopify domains |
