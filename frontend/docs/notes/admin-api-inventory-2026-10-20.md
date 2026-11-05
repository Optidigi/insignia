# Current merchant admin API inventory

Research date: 20 October 2026. Source checkout: `codex/ui-redesign`, HEAD `1a18b463631ef162cdb577a8a4268500630a7e82`. This note records implemented source behavior. It does not establish native credentials, deployed configuration, successful provider mutations, production readiness or owner acceptance.

The inventory follows the actual Astro route exports into their handlers, services, validators and durable repositories. It covers all seven `/api/admin` route files, five merchant `/api/artwork` route files and two `/api/purchases/v1` route files. Those 14 files implement 28 recognized merchant method/path pairs: 17 GET, eight POST, two PUT and one DELETE. One POST config path accepts three distinct actions. Twenty-six pairs have current merchant browser callers; the two signing pairs have no caller in the merchant islands or shared browser code. The other nine API files belong to buyer/guest transport, webhooks and internal metrics.

## Authentication and transport shared by the inventory

Every merchant family requires an `Authorization: Bearer <Shopify ID token>` header, a current verified actor and a matching `shop` query parameter if one is supplied. Identity derives shop, staff, tenant and installation generation server-side. The authenticator verifies the session token, exchanges an online grant bound to that shop/staff, and reads current provider/durable installation state on each call. Invalid identity is 401; authority/dependency failures generally fail closed as 503. The special online-exchange-refresh-required error returns 401 with `X-Shopify-Retry-Invalid-Session-Request: 1`. [Authenticator](../../../apps/web/src/server/admin/auth.ts#L60), [admin boundary](../../../apps/web/src/server/admin/http.ts#L115), [purchase boundary](../../../apps/web/src/server/purchase/http.ts#L44), [artwork boundary](../../../apps/web/src/server/artwork/http.ts#L47).

| Permission used below | Actual derivation |
| --- | --- |
| Product read | Each of online app scopes, online user scopes and current installation scopes contains `read_products` or `write_products`. |
| Product edit | All three scope sets contain `write_products`; admin commands also require product read. |
| Artwork read | Verified online `accountOwner === true` and product read. Product access for ordinary staff alone does not grant access to private artwork. |
| Artwork upload | Verified online account owner and product edit. |
| Purchase/privacy read | Artwork read plus account owner and `read_orders` in all three scope sets. |
| Purchase mutation | Purchase/privacy read plus artwork upload. Reconcile uses this same mutation permission despite not changing artwork. |

These are the current code's permissions, not a proposed role design. There is no separately configurable staff artwork role or privacy role in this authenticator. [Scope derivation](../../../apps/web/src/server/admin/auth.ts#L150), [purchase permission gates](../../../apps/web/src/server/purchase/http.ts#L46).

Mutations require exact configured `Origin`, matching request host/protocol and a `Sec-Fetch-Site` value other than `cross-site`. Configured HTTPS may arrive at the application as HTTP behind its proxy. No body selects trusted tenant/staff/object authority. Admin JSON bodies have a 256,000-byte cap. Artwork and purchase JSON bodies use the shared 2,048-byte, three-second bounded reader. Empty merchant artwork completion bodies use a separate bounded emptiness check. [Origin and admin body parser](../../../apps/web/src/server/admin/http.ts#L49), [artwork/purchase body parser](../../../apps/web/src/server/artwork/body.ts#L10).

Admin/artwork JSON uses `private, no-store`, `Vary: Authorization, Origin` and `nosniff`. Purchase JSON also uses private/no-store and nosniff, with a 1 MiB default response limit and 4 MiB privacy-detail/export limit. The admin/artwork error shape is generally `{error}`; admin domain failures can instead return typed command outcomes. Purchase errors are `{code,message,requestId}`. A redesign must preserve these actual differences. [Admin response](../../../apps/web/src/server/admin/http.ts#L24), [purchase response](../../../apps/web/src/server/purchase/http.ts#L31), [purchase error mapping](../../../apps/web/src/server/purchase/http.ts#L128).

The shared browser helper gets App Bridge `idToken()`, shares only an in-flight token request, applies a ten-second deadline and retries once with a fresh token after 401. Fetch uses `cache: no-store`, `credentials: omit` and `redirect: error`; HTTP status and validation issues survive into thrown errors. [Browser transport](../../../apps/web/src/shared/admin-request.ts#L1).

GET means the requested feature is an observation, not that the authentication pipeline has no effects. Production authentication can reconcile installation/enrollment and, when `INSIGNIA_M7_BUYER_ENABLED=1`, bootstrap expiring offline credentials for an account owner with product-read access. This is shared composition behavior, not a browser-selected command. [Production configuration](../../../apps/web/src/server/admin/production.ts#L100), [offline bootstrap](../../../apps/web/src/server/admin/production.ts#L664).

## Products and configuration

Astro exports GET for the product collection and GET/POST/PUT for an individual product's config. The path product ID is a positive decimal Shopify product number, converted to `gid://shopify/Product/<number>`. The handler confirms each source/target product against the authenticated shop's catalog. [Collection route](../../../apps/web/src/pages/api/admin/products.ts#L1), [config route](../../../apps/web/src/pages/api/admin/products/[productId]/config.ts#L1), [product validation](../../../apps/web/src/server/admin/http.ts#L200).

| Method and exact path | Request | Successful response / effect | Current browser caller |
| --- | --- | --- | --- |
| GET `/api/admin/products` | Optional `q`, trimmed and at most 100 characters; optional `cursor`, at most 512 characters. Page size is fixed at 20. Product read. | 200 `{products: CatalogProduct[], nextCursor: string|null}`. Reads current Shopify catalog. | `MerchantConfigEditor`, both product list/search and copy-target search. |
| GET `/api/admin/products/:productId/config` | Positive decimal path ID. Product read. | 200 `ConfigView`, including `{product,config:null}` when no config exists. | `MerchantConfigEditor` load, refresh and publication observation. |
| POST `/api/admin/products/:productId/config` | Product edit; `Idempotency-Key`; exact JSON action `create`, `copy` or `publish`, specified below. | Create/copy return 201 `{kind:"created",configId}`. Publish returns 202 `{kind:"accepted",state,revisionId?}`. See command outcomes below. | `MerchantConfigEditor` create, copy and publish/continue. |
| PUT `/api/admin/products/:productId/config` | Product edit; `Idempotency-Key`; exact `{action:"save",configId,draftVersion,draft}`. | 200 `{kind:"saved",draftVersion}`. Saves a draft under optimistic version control. | `MerchantConfigEditor` Save / exact-request recovery. |

The complete accepted POST bodies are `{action:"create"}`, `{action:"copy",targetProductId:"gid://shopify/Product/<number>"}`, and `{action:"publish",configId,draftVersion}`. Copy target must differ from source. Save/publish `configId` is 1 to 128 characters matching the handler's identifier pattern; `draftVersion` is a decimal string, including zero, with at most 19 digits. Idempotency keys are 8 to 128 permitted identifier characters. Extra keys, including browser `shop`, `shopId` or `staffId`, are rejected. Invalid shapes yield 422. [Exact command boundary](../../../apps/web/src/server/admin/http.ts#L213).

`CatalogProduct` includes GID, title, status, optional primary image, variants with their GIDs/titles/images/selected options, and an optional truncation flag. `ConfigView` includes config ID, installation generation, draft/version, current shop currency, publication status/revision/source draft/request key/active revision/reason/hold/Function readiness, and `publishEligibility`. Publication states include DRAFT, ACTIVE, pending remote/activation/hold/restoration states, CONFLICT, OPERATOR_HOLD and FAILED. Those states cannot safely be collapsed into a saved/published boolean. [Browser-safe DTOs](../../../apps/web/src/shared/admin-view.ts#L1).

Draft input is the strict `m5-merchant-draft-v1` object with `mode`, `shopCurrency`, methods, placements, production options, pricing rules, optional labels and geometry. Deeper validation checks exact currency precision, Lean price constraints, ID references and geometry. Saving cannot silently round a price. [Draft schema](../../../packages/contracts/src/v1/merchant-draft.ts#L36), [server validation](../../../apps/web/src/server/merchant-config.ts#L73).

Command outcomes map `created` to 201, `saved` to 200, `accepted` to 202, `conflict` to 409, `invalid` to 422 and `forbidden` to 403. Invalid responses may include field-level `validationIssues`. A different request under an existing command key yields 409. [Outcome mapping](../../../apps/web/src/server/admin/http.ts#L92), [error mapping](../../../apps/web/src/server/admin/http.ts#L275).

Create persists an optional draft in current shop currency. Save uses durable command deduplication and `expectedVersion`. Copy reads the saved source draft, requires an unconfigured target, remaps choice/view IDs and removes source image/variant-image references. It does not copy the published effective revision into another product's authority. All these commands lock current tenant authority before command work. [Create/save/copy implementation](../../../apps/web/src/server/merchant-config.ts#L393), [copy remapping](../../../apps/web/src/server/merchant-config.ts#L150), [tenant locks](../../../apps/web/src/server/merchant-config.ts#L274).

Publish is the important provider-effect boundary. It requires current draft CAS, settled prior publication/recovery, a nonempty view/placement/method setup, current currency, current subscription features and release qualification. It may prepare privately allocated signing resources and capture immutable product-image previews. It commits an immutable revision, publication pointer and outbox intent, then advances provider publication/activation. Acceptance means the request was accepted, not necessarily ACTIVE. It preserves the exact immutable revision and command identity across lost responses; recovery rechecks current authority and eligibility. [Publish admission](../../../apps/web/src/server/merchant-config.ts#L542), [durable intent](../../../apps/web/src/server/merchant-config.ts#L606), [publication advance](../../../apps/web/src/server/merchant-config.ts#L717), [eligibility and private preparation](../../../apps/web/src/server/admin/production.ts#L438).

The editor sends its exact command key/body, stores publication ownership in session storage where available, and uses the original source draft/key when continuing an open publication. Unknown outcomes must survive UI changes; issuing a new key or reverting a draft does not settle the old request. [Command sender](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L821), [publication storage](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L85), [continue/reconcile](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L1054).

## Method library

| Method and exact path | Request | Successful response / effect | Current browser caller |
| --- | --- | --- | --- |
| GET `/api/admin/methods` | Product read. | 200 `{methods:[{id,name,version}]}`. Current tenant library. | `MethodLibrary`; editor reads templates. |
| POST `/api/admin/methods` | Product edit, idempotency key, exact `{name}`. | 201 `{kind:"created",method:{id,name,version}}`. | `MethodLibrary` create. |
| PUT `/api/admin/methods/:methodId` | UUID path ID, product edit, idempotency key, exact `{name,version}`. | 200 `{kind:"saved",method:{id,name,version}}`. | `MethodLibrary` rename. |
| DELETE `/api/admin/methods/:methodId` | UUID path ID, product edit, idempotency key, exact JSON `{version}`. | 200 `{kind:"deleted"}`. | `MethodLibrary` remove confirmation. |

Names are trimmed at the boundary, nonempty, at most 80 characters, and cannot contain control characters. Item versions are positive decimal strings of at most 18 digits. There is no GET item route. Missing service is 503; stale/removed rows and the 100-template limit return 409 `{kind:"conflict",message}`. The transactional dedup namespace binds installation and authorization generation/epoch. Replay does not invent success for a subsequently changed/deleted row. Names are copied into product drafts; editing/removing a template does not update configured products. [Routes](../../../apps/web/src/pages/api/admin/methods.ts#L1), [item routes](../../../apps/web/src/pages/api/admin/methods/[methodId].ts#L1), [HTTP contract](../../../apps/web/src/server/admin/http.ts#L144), [durable library](../../../apps/web/src/server/admin/methods.ts#L8).

The UI keeps the exact method/id/body/key while a response is uncertain and blocks a different pending signature. Auth loss clears private state. [Method caller and recovery](../../../apps/web/src/islands/MethodLibrary.tsx#L44), [editor template read](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L352).

## Readiness, billing and signing

| Method and exact path | Request / permission | Response and meaning | Current caller |
| --- | --- | --- | --- |
| GET `/api/admin/readiness` | Product read. | 200 `m5-admin-technical-readiness-v1` observation. No browser command body. | Settings readiness refresh through `MerchantSettings` / `ReadinessPermissions`. |
| GET `/api/admin/billing` | Product read. | 200 `BillingView`; no provider plan mutation. Missing billing composition is 503. | `MerchantBilling`. |
| GET `/api/admin/signing` | Product read and edit; requires private `signingOwner` composition. | 200 `SigningOwnerStatus`. Missing allocation is 503. | Backend/support only; no merchant island/shared caller found. |
| POST `/api/admin/signing` | Same permissions, same-origin, exact JSON `{action:"setup"}`. No browser-selected plan/key fields. | 202 when PENDING, otherwise 200 status. Can start one privately allocated signing attempt. | Backend/support only; eligible publish can call preparation internally instead. |

[Readiness/billing/signing branches](../../../apps/web/src/server/admin/http.ts#L177), [readiness caller](../../../apps/web/src/islands/MerchantSettings.tsx#L78), [billing caller](../../../apps/web/src/islands/MerchantBilling.tsx#L25).

Readiness returns observed time, verified shop/tenant/installation identifiers, product read/edit flags, trusted merchant timezone/day, Function ownership observations, trusted release/build identity, signing-key presence, public-config presence and commercial configuration presence. Presence is diagnostic, not a publication admission guarantee. It performs current provider/durable reads and can be unavailable. [Readiness DTO](../../../apps/web/src/server/admin/contracts.ts#L59), [production observation](../../../apps/web/src/server/admin/production.ts#L728).

Billing returns status `trial|active|inactive|unavailable`, observed/trial/cycle times, scheduled-cancellation/pending-change/new-action flags, standard USD 49.99 per 30 days, actual recurring price, development terms and a top-level Shopify management URL. That URL points at `/charges/insignia-1/pricing_plans` for the verified shop. This code does not expose create/cancel/switch-plan endpoints or a usage meter. [Billing DTO](../../../apps/web/src/shared/billing-view.ts#L1), [authoritative reader/management URL](../../../apps/web/src/server/admin/billing.ts#L6), [optional billing composition](../../../apps/web/src/server/admin/production.ts#L220).

Signing status is `{version:"m5-signing-owner-action-v1",state,actionAvailable,retryAuthorized:false,quoteIssuanceAuthorized:false}`. States are READY, WAITING_FOR_VERIFICATION, PENDING, PROVISIONED, STOPPED and UNCERTAIN. This is fixed private development-owner tooling, explicitly bound to `insignia-rewrite-dev.myshopify.com`, exact installation/authorization identity, release and key plan. Absence of the fixed private owner file leaves the action unavailable. Starting reserves a durable exclusive attempt; disconnect/restart/failure never grants another attempt. Status cannot select a new plan, authorize retries or issue quotes. [Private configuration](../../../apps/web/src/server/admin/signing-owner-configuration.ts#L6), [status contract](../../../apps/web/src/server/admin/signing-owner-action.ts#L16), [fixed binding](../../../apps/web/src/server/admin/signing-owner-action.ts#L129), [reservation and no retry](../../../apps/web/src/server/admin/signing-owner-action.ts#L253), [publication preparation](../../../apps/web/src/server/admin/production.ts#L474).

## Merchant private artwork

These five routes use authenticated merchant authority. They are distinct from the capability-authenticated guest upload routes. The body never supplies an object key. [Merchant upload route](../../../apps/web/src/pages/api/artwork/index.ts#L1), [merchant handler](../../../apps/web/src/server/artwork/http.ts#L36).

| Method and exact path | Request / permission | Successful response / effect | Current caller |
| --- | --- | --- | --- |
| POST `/api/artwork` | Artwork upload and read, same-origin; exact `{contentType,byteLength}`. | 201 artwork status plus `{upload:{url,headers},uploadUntil}`. Creates an asset and a private quarantine PUT lease only after inspection-worker readiness. | `ArtworkUpload` through `artwork-upload.ts`. |
| POST `/api/artwork/:assetId/complete` | UUID, artwork upload/read, same-origin, empty body. | 202 artwork status. Completes/queues inspection for that asset. | Upload and pending-completion recovery. |
| GET `/api/artwork/:assetId/status` | UUID, artwork read. | 200 artwork status, including nonterminal/rejected state. | Upload polling/resume. |
| GET `/api/artwork/:assetId/preview` | UUID, artwork read, usable unexpired asset. | 200 `{url,expiresAt,width,height}` for inspected raster preview. | Upload preview/renewal. |
| GET `/api/artwork/:assetId/download` | UUID, artwork read, usable unexpired asset. | 200 `{url,expiresAt,sha256,byteLength}` for original download. | `use-artwork-upload` original download. |

Artwork status is `{assetId,state,mimeType,width,height,expiresAt,rejection}`. States include UPLOADING, QUEUED, INSPECTING, PROMOTING, USABLE, REJECTED, DELETING and DELETED. Accepted formats are PNG, JPEG and SVG, at most 5 MiB. The declared upload lease lasts five minutes and the asset retention is seven days. Preview/original URLs expire at the earlier of five minutes or asset expiry. Usability is server/worker authority; upload or completion success is not inspection success. [Policy/state](../../../packages/application/src/artwork/artwork.ts#L4), [status/upload/URL contracts](../../../packages/application/src/artwork/artwork.ts#L110).

There is no HTTP idempotency key for upload admission: begin creates a new UUID. Recovery retains an acknowledged asset, retries its completion/status and renews its preview rather than uploading a second original. The storage PUT carries only signed upload headers, never the admin bearer or cookies. Invalid declaration is 422, unavailable inspector is 503, invalid/foreign asset is 404, unusable is 409 and expired/deleted is 410. [HTTP status mapping](../../../apps/web/src/server/artwork/http.ts#L74), [upload/resume client](../../../apps/web/src/islands/artwork-upload.ts#L95), [PUT boundary](../../../apps/web/src/islands/artwork-upload.ts#L163), [download caller](../../../apps/web/src/islands/use-artwork-upload.ts#L193).

## Purchases, production artwork and privacy

The collection route exports GET. Its catch-all exports GET and POST and routes the patterns below. All IDs shown here are UUIDs. All paths require purchase/privacy read authority. POST additionally requires artwork upload and same-origin protection. [Collection export](../../../apps/web/src/pages/api/purchases/v1/index.ts#L1), [catch-all export](../../../apps/web/src/pages/api/purchases/v1/[...route].ts#L1), [complete router](../../../apps/web/src/server/purchase/http.ts#L44).

| Method and exact path | Request | Successful response / effect | Current caller |
| --- | --- | --- | --- |
| GET `/api/purchases/v1` | Optional UUID `before`; `limit` integer 1 to 50, default 20. | 200 `m8-purchase-list-v1` with `items` and nullable UUID `nextCursor`. | Orders list, older orders. |
| GET `/api/purchases/v1/:purchaseId` | Purchase UUID. | 200 `m8-purchase-v1`; 404 if absent. | Order detail and refresh. |
| GET `/api/purchases/v1/:purchaseId/artwork/:assetId/download` | Purchase and asset UUIDs; retained purchase binding required. | 200 `{url,expiresAt}`. The HTTP DTO intentionally strips service SHA/byte fields. | Current and historical original-file controls. |
| GET `/api/purchases/v1/:purchaseId/artwork/:assetId/preview` | Same purchase-specific authority. | 200 `{url,expiresAt,aspectRatio?}` for inspected raster derivative. | Current and historical purchase previews. |
| POST `/api/purchases/v1/:purchaseId/artwork` | Exact `{expectedVersion,groupIndex,placementId,assetId}`. | 200 updated purchase view. Appends a production attachment event, preserving original selection. | Placement upload/select then attach. |
| POST `/api/purchases/v1/:purchaseId/lock` | Exact `{expectedVersion}`. | 200 updated purchase view. Locks the complete, usable current artwork set. | Lock artwork. |
| POST `/api/purchases/v1/:purchaseId/reconcile` | Exact `{}`. | 202 purchase view after advancing the existing installation reconciliation schedule. Does not itself read/write Shopify financial facts. | Request reconciliation. |
| GET `/api/purchases/v1/privacy` | Optional UUID `after`. No configurable page size. | 200 `{items: PrivacyRequest[]}`, at most 100, sorted by inbox UUID. | Privacy request list and next page. |
| GET `/api/purchases/v1/privacy/:inboxId` | Request UUID. | 200 request summary plus `orders:[{orderId,purchaseId|null}]`. | Open request / download request summary JSON. |
| GET `/api/purchases/v1/privacy/:inboxId/orders/:purchaseId` | Requested-order link and current generation required. | 200 `insignia-customer-order-export-v1`; manifest/order facts, without full design payload. | Download order data JSON. |
| GET `/api/purchases/v1/privacy/:inboxId/orders/:purchaseId/sets/:setId` | Same linked request/order plus valid binding-set UUID. | 200 same export shape, selecting set economics and an unexpired retained design payload. | Download retained design JSON. |

Purchase view contains immutable order ID/name/time, test flag, currency/exponent/exact original minor total, paid/financial/cancelled facts, exceptions/refunds/actual order lines, historical config groups/geometry/presentation/images/payload expiry, current artwork pointers/expiry, artwork version/state and attachment/lock events. Provider order labels are optional and their failure does not hide retained history. Access expiry or installation/grant loss still denies private reads. [Schemas](../../../packages/contracts/src/v1/purchase.ts#L19), [view projection](../../../apps/web/src/server/purchase/service.ts#L50), [access and optional labels](../../../apps/web/src/server/purchase/service.ts#L174).

Attachment and lock use optimistic `expectedVersion`, not an `Idempotency-Key`. The repository serializes purchase row/version, current authority, asset ownership, usability and lock state in transactions. Attach accepts only current-generation merchant-origin assets and a live placement, and appends history. Lock requires READY with all required assets still usable/unexpired. A repeated old-version write yields conflict; after an ambiguous response, reload the purchase before proposing another command. There is no unlock/overwrite/delete-attachment endpoint. [Request schemas](../../../packages/contracts/src/v1/purchase.ts#L98), [merchant provenance](../../../apps/web/src/server/purchase/service.ts#L208), [CAS and locks](../../../packages/database/src/repositories/purchase.ts#L810).

Purchase-specific artwork URLs can authorize an original guest upload through its retained purchase binding. Generic merchant asset lookup is not a replacement for this check. URLs have at most a five-minute lifetime, capped at actual asset expiry. SVG originals are downloadable; preview uses the raster derivative. [Purchase download/preview authority](../../../packages/application/src/purchase/artwork.ts#L61).

Reconcile only makes the existing current-installation cursor's next attempt due. Worker claims/windows and accepted economic facts remain separate. [Durable scheduling](../../../packages/database/src/repositories/purchase.ts#L389), [UI command](../../../apps/web/src/islands/PurchaseArtwork.tsx#L351).

Privacy request summaries contain `inboxId`, request ID, received/fulfill-by timestamps and requested/matched order counts. Export contains order, bindings, lines, designs, artwork events, payments, refunds and observations. SQL locks the shop against concurrent erasure, checks the active generation/requested order, rebuilds from current records and withholds expired design payload/expired event references. The set-specific route is the path that returns retained design payload. None of these GETs fulfills/delivers a request, triggers redaction or emits an email. The browser downloads JSON locally. [Privacy repository](../../../packages/database/src/repositories/customer-privacy.ts#L40), [actual export SQL](../../../packages/database/migrations/20261017000200_privacy_merchant_export.sql#L26), [browser downloads](../../../apps/web/src/islands/MerchantPrivacy.tsx#L165).

Purchase errors map NOT_FOUND to 404; CONFLICT/LOCKED/NOT_READY to 409; EXPIRED/ARTWORK_UNAVAILABLE to 410; invalid commands to 400; MERCHANT_REQUIRED to 403; unclassified dependency failure to 503. A bad list cursor/limit is 400. Unknown route is 404 and unsupported method is 405 within the exported router. [Error map](../../../apps/web/src/server/purchase/http.ts#L128).

## Implemented boundaries and unavailable controls

- Billing selection/cancellation belongs to the supported Shopify management URL. There is no local billing mutation, usage dashboard endpoint or refund/payment/inventory mutation API. The purchase view reports independently reconciled facts. [Billing implementation](../../../apps/web/src/server/admin/billing.ts#L6), [purchase router](../../../apps/web/src/server/purchase/http.ts#L74).
- Config create/save/copy/publish exist. Delete config, unpublish, bulk configuration/publication, merchant-created Shopify products and a library-wide apply-template command do not appear in the admin route exports/handler. [Admin route union](../../../apps/web/src/server/admin/http.ts#L6), [command dispatcher](../../../apps/web/src/server/admin/http.ts#L213).
- Order filtering is over loaded browser records; the purchase endpoint accepts pagination/limit, not status/search/filter/sort query contracts. A redesign must not imply a server-wide artwork-status result count. [Purchase query parser](../../../apps/web/src/server/purchase/http.ts#L77), [loaded-order filter](../../../apps/web/src/islands/PurchaseArtwork.tsx#L386).
- Privacy exposes list, manifest and linked exports. No manual erasure, completion/acknowledgement, arbitrary customer lookup, ZIP export or customer-delivery command is implemented in this merchant router. [Privacy route branch](../../../apps/web/src/server/purchase/http.ts#L54).
- Readiness observes configuration/Function state. No merchant readiness repair, scope-grant, Function installation or theme activation mutation is exported. Signing is a privately allocated support route with no current merchant control. [Readiness/signing dispatcher](../../../apps/web/src/server/admin/http.ts#L183).
- Source existence is conditional availability. Admin composition fails closed without required database/Shopify/app config. Billing also needs subscription policy/Partner configuration. Purchases need `INSIGNIA_M8_PURCHASE_ENABLED=1`; previews need qualified preview/storage composition; artwork needs private storage and isolated inspector readiness. Missing services return 503 rather than mock private data. [Admin runtime](../../../apps/web/src/server/admin/runtime.ts#L15), [purchase production](../../../apps/web/src/server/purchase/production.ts#L8), [artwork production](../../../apps/web/src/server/artwork/production.ts#L12).

## Adjacent routes excluded from merchant pair count

All 23 API source files were checked to avoid treating `/api/admin` as the entire merchant API. The nine excluded files are five guest-artwork routes, one versioned buyer catch-all, two webhook routes and one metrics route.

| Transport | Actual exposure | Why it is separate |
| --- | --- | --- |
| Guest artwork | GET `/api/artwork/guest/session`; POST `/api/artwork/guest`; POST `/api/artwork/guest/:assetId/complete`, `/status`, `/preview`. | App Proxy/session capability authority. No guest original-download route. [Session route](../../../apps/web/src/pages/api/artwork/guest/session.ts#L1), [guest upload](../../../apps/web/src/pages/api/artwork/guest/index.ts#L1), [shared audience gates](../../../apps/web/src/server/artwork/http.ts#L59). |
| Buyer flow | ALL Astro catch-all `/api/artwork/v1/[...route]`; recognized GET config, POST sessions/proposals/accept/renew/cart-confirm/cart-state, PUT designs. | Buyer capability/quote/design/cart flow, separate from merchant staff authentication and control panels. [Catch-all](../../../apps/web/src/pages/api/artwork/v1/[...route].ts#L1), [buyer router](../../../apps/web/src/server/buyer/http.ts#L43). |
| Shopify webhooks | POST `/api/webhooks/shopify`; POST `/api/webhooks/uninstall/:capability`. | Provider events and generation-bound uninstall capability, not merchant buttons. Uninstall path checks a 64-hex capability before forwarding its hash. [General route](../../../apps/web/src/pages/api/webhooks/shopify.ts#L1), [uninstall route](../../../apps/web/src/pages/api/webhooks/uninstall/[capability].ts#L1). |
| Internal metrics | GET `/api/internal/metrics`. | `INSIGNIA_METRICS_TOKEN` bearer required; absent config is 404, invalid bearer 403, dependency failure 503. Returns Prometheus metrics, not a merchant diagnostic API. [Route](../../../apps/web/src/pages/api/internal/metrics.ts#L1). |

## Evidence and remaining limits

This was a source investigation, with no provider calls, HTTP writes, native sign-in or runtime behavior changes. Existing tests were read as executable intent; they were not rerun for this prose-only appendix.

Relevant coverage includes command auth/origin/CAS/outcome handling, owner-only artwork/order permission derivation, method boundary validation, artwork ownership/processing/expiry, purchase reconciliation scheduling and denied writes, privacy download/recovery, and fixed signing no-retry/concurrency behavior. [Admin commands](../../../apps/web/test/admin/commands.test.mts#L71), [permission tests](../../../apps/web/test/admin/auth.test.mts#L208), [method HTTP](../../../apps/web/test/admin/methods-http.test.mts#L33), [artwork HTTP](../../../apps/web/test/artwork/http.test.mts#L47), [reconcile tests](../../../apps/web/test/purchase-request.test.mts#L44), [purchase CAS integration](../../../apps/web/test/purchase-flow.test.mts#L239), [privacy browser](../../../apps/web/test/admin/privacy-browser.test.mts#L8), [signing action](../../../apps/web/test/admin/signing-owner-action.test.mts#L49).

## Implications for the UI rebuild

The existing screens are evidence of current callers, not a design reference. The following are recommendations based on the contracts above, not additional implemented features.

- Keep product setup, draft save, publication progress/recovery and published effectiveness distinct. A successful save is not a live buyer configuration, and a 202 publish response may still require continuation or operator recovery.
- Make the supported purchase workflow discoverable: immutable order facts, retained historical design, original download, production attachment replacement, lock and reconciliation. Explain role or retention restrictions at the affected control, without implying an expired file can be restored.
- Keep private artwork/order/privacy access separate from ordinary product permissions. The current owner-only restriction is a backend fact; broader staff controls require an explicit authorization change, not a cosmetic enablement.
- Offer privacy downloads and the Shopify billing management link using their actual scope. Do not label export as customer delivery, billing refresh as subscription change, or technical readiness as release approval.
- Treat missing bulk operations, server-wide order search/filtering, config deletion/unpublication, unlock and privacy completion as product decisions. No endpoint in this inventory can power those controls today.

Current deployment, real staff permissions, provider response behavior and screen acceptance require separately scoped observation.
