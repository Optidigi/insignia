# M5-019R — canonical `.com` production-domain correction

## Scope

Correct the SAME PR #50.

The existing `.nl` deployment/version is historical evidence only.

Canonical final identity:
- Product/app: `Insignia`
- Origin: `https://insignia.optidigi.com`
- Shopify application URL: `https://insignia.optidigi.com/admin/products`
- `APP_URL=https://insignia.optidigi.com`

Stitchs and Superfunny are unrelated legacy apps and must not influence Insignia deployment/config unless a concrete shared-resource collision is observed.

## Preserve history

Do not rewrite:
- M5-019 `.nl` host evidence;
- version-creation receipt for `1158837927937`;
- provider readback;
- original release proposal as historical executed evidence.

Add adjudication that version `1158837927937 / m5-019-a9717e1265ef` is inactive and permanently:
`SUPERSEDED_WRONG_CANONICAL_ORIGIN_NEVER_RELEASE`.

Never release it.

## `.com` DNS/TLS/origin qualification

The owner states Cloudflare wildcard DNS for `*.optidigi.com` points to the production server.

Verify:
- public DNS for `insignia.optidigi.com`;
- Cloudflare proxy/TLS behavior as observable;
- origin reachability through intended routing;
- Traefik host routing.

Do not modify unrelated DNS unless verification proves a specific need.

## Dedicated Traefik hostname

Prefer a dedicated router:
`Host(\`insignia.optidigi.com\`)`

for the rewrite service.

Do not path-share Insignia with Stitchs/Superfunny/legacy apps on `.com`.

The whole dedicated `.com` hostname may route to Insignia.

Canonical embedded path remains `/admin/products`.

Keep the `.nl` legacy root/login application intact.

Remove/disable only the M5-019 rewrite-specific `.nl` route if it was added solely for the candidate admin, returning `.nl` to its prior legacy behavior.

Do not alter unrelated old applications.

## Reuse the exact reviewed build

Do not rebuild application or Functions merely to change hostname/config.

Reuse the exact accepted web image/package and Function binaries if deployment configuration alone is sufficient.

If source/build must change for hostname handling, stop and treat it as an explicit source correction with new build/review/CI before provider version creation.

Set:
`APP_URL=https://insignia.optidigi.com`.

Use the existing approved secret mechanism. No secret values in evidence.

## `.com` readiness

Before creating another Shopify version prove:
- `https://insignia.optidigi.com/admin/products` serves the reviewed production admin;
- exact public client is the Insignia client;
- CSP/private no-store behavior remains correct;
- `/_astro/*` assets load;
- `/api/admin/products/*` reaches the reviewed backend and unauthorized access fails safely;
- restart/recovery works;
- dedicated `.com` route does not affect `.nl` legacy root/login;
- health/readiness is deterministic;
- deployed image/package hashes equal accepted reviewed artifacts.

No Shopify release yet.

## Canonical Shopify config

Create a replacement config whose intentional app-home change from M5-019 is:

`application_url = "https://insignia.optidigi.com/admin/products"`

Require:
`name = "Insignia"`.

Keep unchanged:
- client ID;
- embedded=true;
- required scopes empty;
- optional scopes exactly `write_products,read_publications,read_product_listings`;
- use_legacy_install_flow=false;
- auth redirects empty unless actual implemented auth proves otherwise;
- API 2026-07;
- exact two reviewed Function extensions;
- exact Function query/Wasm/config bytes.

No Stitchs/Superfunny identifiers in Insignia config.

## New pre-version gate

Before provider mutation:
- freeze exact `.com` host/config/build inputs;
- verify old inactive `.nl` version remains inactive;
- verify Active remains `1153019904001 / insignia-3`;
- run all applicable checks;
- fresh GPT-6.1-sol/high Spec/security reviews CLEAR;
- exact-source CI green;
- durable one-attempt reservation.

## Create one replacement unreleased version

Authorize exactly one additional:

`shopify app deploy --no-build --no-release`

against the canonical `.com` config.

No release.
No retry on ambiguous settlement.

The new inactive version must read back:
- app name `Insignia`;
- application URL `https://insignia.optidigi.com/admin/products`;
- embedded=true;
- legacy=false;
- exact scopes unchanged;
- API2026-07;
- exact two Function UIDs/config;
- exact reviewed Function artifact binding.

Verify:
- old `.nl` version `1158837927937` remains inactive;
- Active `1153019904001` remains unchanged.

## New release proposal

Prepare a new proposal referencing only the canonical `.com` inactive version.

It may be EXECUTE_READY only if:
- `.com` host readiness is proven;
- exact config readback matches;
- exact Function artifacts match;
- rollback version is known;
- release impact limitations are explicit;
- designated installation remains present;
- no scope change is required.

The `.nl` version must be explicitly excluded from any release procedure.

## LXD cleanup

Workspace LXD cleanup remains administrative housekeeping:

`sudo snap remove lxd`

It requires administrator authentication and must not be bypassed.

Record whether cleanup was completed. This does not block the `.com` version if all product/deployment gates pass.

## Validation and handback

Run all applicable root/PG/deployment/route/browser/final-head checks and two fresh full-source GPT-6.1-sol/high reviews.

Return the SAME PR #50 for principal rereview with:
- new exact head/tree;
- immutable `.nl` evidence;
- explicit superseded-version classification;
- `.com` DNS/TLS/Traefik/deployment/readiness evidence;
- canonical config;
- one replacement inactive `.com` version receipt;
- exact native readback;
- new EXECUTE_READY release proposal;
- fresh reviews;
- final CI.

Stop.

Do not merge.
Do not release.
Do not create a product fixture.
Do not start M6/M7.
