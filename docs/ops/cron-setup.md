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

## Custom/private instance cron

Each hosted instance needs its own cron entries pointing at its own URL with its own `CRON_SECRET`.

```cron
# Insignia CUSTOM app cleanup cron jobs
# Free expired variant slots every 5 minutes
*/5 * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer $CRON_SECRET_CUSTOM" | logger -t insignia-custom-cron

# Delete stale customization drafts hourly
0   * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer $CRON_SECRET_CUSTOM" | logger -t insignia-custom-cron

# design-fees: cleanup design-fee charges (>30d) + free expired design-fee slots — hourly
# No-op on instances where DESIGN_FEES_ENABLED is unset/false.
0   * * * *  curl -sf -X POST https://insignia-custom.optidigi.nl/api/admin/cron/cleanup-design-fee-charges \
               -H "Authorization: Bearer $CRON_SECRET_CUSTOM" | logger -t insignia-custom-cron
```

Where `CRON_SECRET_CUSTOM` is the value of `CRON_SECRET` from the custom instance's `.env`.
Read it from the file to avoid copy-paste errors:

```bash
CRON_SECRET_CUSTOM=$(grep ^CRON_SECRET /srv/saas/infra/stacks/insignia-custom/.env | cut -d= -f2)
```

View logs:

```bash
journalctl -t insignia-custom-cron -n 50
```
