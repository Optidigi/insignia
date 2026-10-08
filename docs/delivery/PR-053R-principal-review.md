# PR #53 — external principal rereview

**Verdict: APPROVED for normal merge at the corrected head.**

## Exact binding

- repository/PR: `Optidigi/insignia #53`
- base/effective merge base: `e132c108a2108aea830ac2a5229b410f93a61a7d`
- approved head: `e5d93a42ec06090b53f63088bcdb03c29d4a6a16`
- approved tree: `33f3e69107dce64018e9504609510206b22e37ae`
- correction parent: `cfd43482d2b8e8f30bd21d91bf00e95d0663a3e0`
- current main at rereview: exact base
- PR open/unmerged/mergeable
- final-head CI: 11/11 naturally applicable workflows SUCCESS, attempt 1
- fresh completed-change GPT-6.1-sol/high reviews: CLEAR / CLEAR
- native GitHub reviews: none

This approval supersedes the prior CHANGES_REQUESTED verdict only for this exact head/tree.

## Requested correction accepted

Migration `20261008000100_m5_trusted_release.sql` now takes `ACCESS EXCLUSIVE` before the emptiness check and refuses destructive down migration when any trusted release record exists.

Accepted behavior:
- empty trusted-release table can roll down/up in disposable/local rehearsal;
- populated table rejects down before destructive DDL;
- exact record/schema/migration-history/guard state survives;
- UPDATE/DELETE/TRUNCATE remain rejected;
- concurrent in-flight append is serialized: rollback waits, then refuses once the append commits.

PostgreSQL regression coverage exercises the actual dbmate migration boundary.

The provisioning proposal now explicitly rejects ad-hoc/manual dev-store tenant seeding and requires a reusable provider-authoritative, concurrent/idempotent managed-install bootstrap. Commercial inputs remain owner-controlled.

## Original M5-022 implementation accepted

The full PR also retains accepted:
- typed refresh-required exchange classification;
- 401 + `X-Shopify-Retry-Invalid-Session-Request: 1` only for refreshable exchange;
- one fresh-ID-token browser retry;
- generic provider/database failures remain 503;
- bounded safe auth diagnostics;
- trusted release/build/Function/calendar readiness;
- exact 30-second freshness;
- read-only runtime trusted-release capability;
- fail-closed missing evidence/Function mismatch;
- unchanged v1/v2/v3 availability semantics.

Qualification:
- focused correction 5/5;
- PostgreSQL18.6 176/176;
- PG-backed web/admin/browser 75/75;
- full root PASS;
- stress100/100;
- expected renderer negative;
- 11/11 final-head CI, attempt1;
- CLEAR/CLEAR final reviews.

## Production state

No production or Shopify operation occurred in the correction.

Known production state remains:
- canonical `https://insignia-app.optidigi.nl`;
- Active Shopify app version `1158986629121`;
- rollback `1153019904001`;
- `1158837927937` NEVER_RELEASE;
- designated tenant/current-install rows absent;
- trusted-release relation absent;
- commercial/Partner config absent;
- historical Search first throwing stage still unknown.

## Current Shopify contract alignment

Shopify managed installation installs/updates scopes without calling the app. Embedded apps use ID-token exchange. Offline tokens are the persistent credential for background work; online tokens are staff/session scoped. New public apps use expiring offline access tokens.

This validates treating missing durable first-install state as an application lifecycle responsibility rather than relying on a legacy callback or one-off seed.

## Disposition

PR #53 may be normally merged at this exact head.

M5/G7 remains open.

Next authority: M5-023 — permanent managed-install bootstrap + trusted production provisioning + corrected web deployment + one owner Search; continue toward G7 only if owner-backed commercial eligibility is legitimately available.
