# M5-019 — pre-version release proposal

**IN_PROGRESS / NOT_EXECUTE_READY.** The reviewed web deployment and rollback are qualified. No Shopify app version has been created or released. Supported installation-impact evidence is captured; complete inventory is not exposed by inspected surfaces. Fresh gate review and exact-source CI remain pending.

| Field | Exact candidate / evidence |
|---|---|
| App / org / client | 429028933633 / 200969036 / 1443cf6d03d39edae7c101a943c5c684 |
| Application URL | https://insignia.optidigi.nl/admin/products |
| Runtime | Node24.21.0 production Astro standalone; APP_URL=https://insignia.optidigi.nl |
| Web image | sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5 |
| Web package | sha256:f117be50d7bc106f1c943cdf75a8080fa63c26e0edd99b7ba0ddf3eaea697c2b |
| Embedded / legacy install | true / false, unchanged |
| API | 2026-07, unchanged |
| Required scopes | empty, unchanged |
| Optional scopes | write_products,read_publications,read_product_listings, unchanged |
| Auth redirects | empty [], exact current CLI capture; implemented App Bridge online token exchange has no callback route |
| Functions | Two frozen transform/validation modules only; [exact bindings](../../deployment/m5-019/extension-bindings.json); proposed new local UIDs, provider registrations/readback pending |
| Installation | insignia-rewrite-dev; current presence verified; App Store listing Draft; complete inventory/absence of other installs not observed; no-release current impact zero |
| Unreleased version | NONE — creation attempts0 |
| Shopify rollback | Active1153019904001 / insignia-3; fresh native/official-CLI equality verified before creation |
| Host rollback | Stop only new web service; admin falls back legacy404, root/login200; preserve separate DB volume. Same image/container restoration tested |

[Host receipt](evidence/m5-019/host-routing-qualification.json) proves public bootstrap/CSP/private no-store, API401, immutable assets, prefix-boundary controls, restart and rollback, with legacy root/login and immutable container/image/start time preserved. Owner-private deployment is `/home/serveradmin/insignia-rewrite-m5-019`, separate from legacy. Rollback command from that directory is `docker compose stop web`; restore the same bound service with `docker compose start web`. No database volume or legacy resource is removed. Host liveness is not commercial readiness, grants, Function enablement or activation acceptance.

The exact-app candidate is derived from supported current CLI configuration and changes App Home URL plus the two frozen Function modules. Empty redirects are preserved rather than inferring an unimplemented callback. New module UIDs are explicit locally selected identities; they are not assertions about existing registrations. Build commands fail locally if rebuild is enabled. The sole creation operator must use pinned CLI4.8.2 with `--no-build --no-release`, no theme extension, unchanged scopes and all query/Wasm/config/source hash checks.

Assess the explicit supported-impact limits, new module binding, fresh full-source reviews and natural applicable exact-source CI, then freeze the complete gate before one durably accounted no-release attempt. Any ambiguous creation settles the run as STOPPED and prohibits another attempt. Inspect the created version/config/modules/artifact binding and Active equality before upgrading this proposal to EXECUTE_READY. App/Function release remains unauthorized.

Future release affects App Home/available modules globally for this exact app; the installed-store count is not inferred from charts or Draft status. Scopes are unchanged, with no grant request or per-store Function enablement. This proposal does not authorize rollout or claim absence of other development installations. A later separately authorized release must bind the exact unreleased version and retain Active1153019904001 as rollback. Its post-release G7 procedure must first verify the designated installation/grants and trusted release/commercial/Function/readiness premises, then run the [accepted M5-018 matrix](M5-018-G7-MATRIX.md): cold launch/deep link/reload/mobile/restricted cookies; expired identity/staff/shop-install isolation; private SSR/fragments and origin/CSRF; production hydration/events/canvas/native refresh; idempotent/ambiguous save/publish; stale two-tab edits; grant/readiness refresh; late activation state. Configure→preview→save→publish request must create immutable durable revisions/operations and use v3; effective UI appears only after committed activation. Any later fixture needs its own bounded authorization and safe archival. A released version alone does not manufacture readiness or close G7/M5.

Return one integrated PR with fresh completed-change reviews and final CI, then stop for external principal review. No successor merge, scope/fixture/publication/availability change, M6/M7 or launch.
