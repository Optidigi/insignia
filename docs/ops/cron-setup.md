# VPS Cron Setup

These cron jobs must be added on the production VPS during Phase 2.
Run `crontab -e` as the user running the Insignia Docker container.

## Prerequisites

- `CRON_SECRET` must be set in the VPS `.env` file (same value used in Docker Compose).
  Generate with: `openssl rand -hex 32`
- The app must be running and reachable at `https://insignia.optidigi.nl`.

## Cron entries

```cron
# Insignia cleanup cron jobs
# Free expired variant slots every 5 minutes
*/5 * * * *  curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron

# Delete stale customization drafts hourly
0   * * * *  curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron
```

## Verification

Test the endpoints manually before enabling the cron:

```bash
# Test slot cleanup
curl -v -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-slots \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expected: {"freedSlots":0,"expiredConfigs":0,"timestamp":"2026-..."}

# Test draft cleanup
curl -v -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-drafts \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expected: {"deletedDrafts":0,"deletedUploadSessions":0,"timestamp":"2026-..."}
```

## Viewing logs

```bash
journalctl -t insignia-cron -n 50
```

---

## Store-specific private instance cron

Each hosted instance needs its own cron entries pointing at its own URL with its own `CRON_SECRET`.

Read secrets from the instance env files to avoid copy-paste errors:

```bash
CRON_SECRET_STITCHS=$(grep ^CRON_SECRET /srv/saas/infra/stacks/insignia-stitchs/.env | cut -d= -f2)
CRON_SECRET_SUPERFUNNY=$(grep ^CRON_SECRET /srv/saas/infra/stacks/insignia-superfunny/.env | cut -d= -f2)
```

```cron
# Insignia Stitchs cleanup cron jobs
*/5 * * * *  curl -sf -X POST https://insignia-stitchs.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer $CRON_SECRET_STITCHS" | logger -t insignia-stitchs-cron

0   * * * *  curl -sf -X POST https://insignia-stitchs.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer $CRON_SECRET_STITCHS" | logger -t insignia-stitchs-cron

0   * * * *  curl -sf -X POST https://insignia-stitchs.optidigi.nl/api/admin/cron/cleanup-design-fee-charges \
               -H "Authorization: Bearer $CRON_SECRET_STITCHS" | logger -t insignia-stitchs-cron

# Insignia SuperFunny cleanup cron jobs
*/5 * * * *  curl -sf -X POST https://insignia-superfunny.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer $CRON_SECRET_SUPERFUNNY" | logger -t insignia-superfunny-cron

0   * * * *  curl -sf -X POST https://insignia-superfunny.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer $CRON_SECRET_SUPERFUNNY" | logger -t insignia-superfunny-cron

0   * * * *  curl -sf -X POST https://insignia-superfunny.optidigi.nl/api/admin/cron/cleanup-design-fee-charges \
               -H "Authorization: Bearer $CRON_SECRET_SUPERFUNNY" | logger -t insignia-superfunny-cron
```

View logs:

```bash
journalctl -t insignia-stitchs-cron -n 50
journalctl -t insignia-superfunny-cron -n 50
```