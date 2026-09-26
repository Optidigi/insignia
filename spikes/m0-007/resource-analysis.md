# M0-007 policy projection resource analysis

The preferred two-field product candidate adds two `Product.metafield` selections and one `Product.id` leaf to each Function input query. Shopify calculates query cost from the selected fields **once**, independent of cart line count, and charges three points per metafield object and one per ordinary leaf. By counting every selected leaf in the checked-in queries, the candidate costs **20/30 Transform** and **23/30 Validation** query points. This is a documented-rules calculation, not a numeric cost response from Shopify. The pinned CLI successfully built/validated both queries; the separate runner validated all retained fixtures against the pinned schemas. Transform query length is **749 bytes**, Validation **818 bytes**.

`evidence/candidate-replay.json` is a deterministic execution of the rebuilt candidate Wasm with the pinned Shopify Function runner. It retains input/output SHA-256 values for each case; the exact schema-valid inputs are in `fixtures/`. The 200-line case has ten signed required lines and 190 plain optional lines. Additional 200/199/189-line cases place one pending managed line and one unmanaged line in the mixed cart, show checkout rejection while the damaged line remains, and show acceptance after removing it and after clearing the signed set. These are **synthetic** projections, not live catalogue or propagation evidence.

| Target, 10 signed + 190 ordinary | Wasm bytes | Input bytes | Output bytes | Instructions | Linear memory KiB |
|---|---:|---:|---:|---:|---:|
| Transform | 167,722 | 87,686 | 3,246 | 7,985,066 | 1,600 |
| Validation | 168,885 | 99,132 | 17 | 8,265,472 | 1,600 |

Both measured rows fit Shopify's up-to-200-line reference limits and the local 8.8M-instruction/16,000-output engineering target. The runner reports memory but not stack peak; live 200-line projection, concurrent Functions, production catalogue behavior and provider-returned numeric query cost are unverified. The prototype ten-bucket ceiling is inherited from M0-006 and is **not** a product capacity decision. The 32/64-signed stress fixtures return bounded rejection; the historical uncapped 64-bucket output failure remains retained.

Shopify's published Function reference limits for up to 200 cart lines are 256,000 compiled binary bytes, 10,000,000 linear-memory bytes, 512,000 stack bytes, 11,000,000 instructions, 128,000 input bytes and 20,000 output bytes. Queries are limited to 3,000 bytes and calculated cost 30. A metafield value larger than 10,000 bytes projects as `null` even when Admin API can read it. See [Function limits](https://shopify.dev/docs/api/functions/2026-07#limitations) and [metafield limits](https://shopify.dev/docs/apps/build/metafields/metafield-limits). These are reference ceilings, not proof of live capacity or a product-facing limit.

The rejected simple alternative is one shop metafield listing every managed product GID. `python3 -B spikes/m0-007/scripts/catalogue-size.py` serializes deterministic compact JSON with the installation generation and 11-digit synthetic Shopify product IDs:

| Products | Value bytes | Available to Function under 10,000-byte value threshold? |
|---:|---:|---|
| 1 | 110 | yes |
| 200 | 7,274 | yes |
| 1,000 | 36,074 | **no** |
| 10,000 | 360,074 | **no** |

This rules out a single unsegmented registry as a catalogue-scale trust anchor for this representation. Segmentation would need an independently proven product-to-segment lookup, bounded query cost, concurrent publication behavior and a failure policy. This package neither adopts segmentation nor imposes a catalogue cap. A Bloom filter has the distinct false-positive/false-negative trade-off and is not an implicit fix.

Shopify documents atomicity only **within one** `metafieldsSet` invocation and `compareDigest` compare-and-set support. It does not establish atomic propagation to both Function targets or a transaction with an application database. See [metafieldsSet](https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet) and [MetafieldsSetInput](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/MetafieldsSetInput). A publisher must journal intent, use digests, read back and wait for observed Function projection before treating the product as ready. Joint loss of both product fields still erases managed identity from the input and remains an adoption blocker.
