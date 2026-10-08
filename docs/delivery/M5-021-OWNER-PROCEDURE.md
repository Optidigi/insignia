# M5-021 — owner normal-browser procedure

The owner operates their authenticated laptop browser. The agent never automates Shopify human verification. Read the [authorized brief](prompts/M5-021-OWNER-ASSISTED-G7.md) and current report before using these steps. M5-020 raw provider runs stay closed; no release/version/scope operation belongs here.

## Executed Phase A procedure — stopped on authenticated Search failure

The owner now reports the search product page appears but Search returns **Authentication unavailable**. The following records the requested procedure; no further browser action is requested. Phase B does not pass, so later steps remain inactive. Exact error and evidence limits are in [owner observations](evidence/m5-021/owner-native-observations.json).

1. Sign into Shopify normally on the laptop and select **insignia-rewrite-dev**. Check the store name before proceeding.
2. Open **Apps → Insignia**. Complete any Shopify human verification normally.
3. Observe whether the embedded application appears inside Shopify. Expected app title is **Products · Insignia**, with **Choose a product**, **Shopify products** and **Search products** controls. A product list or **No products found.** is an observation, not a readiness pass.
4. Report the visible title and exact error/readiness text, if any. If comfortable checking the iframe address, report only the origin and pathname: **https://insignia-app.optidigi.nl/admin/products**. Do not copy URL query strings, authorization headers, tokens, private HAR files, cookies or staff personal details. No screenshot or observation timestamp is assumed unless actually supplied.
5. Stop at this page. Do not select historical qualification fixtures, create a product/config, save, request publication, enable Functions or approve new scopes.

If the normal browser cannot reach the iframe, classify BLOCKED_OWNER_NATIVE_AUTH with the supplied error. An embedded public shell with an API/authentication failure is not a qualified admin launch. Preserve the actual failure.

## Phase B readiness gate — before any fixture

Keep three evidence classes distinct: owner native observations; executed local/server/database evidence; existing accepted automated/source controls. Require all of the following, linked to the exact current deployment and designated installation:

| Premise | Required proof |
|---|---|
| Exact embedded origin/app/shop | Owner normal-browser frame and correct dev store; server identity binds Insignia client1443cf6d03d39edae7c101a943c5c684/app429028933633. A bare canonical URL loads only a public shell. |
| Installation generation | Authenticated provider installation ID equals the durable current active installation for the exact tenant/shop, no guessed seed. |
| Authorized staff/grants | Current authenticated online staff grant is shop/staff bound; app, user and installation grants authorize read/edit and required publication observations. Optional configured scopes are not actual grants. |
| Release/build | Active1158986629121 plus server-owned trusted exact build/artifact RELEASE_BOUND evidence; native version fields alone are insufficient. |
| Function readiness | Fresh exact-shop/install Function observations and trusted artifact bindings; version module/UID presence is not per-store Function enablement. |
| Calendar/key/commercial | Trusted merchant calendar, applicable current key/admission readiness and actual recognized entitlement/feature policy. Do not guess commercial terms or create billing/provisioning records. |

The accepted compiled production composition currently supplies null expected build, no trusted release source, unknown Functions and a throwing calendar. [Static evidence and local pure control](evidence/m5-021/readiness-composition-evidence.json) establish this accepted-code gap; authenticated current deployment/tenant/grants/commercial state remains unobserved. If required wiring/provisioning/enablement is absent, stop before fixtures and return the exact blocker. This slice does not implement or provision the missing capability.

## Conditional later steps — inactive until Phase B is fully proven

These steps document the requested procedure, not permission to proceed past a failed gate. If Phase B stops, phases C–E are not executed.

- Core native G7: record cold launch, canonical config deep link, reload/back/forward, mobile layout, real Polaris/Preact controls, canvas mount/events and refresh consistency. Record the actual owner observation for each; use exact accepted automated controls for destructive/impractical negative cases only where the brief permits and no native contradiction exists. No blanket PASS.
- Bind one fresh disposable dev-store product to a unique M5-021 ownership marker and one ProductConfig. Record exact product ID, config ID and ownership before any merchant write. No historical fixture reuse. Prepare bounded durable accounting and exact activation inputs first.
- Open that exact product via **Configure product**, click **Create configuration** once, configure representative placement geometry and permitted method/step/pricing/tier controls, and observe **Product placement preview**. Record chosen values and expected preview semantics before save.
- Click **Save draft** once and obtain server/database draft/version readback. Open two tabs at the same saved version, save one deliberate edit in tab A, then save a distinct edit from stale tab B: require conflict and **Review latest saved draft**/**Reload current draft**, with the winning durable version verified. Ambiguous-save fault injection is not required live; the accepted automated exact-request recovery control may be used, paired with native reload that does not contradict it.
- Only when eligibility/readiness is exact and the draft is saved, click **Request publication** once. Bind immutable revision/request/outbox/operation and FIRST_PUBLICATION v3 through read-only durable evidence. Observe requested/pending UI before effective commit. If activation cannot commit, preserve pending/non-effective state and stop; never invent effective success or provision around a hold.
- After exact committed effective activation, use the same immutable request for idempotent continuation/replay where the production UI supports it; verify no second revision/request/provider lifecycle. Refresh/reopen the exact effective revision and preview. Do not click a new publish action that creates a different key and call it exact replay.
- Archive only this owned disposable product once if every write is settled and safe ownership is known. Require exact ARCHIVED/effectively-unpublished final read. Ambiguity stops without retry or cleanup mutation.

No app release/rollback/version creation, scopes, publication-discovery research, M6/M7 or merchant rollout. A later provisioning or production-source correction requires separate principal authorization.
