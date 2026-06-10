# Multi-Instance Deployment Runbook

Insignia runs multiple Shopify app records from one shared Docker image. Each active
store-specific app has its own Shopify credentials, domain, Postgres container, data
volume, R2 bucket, cron secret, and VPS compose stack.

## Active instances

| Instance | Shopify config | VPS stack | App URL | Container prefix |
|---|---|---|---|---|
| Public/base | `shopify.app.insignia.toml` | `/srv/saas/infra/stacks/insignia` | `https://insignia.optidigi.nl` | `insignia` |
| Stitchs | `shopify.app.insignia-stitchs.toml` | `/srv/saas/infra/stacks/insignia-stitchs` | `https://insignia-stitchs.optidigi.nl` | `insignia-stitchs` |
| SuperFunny | `shopify.app.insignia-superfunny.toml` | `/srv/saas/infra/stacks/insignia-superfunny` | `https://insignia-superfunny.optidigi.nl` | `insignia-superfunny` |

`insignia-demo` is for local Shopify CLI development only.

## Isolation model

| Concern | Isolation mechanism |
|---|---|
| Shopify app | Separate Partner Dashboard app record and API key/secret |
| Domain | Separate DNS record, Nginx Proxy Manager host, and `SHOPIFY_APP_URL` |
| Database | Separate Postgres container and `/srv/data/saas/<instance>/postgres` volume |
| Storage | Separate R2 bucket and public asset URL |
| Cron | Separate `CRON_SECRET`, URL, and logger tag |
| Image | Shared `ghcr.io/optidigi/insignia-app:<tag>` image |

The image is domain-agnostic. Runtime domain behavior comes from forwarded host
headers and `SHOPIFY_APP_URL`.

## App proxy path

All hosted instances intentionally use the same storefront proxy path:

```text
/apps/insignia/*
```

This keeps the shared theme app extension and storefront fetch paths unchanged. Do
not install two Insignia app records on the same Shopify store; the app proxy
prefix/subpath would conflict and the last registered proxy would win.

## Shopify app record

In Shopify Partner Dashboard:

1. Create or open the app record.
2. Set the app name to `Insignia Stitchs` or `Insignia SuperFunny`.
3. Set App URL to `https://insignia-stitchs.optidigi.nl` or `https://insignia-superfunny.optidigi.nl`.
4. Set Allowed redirection URL to `<app-url>/auth/callback`.
5. Set App Proxy prefix `apps`, subpath `insignia`, and proxy URL `<app-url>/apps/insignia`.
6. Set Distribution to custom/private.
7. Copy the API key and secret into the matching VPS `.env`.

Deploy TOML config after the app record exists:

```bash
shopify app deploy --config insignia-stitchs
shopify app deploy --config insignia-superfunny
```

For SuperFunny, replace `REPLACE_WITH_SUPERFUNNY_CLIENT_ID` in
`shopify.app.insignia-superfunny.toml` first.

## DNS

Add DNS-only records in Cloudflare. Do not proxy these records; Cloudflare proxying
can break Shopify App Proxy HMAC validation.

| Name | Target |
|---|---|
| `insignia-stitchs` | VPS IPv4/IPv6 |
| `insignia-superfunny` | VPS IPv4/IPv6 |

Check VPS addresses:

```bash
curl -6 ifconfig.me
curl -4 ifconfig.me
```

## VPS setup

For Stitchs:

```bash
sudo mkdir -p /srv/data/saas/insignia-stitchs/postgres
sudo mkdir -p /srv/saas/infra/stacks/insignia-stitchs
sudo chown -R serveradmin:serveradmin \
  /srv/data/saas/insignia-stitchs \
  /srv/saas/infra/stacks/insignia-stitchs

cp deploy/compose.stitchs.example.yaml /srv/saas/infra/stacks/insignia-stitchs/compose.yaml
cp deploy/.env.stitchs.example /srv/saas/infra/stacks/insignia-stitchs/.env
chmod 600 /srv/saas/infra/stacks/insignia-stitchs/.env
```

For SuperFunny:

```bash
sudo mkdir -p /srv/data/saas/insignia-superfunny/postgres
sudo mkdir -p /srv/saas/infra/stacks/insignia-superfunny
sudo chown -R serveradmin:serveradmin \
  /srv/data/saas/insignia-superfunny \
  /srv/saas/infra/stacks/insignia-superfunny

cp deploy/compose.superfunny.example.yaml /srv/saas/infra/stacks/insignia-superfunny/compose.yaml
cp deploy/.env.superfunny.example /srv/saas/infra/stacks/insignia-superfunny/.env
chmod 600 /srv/saas/infra/stacks/insignia-superfunny/.env
```

Fill every secret in `.env` before starting the stack.

Start or update an instance:

```bash
cd /srv/saas/infra/stacks/<instance>
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f app
```

## Nginx Proxy Manager

Create one proxy host per instance:

| Domain | Forward hostname | Forward port |
|---|---|---|
| `insignia-stitchs.optidigi.nl` | `insignia-stitchs-app` | `3000` |
| `insignia-superfunny.optidigi.nl` | `insignia-superfunny-app` | `3000` |

Enable WebSockets, Let's Encrypt SSL, Force SSL, and HTTP/2. Add this advanced
configuration:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Real-IP         $remote_addr;
```

Verify:

```bash
curl -I https://insignia-stitchs.optidigi.nl/api/health
curl -I https://insignia-superfunny.optidigi.nl/api/health
```

## Cron

Each active instance needs its own cron entries using its own `CRON_SECRET`.
See `docs/ops/cron-setup.md`.

## Backup and restore

Example backup:

```bash
docker exec insignia-stitchs-postgres \
  pg_dump -U insignia_stitchs insignia_stitchs \
  > /srv/data/backups/insignia-stitchs-$(date +%Y%m%d).sql
```

Use the matching container, database user, and database name for each instance.

## Current migration note

The historical Stitchs stack was named `insignia-custom`. When renaming it on the
VPS, stop the old stack, preserve a database backup, move the data volume to
`/srv/data/saas/insignia-stitchs/postgres`, update `.env` to the Stitchs domain,
and bring it back under `/srv/saas/infra/stacks/insignia-stitchs`.
