# Insignia — Server Deployment

This folder contains the production server configuration files.

## Files

| File | Server path | Purpose |
|------|------------|---------|
| `compose.yaml` | `/srv/saas/infra/stacks/insignia/compose.yaml` | Docker Compose stack |
| `.env.example` | `/srv/saas/infra/stacks/insignia/.env` | Environment variables template |

## First-Time Setup (run on VPS over SSH)

```bash
# 1. Create directories
sudo mkdir -p /srv/data/saas/insignia/postgres
sudo mkdir -p /srv/saas/infra/stacks/insignia
sudo chown -R serveradmin:serveradmin /srv/data/saas/insignia /srv/saas/infra/stacks/insignia

# 2. Copy compose file
cp deploy/compose.yaml /srv/saas/infra/stacks/insignia/compose.yaml

# 3. Copy and fill in secrets
cp deploy/.env.example /srv/saas/infra/stacks/insignia/.env
chmod 600 /srv/saas/infra/stacks/insignia/.env
nano /srv/saas/infra/stacks/insignia/.env  # fill in all values

# 4. The proxy Docker network already exists on this server (used by Nginx Proxy Manager)
docker network ls | grep proxy  # should show: proxy

# 5. Pull and start
cd /srv/saas/infra/stacks/insignia
docker compose pull
docker compose up -d
docker compose logs -f app
```

## Deploying a New Version

```bash
cd /srv/saas/infra/stacks/insignia
# Update version (or edit .env directly)
sed -i 's/APP_VERSION=.*/APP_VERSION=v1.x.x/' .env
docker compose pull
docker compose up -d
docker compose logs -f app
```

## Nginx Proxy Manager Configuration

In NPM admin (port 81):
- **Domain**: `insignia.optidigi.nl`
- **Forward Hostname**: `insignia-app` (Docker container name on the `proxy` network)
- **Forward Port**: `3000`
- **Websockets Support**: yes
- **SSL**: Let's Encrypt, Force SSL, HTTP/2
- **Custom Nginx config** (Advanced tab):
  ```nginx
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Host  $host;
  proxy_set_header X-Real-IP         $remote_addr;
  ```

## Cloudflare DNS

---

## Running store-specific private app instances

See the full runbook at [`docs/ops/multi-instance-deployment.md`](../docs/ops/multi-instance-deployment.md).

Quick reference for active private instances:

| File | Purpose |
|------|---------|
| `deploy/compose.stitchs.example.yaml` | Stitchs compose template |
| `deploy/.env.stitchs.example` | Stitchs env template |
| `shopify.app.insignia-stitchs.toml` | Stitchs Shopify app config |
| `deploy/compose.superfunny.example.yaml` | SuperFunny compose template |
| `deploy/.env.superfunny.example` | SuperFunny env template |
| `shopify.app.insignia-superfunny.toml` | SuperFunny Shopify app config |

Key isolation points:
- Compose project name: `insignia-stitchs` or `insignia-superfunny`
- Container names: `<instance>-app`, `<instance>-postgres`
- Data path: `/srv/data/saas/<instance>/postgres`
- NPM forward hostname: `<instance>-app`
- All instances use the same Docker image (`ghcr.io/optidigi/insignia-app:latest`); `SHOPIFY_APP_URL` is runtime-only.

---
## Cloudflare DNS

For `insignia.optidigi.nl`, add an **AAAA record** (IPv6) in Cloudflare DNS:

| Type | Name | Content | Proxy status |
|------|------|---------|-------------|
| AAAA | insignia | `2a01:4f9:5a:13da::2` | **DNS only** (NOT proxied) |

The record MUST be DNS-only (grey cloud). Cloudflare proxy breaks Shopify App Proxy HMAC validation.

If your VPS also has an IPv4 address, add an A record too:
```bash
# Run on VPS to check for IPv4:
curl -4 ifconfig.me
```
