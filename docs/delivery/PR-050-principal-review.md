# PR #50 — external principal review

**Verdict: CHANGES_REQUESTED at the exact reviewed head.**

Exact binding:
- repository/PR `Optidigi/insignia #50`
- base/effective merge base `703cfb21a4262675b088cd06289fe08a421ecdd8`
- reviewed head `5157ac8be2a9d1bf3f6765bf449fd6a410ce699c`
- reviewed tree `dc59b6e730940a0cbabd304ae51442f384046885`
- current main at review: exact base
- final-head workflows: 10/10 applicable, all SUCCESS, all attempt 1
- native GitHub reviews: none
- fresh completed-change GPT-6.1-sol/high reviews: CLEAR / CLEAR

PR #49 normal merge `703cfb21a4262675b088cd06289fe08a421ecdd8` has verified ordered parents `407608ab929e703cd2b10972de93cf00c58aa9df`, `19e069a32c2f97f0316208ebbb7c970ef309c31a` and tree `170edf1de05fb07ad42e8f0bc15771996531d2cf`.

## Accepted M5-019 evidence

Accepted:
- reviewed Node24/Astro admin deployment;
- isolated PostgreSQL18 and scoped Traefik routing;
- legacy `.nl` root/login preserved;
- restart/rollback exercised;
- exact reviewed Function artifacts bound;
- one inactive Shopify version created with `--no-build --no-release`;
- version `1158837927937 / m5-019-a9717e1265ef` inactive;
- Active `1153019904001 / insignia-3` unchanged;
- scopes/API/embedded/legacy flags unchanged;
- exact Function UIDs and strict decoded upload hashes matched;
- provider register closed with release0/fixture0.

Workspace LXD cleanup (`sudo snap remove lxd`) is operational housekeeping and not a production correctness blocker.

## Material blocker

The current candidate contradicts the owner's later locked production identity.

Reviewed config:
- `name = "Insignia"` — correct.
- `application_url = "https://insignia.optidigi.nl/admin/products"` — superseded.
- deployed `APP_URL=https://insignia.optidigi.nl` — superseded.

Locked production identity:
- app/product name `Insignia`
- canonical origin `https://insignia.optidigi.com`
- canonical embedded application URL `https://insignia.optidigi.com/admin/products`
- server `APP_URL=https://insignia.optidigi.com`
- Stitchs and Superfunny are unrelated legacy apps and must not constrain Insignia unless an actual shared-infrastructure collision is independently proven.

Therefore version `1158837927937` is not release-authorized and cannot become the production version.

Its release proposal is no longer EXECUTE_READY under the current owner decision.

## Required correction

Correct the SAME PR.

Do not delete/rewrite `.nl` historical evidence.

Classify version `1158837927937 / m5-019-a9717e1265ef` as:

`SUPERSEDED_WRONG_CANONICAL_ORIGIN_NEVER_RELEASE`

No release/rollback operation is needed because it is inactive.

Deploy the same reviewed Insignia build at the canonical `.com` origin and create exactly one replacement unreleased version only after `.com` readiness is proven.

## Canonical naming

The current config already uses:
`name = "Insignia"`.

This satisfies the canonical app-name decision.

Do not rename the app to Stitchs, Superfunny, or another legacy identifier.

Shopify identity remains:
- App `gid://shopify/App/429028933633`
- Client `1443cf6d03d39edae7c101a943c5c684`

No new Shopify app should be created merely for naming/domain correction.

## Merge boundary

Do not merge the current head.

Return the same PR #50 after M5-019R correction with a new exact head/tree, fresh reviews and final CI.
