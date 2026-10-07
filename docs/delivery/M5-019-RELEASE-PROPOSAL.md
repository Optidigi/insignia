# M5-019 — NOT_EXECUTE_READY release proposal

**Status: IN_PROGRESS / NOT_EXECUTE_READY**. Current VPS ownership, origin TLS, legacy route/static ownership and portable production-package readiness are now qualified. Staged/public deployment, restart/rollback, exact current provider configuration/modules/installation impact and the full frozen gate remain pending. No web deployment or Shopify version creation/release has occurred; unreleased version ID/name **NONE**.

## Candidate configuration, not a release payload

| Field | Principal-bound candidate | Qualification |
|---|---|---|
| Exact app/org/client | app429028933633 / org200969036 / client1443cf6d03d39edae7c101a943c5c684 | Accepted M5-018 identity; no fresh provider access here |
| Web origin / APP_URL | `https://insignia.optidigi.nl` | DNS/origin TLS/ownership pass; staged/public deployment remains pending |
| Application URL | `https://insignia.optidigi.nl/admin/products` | Currently legacy404; not deployed |
| Embedded / legacy install | true / false | Required unchanged |
| API | 2026-07 | Reviewed Function configs unchanged |
| Required scopes | empty | Required unchanged |
| Optional scopes | `write_products,read_publications,read_product_listings` | Exact unchanged set; no scope request |
| Auth redirects | UNQUALIFIED | Derive only from reviewed implemented flow and supported provider validation; unknown required value stops before creation |
| Transform/validation | Exact handles/targets/hashes in [artifact receipt](evidence/m5-019/reviewed-source-artifact-binding.json) | Local binding only; provider UID/module identity unqualified |
| Designated installation | `insignia-rewrite-dev` | M5-018 accepted installation; no fresh impact/inventory evidence |
| Shopify rollback | Active `1153019904001` / `insignia-3` | Historical accepted rollback reference; fresh equality required before/after any no-release creation |
| Host rollback | Candidate qualified | Existing exact Traefik/router/image captured; actual rollback qualification remains pending |

No app configuration file or inferred redirect/provider UID is submitted. No existing legacy image, database, credentials, proxy host, application URL or Shopify app identity is repurposed as the rewrite runtime.

## Current coexistence proof and deployment checks

Current inspection has qualified the owner-confirmed VPS. The sanitized current Traefik labels, upstream container/image, network topology, deployed 62-route legacy manifest and static-prefix evidence are committed. No candidate route overlaps the legacy manifest; exact owner credential-file metadata is qualified. Deployment uses separate rewrite runtime/database resources. Actual staging, public path dispatch, health, restart and rollback checks remain required.

The reviewed dispatch candidate retains `/` and `/auth/*` on the legacy upstream; route exact `/admin/products` and descendants, `/api/admin/products` and descendants, and reviewed `/_astro/*` assets to an isolated reviewed Node24 Astro standalone rewrite upstream. Health routing must be explicitly collision-checked. This dispatch shape is a proposal, not tested or installed Traefik configuration. Preserve current login behavior and bind a rollback restoring the exact prior route configuration plus stopping only the new rewrite service. Prove TLS, assets, CSP, App Bridge assumptions, private unauthenticated API failure, health/readiness and restart publicly after the exact reviewed deployment. Liveness alone is not activation/readiness.

**Concrete alternate-host proposal:** dedicated `https://insignia-admin.optidigi.nl/admin/products` in the owner's confirmed Cloudflare-managed `optidigi.nl` namespace, with a separate Traefik host router and isolated rewrite upstream. This avoids taking legacy route prefixes, but this hostname's DNS/vhost ownership, TLS and process readiness are **not yet verified or provisioned**. The owner identifies Traefik as current; the legacy NPM runbook must not be applied. Obtain a principal-approved candidate-origin rebind if choosing it; do not silently substitute it for the currently approved URL. The original candidate now has verified host ownership; this alternate remains an unexecuted contingency. No DNS/vhost change is authorized by this document itself.

## Bounded subsequent execution and post-release procedure

Once the host gate passes, deploy only the approved production source/build with immutable artifact hashes and existing approved server-only secret mechanism. Qualify exact config/auth/installation/module identity, perform clear fresh reviews and natural exact-source CI, and freeze the entire gate. Only then make one durable-accounted `shopify app deploy --no-release` attempt for the exact app/config and only the reviewed transform/validation artifacts; no retry after ambiguous settlement. Inspect created version ID/name/config/scopes/API/extensions/hashes, and fresh-read current Active equality to `1153019904001`. Stop with the unreleased version and a new exact EXECUTE_READY proposal for principal review. **No release is authorized in M5-019.**

A later separately authorized release/post-release G7 qualification must bind the released version and deployed source/artifact, verify designated installation and unchanged grants, then exercise the [accepted M5-018 criterion matrix](M5-018-G7-MATRIX.md): cold launch/deep link/reload/mobile/restricted cookies; expired identity/staff/install isolation; private SSR/fragments and CSRF/origin controls; hydration/events/canvas/native refresh; idempotent and ambiguous save/publish; two-tab stale edits; grant/readiness refresh and late activation state. Run configure→preview→save→publish-request→durable revision/operation/v3 activation, and require effective state only after committed activation. Bound any fixture and archive it safely under that later authorization. This procedure is a reference, not live evidence or new fixture/release authority; trusted Function/readiness/commercial bindings cannot be manufactured merely by releasing a version.

Return the [host report](M5-019-REPORT.md), one integrated PR, exact candidate refs, fresh reviews and final CI. Principal approval remains external. Availability v3 and historical v1/v2/recovery stay unchanged; no M6/M7 or launch.
