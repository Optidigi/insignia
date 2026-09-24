# M0-001 staging activation and cleanup transcript

These are the nonsecret result fields observed from Shopify CLI 4.8.2 using
`shopify app execute --path . --client-id 942e6668fd1177524c0fc48b104b0ac3
--store insignia-staging.myshopify.com --version 2026-07`. The activation
responses below were transcribed from this execution's CLI output after the
preview ended; they are not a fresh replay or a signed Shopify audit log.
[`post-cleanup.json`](post-cleanup.json) is a direct `--output-file` response
captured after cleanup, with only the fields in its query and no redaction.
Neither file contains credentials, cookies, cart keys or buyer data.

## Identity and precondition

Before mutation, `shopify store info --store insignia-staging.myshopify.com
--json` returned `gid://shopify/Shop/78935261342`, organization `212732011`,
type `dev`, plan `basic`. App-specific `shop { id myshopifyDomain currencyCode }
currentAppInstallation { id accessScopes { handle } }` returned the same shop,
`USD`, installation `gid://shopify/AppInstallation/781307904158`, and an empty
scope list. An app-specific `cartTransforms(first: 10)` query after preview
reauthorization returned `nodes: []` before activation.

`shopify app dev --path . --client-id 942e6668fd1177524c0fc48b104b0ac3
--store insignia-staging.myshopify.com` displayed the designated app and
store, a staging-only URL override prompt, and then `Ready, watching for
changes in your app`. It reported auto-granted scopes
`read_cart_transforms, read_locations, write_cart_transforms,
write_inventory, write_products`. The subsequent app-specific read also showed
`read_inventory` and `read_products`. The preview log printed
`APP_UNINSTALLED webhook delivery failed`; the app-specific API continued to
return the same installation ID. No version release or distribution choice
was made.

## Function and transform

The app-specific `shopifyFunctions(first: 20)` result after preview included:

```json
{"id":"01a0d577-84c9-7b97-abb9-e5be7ef3fd2b","handle":"m0-001-same-variant","apiType":"cart_transform","apiVersion":"2026-07","appKey":"942e6668fd1177524c0fc48b104b0ac3"}
```

`cartTransformCreate(blockOnFailure: true, functionHandle:
"m0-001-same-variant", metafields: [...])` returned:

```json
{"cartTransform":{"id":"gid://shopify/CartTransform/143098014","functionId":"01a0d577-84c9-7b97-abb9-e5be7ef3fd2b","blockOnFailure":true,"metafield":{"id":"gid://shopify/Metafield/70423168090270","type":"json"}},"userErrors":[]}
```

An independent `cartTransforms` readback returned exactly that transform. Its
`metafield(namespace: "insignia_m0_001", key: "fixture") { jsonValue }` was:

```json
{"allowedVariantIds":["gid://shopify/ProductVariant/50529053343902","gid://shopify/ProductVariant/50529054163102"],"unitPrice":"30.00","currency":"USD"}
```

The readback establishes only activation and stored configuration. It does not
show any real cart invocation or validate the materialization hypothesis.

## Fixture and cleanup

`productCreate` returned product `gid://shopify/Product/10294344482974`,
handle `insignia-m0-001-fixture-20260924`, status `DRAFT`, first Black/Small
variant `gid://shopify/ProductVariant/50529053343902` and inventory item
`gid://shopify/InventoryItem/52644294131870`, with `userErrors: []`.
`productVariantsBulkUpdate` set that variant to `20.00`, SKU
`INS-M0-001-BLK-S`, tracked/shipping-required/DENY; `productVariantsBulkCreate`
returned Black/Medium variant `gid://shopify/ProductVariant/50529054163102`,
inventory item `gid://shopify/InventoryItem/52644294951070`, `20.00`, SKU
`INS-M0-001-BLK-M`, tracked/shipping-required/DENY, `userErrors: []`.
`productUpdate` then returned status `ACTIVE`, `userErrors: []`; a read returned
`onlineStoreUrl: null`. No location quantity or channel publication was set.

`cartTransformDelete(id: "gid://shopify/CartTransform/143098014")` returned
`deletedId: "gid://shopify/CartTransform/143098014"`, `userErrors: []`.
`productUpdate` on that exact product returned `ARCHIVED`,
`onlineStoreUrl: null`, `userErrors: []`. The preview process was quit and
`shopify app dev clean --path . --client-id 942e6668fd1177524c0fc48b104b0ac3
--store insignia-staging.myshopify.com` exited 0, reporting that the preview
stopped and the active app version was restored. A post-cleanup app-specific
query produced the linked direct JSON response: zero Cart Transforms, the
same app installation and scopes, archived product, two real variants, and
zero available/committed/on-hand units. `app versions list --json` still had
`insignia-2` active and `insignia-1` inactive. No cart or order was created.

The storefront returned HTTP 200 at `/password`; the agent's collaborative
Admin browser had a Shopify login page. No authenticated native publication,
storefront checkout, fulfillment or refund path was available during this run.
