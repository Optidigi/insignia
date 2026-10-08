# Principal successor adjudication after PR #53 correction

Planning guidance only; not authority before PR #53 rereview/merge.

Next integrated slice should close production provisioning without ad-hoc seeds:

1. permanent managed-install/token-exchange first-session tenant/install bootstrap;
2. expiring offline credential bootstrap if background operations require it;
3. migration16 production apply with operator INSERT / runtime SELECT-only grants;
4. fresh Active-version observation + append-only trusted release record;
5. deploy exact corrected web runtime only;
6. owner Search once with safe auth-stage evidence;
7. if auth succeeds, verify Function ownership + trusted day/signing/public config;
8. if commercial config is still absent, stop for owner-backed real or separately approved dev-only entitlement;
9. once entitlement is legitimate, finish G7 + one disposable ProductConfig publish/v3 activation + cleanup.

No Shopify app version/release change is expected.
