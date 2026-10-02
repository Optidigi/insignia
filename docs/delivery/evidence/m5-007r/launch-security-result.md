**BLOCKED — the proposed launch can initiate a prohibited new-login route.**

Reviewed installed `@shopify/cli` **4.8.2** at `/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli`. The actual `.bin/shopify` symlink is `../@shopify/cli/bin/run.js`. The named Node binary exists at `/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node`; it was not executed.

Inspected entry/bootstrap, oclif loading and hooks, command entries, linked context/config writing, platform queries, authentication, updater, notifications and analytics.

All paths below are relative to that installed package:

| Source | Actual SHA-256 |
|---|---|
| `dist/chunk-KANWS6HC.js` | `66ccd85d7ab66455d1e7724e1618891cbec7409990c8cf1cc9bc65331215d811` |
| `dist/chunk-ESTXKKAB.js` | `c75a0d473ba3325862e9455717d14b8892e1c30428d8adf20c53310f1d687ef8` |
| `dist/chunk-NYHGIWKZ.js` | `a89873a128c3044b0870f2a82788a7e4d8f8642e9bb4bfcb0c0f0d4abc380d7a` |
| `dist/chunk-CTNBSUVU.js` | `7066325faa5c75799d9112b069fc9f9c279ebdac3405e85b4410dffe1359a8d3` |

Both principal-table anchors **match**.

1. **Authentication blocker:** `chunk-MJ3WNVMQ.js`’s `session()` calls `zDt()` without `noPrompt:true`. In [chunk-NYHGIWKZ.js](/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/dist/chunk-NYHGIWKZ.js:777), `yu()` defaults `noPrompt:false`; `needs_full_auth`, including certain refresh failures, reaches `fce()` → `Nse()`. `Nse()` POSTs to `/oauth/device_authorization` **before** its CI guard. CI prevents verification-code display, browser opening and polling, but the login route has already started. That exceeds M5-007R’s exclusion of new auth/login routes; it is not ordinary existing-session renewal. Closed stdin and the deadline cannot prevent this preceding POST.

2. **Unresolved plugin boundary:** `ShopifyConfig` does not disable user plugins. [chunk-CTNBSUVU.js](/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/dist/chunk-CTNBSUVU.js:69) loads same-HOME user/link plugins and permits their lifecycle hooks. The allowlist and empty scratch do not eliminate this path. Private plugin state was not inspected; plugin presence or safety is unverified.

The proposed environment blocks the known auto-upgrade branch and notification subprocess, and disables analytics transmission. Under the supplied scratch assumptions, built-in explicit-client branches resolve the existing app and avoid creation/dependency installation. Prerun may still fetch package-version metadata; linked context writes local `.shopify` metadata/preferences. Generated TOML remains configuration mapping, not an extension manifest.

No launch, Shopify/npm/API/browser operation, secret/cache read, patch or write occurred. Session usability and deadline enforcement were not tested. Return this source finding for principal disposition before capture.