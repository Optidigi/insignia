# M5-019 — deployed admin readiness + unreleased Shopify app version

## Goal
Turn `BLOCKED_RELEASE_BOUND` into an exact release candidate without releasing it.

## Entry
After verified normal merge of PR #49 at:
- base `407608ab929e703cd2b10972de93cf00c58aa9df`
- head `19e069a32c2f97f0316208ebbb7c970ef309c31a`
- tree `170edf1de05fb07ad42e8f0bc15771996531d2cf`

Verify actual merge parents/tree and begin from remote main.

## Host readiness
Candidate origin: `https://insignia.optidigi.nl`
Candidate embedded route: `https://insignia.optidigi.nl/admin/products`

Before any Shopify version creation, establish:
- DNS target and TLS validity;
- reverse-proxy/vhost ownership;
- process/service/container currently serving the host;
- route ownership/collision behavior for `/`, `/admin/products`, `/api/admin/products/*`, `/_astro/*`;
- safe coexistence with the existing root/login application;
- health/readiness and restart behavior;
- rollback config/artifact.

Do not overwrite the existing root/login service merely to make the route work. If safe path-level coexistence cannot be proven, stop with `HOST_ROUTE_COLLISION` and a concrete alternate owned hostname/path proposal.

## Deploy exact reviewed web build
Only after ownership/collision proof, deploy the exact reviewed production Astro build derived from the approved PR49 merge source.

Requirements:
- Node 24;
- production standalone build, no dev server/tunnel;
- `APP_URL=https://insignia.optidigi.nl`;
- correct public client ID;
- server-only secrets via existing approved secret mechanism;
- immutable deployment artifact/source binding;
- record runtime/service identity and rollback.

Prove `/admin/products` serves the reviewed embedded bootstrap, assets/API route correctly, unauthenticated requests fail safely, CSP/App Bridge assumptions hold, health is deterministic and root/login remains intact.

## Exact app configuration delta
Before creating a version, bind exact values:
- application URL `https://insignia.optidigi.nl/admin/products`;
- embedded=true;
- legacy install=false;
- API2026-07;
- required scopes unchanged/empty;
- optional scopes unchanged: `write_products,read_publications,read_product_listings`;
- exact transform and validation extension identities/artifact hashes;
- any redirect URLs required by the actual implemented auth flow;
- rollback Active version `1153019904001` / `insignia-3`.

No inferred values. Unknown required redirect/config => stop before version creation.

## Installation/Function impact
Bound the current installation impact available through supported provider surfaces and verify the designated development installation remains present. Qualify the reviewed Function extension/module identities sufficiently to know the version will contain the reviewed artifacts.

No commerce enablement.

## Create exactly one unreleased app version
Only after all readiness gates pass, create exactly one Shopify app version with **no release** (`shopify app deploy --no-release` intent).

No second attempt if settlement is ambiguous.

Record version ID/name, config, scopes, API version, extension list, artifact hashes and proof current Active remains `1153019904001`.

Do not release.

## Inspect unreleased version
Read back the created unreleased version and require exact equality with the intended delta. Any mismatch stops; do not create another version.

## Handback
Return one PR with:
- PR49 merge receipt;
- host ownership/routing/readiness evidence;
- deployed web artifact receipt/hashes;
- unreleased version creation/readback;
- installation/Function impact evidence;
- an `EXECUTE_READY` release proposal or one exact remaining blocker;
- fresh GPT-6.1-sol/high reviews;
- final CI.

No scope change, released version, product fixture, publication mutation, availability architecture change, M6/M7 or launch.

Stop for principal review. Do not merge successor.
