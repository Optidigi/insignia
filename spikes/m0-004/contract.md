# Candidate cart authorization contract (M0-004)

This note applies the unchanged implementation plan §§4.5–4.6, 5 and 6.2 to fixed local vectors. The bytes are a **candidate**, pending G2/G3/G5 adjudication. No production key handling or shop configuration publication is implemented.

## Bytes and strict decoding

The token is unpadded canonical base64url of exactly 178 bytes: 114 payload bytes followed by a 64-byte ordinary Ed25519 signature. Sign exactly UTF-8/ASCII `Insignia\0CartAuthorization\0v1\0` followed by the 114 payload bytes. No prehash, context variant, JWT or JSON protocol. All integers are unsigned big-endian. UUIDs are 16 raw bytes. Reject any decoded length other than 178, unknown version/flags, invalid alphabet/padding/noncanonical tail bits and out-of-range integers.

| Offset | Width | Claim | Fixture representation | Independent comparison/source |
|---:|---:|---|---|---|
| 0 | 4 | magic `ISG1` | implicit | fixed parser constant |
| 4 | 1 | version `1` | implicit | accepted protocol list in trusted public config |
| 5 | 1 | reserved flags `0` | implicit | fixed parser constant |
| 6 | 2 | key ID | integer | trusted verification-key registry, not token-supplied key |
| 8 | 16 | installation generation UUID | hex | trusted per-installation public config |
| 24 | 4 | authorization epoch | integer | trusted per-installation public config |
| 28 | 16 | accepted quote UUID | hex | common across set; quote record lookup is outside offline Function scope |
| 44 | 16 | authorization-set UUID | hex | common across set; a renewal has a new set ID |
| 60 | 2 | quote-global bucket index | integer | unique complete `0..lineCount-1` |
| 62 | 2 | quote-global bucket count | integer | common, bounded by measured capacity |
| 64 | 8 | real variant numeric ID | decimal string | normalized actual physical line variant from target input |
| 72 | 4 | physical bucket quantity | integer | normalized actual physical line quantity from target input |
| 76 | 8 | pre-discount unit minor units | decimal string | independent observed materialized pre-discount amount where target schema proves it |
| 84 | 3 | uppercase currency ASCII | string | actual buyer/cart currency; supported versioned exponent table |
| 87 | 1 | currency exponent | integer | supported versioned currency table, not arbitrary claim |
| 88 | 2 | uppercase country ASCII | string | actual buyer country/context when available |
| 90 | 8 | market numeric ID | decimal string | actual market context when available; zero only for supported no-market case |
| 98 | 4 | valid-through shop-local day ordinal | integer | independently supplied shop-local current date; D through D+2 valid, D+3 expired |
| 102 | 4 | entire quote customized quantity | integer | checked sum of all normalized authorized physical buckets |
| 106 | 8 | entire quote pre-discount minor total | decimal string | checked sum of `quantity × unitMinor` over the complete set |
| 114 | 64 | signature | base64url/hex | strict Ed25519 verification using trusted key ID registry |

Fixture JSON uses decimal strings for u64 money, variant and market values so TypeScript never passes them through `Number`. It may use ordinary JSON numbers for u8/u16/u32 fields after safe-range checks. Expected payload/signature/token literals are immutable review data; tests never rewrite them automatically.

## Threat and set boundary

The buyer can edit/remove/reorder cart lines, all line properties and tokens, repeat a still-valid complete offer, change country/currency/market and attempt old or unknown keys. The verifier trusts only its explicit expected context, installed public key registry and target-normalized actual physical lines. It never treats a token's own claim as independent expected context. A single valid complete set is reusable during its bounded date window; replacing an accepted quote creates a new set ID. Missing, duplicate, extra, mixed-renewal or contradictory bucket claims fail closed. Required unsigned products fail; optional unmarked plain products remain plain only when independent policy says optional. Paid customization with a selling plan fails. Parent/group presentation does not count as an extra garment.

The pure verifier accepts an explicit `ExpectedContext` and actual normalized lines in the local harness. The target adapters must prove every claimed mapping against their pinned generated GraphQL schema. A field absent from the schema stays `UNSUPPORTED`; no harness-supplied value is described as observed Shopify input. The validator must compare an independently observed pre-discount materialized amount, not a transform-written success marker or token claim. Ambiguous amount/context rejects or records a target blocker.

## Target input provenance and unresolved mapping

Both committed generated target schemas declare `api_version = "2026-07"` in their extension TOML. The generated Transform schema SHA-256 is `6e8851bc6c53bb8dae6620b2a98082aac10f88a5015b7cc2b57a9a49dd2e1aa4`; the Validation schema SHA-256 is `4a782ed2a026b1f62a3c3466e0d9ddcc6b2e77e62a38feddfc524249fcf026f4`. The checked queries obtain line variant IDs, quantities, the reserved token attribute, selling-plan allocation, currency code, localization country/market and `shop.localTime.date` from target fields. They request `m0_004_public_config` on Shop and `m0_004_policy` on Product with omitted namespace, which the pinned schema defines as the app-reserved namespace. These are **synthetic app-owned config projections** in local fixtures; no real store metafields were created or queried. Key registry, generation, epoch and capacity come from that config, never from token claims. Current buyer context comes from localization and shop local time, never from the app config.

Validation uses a generated query custom scalar override to keep `cart.lines.cost.subtotalAmount.amount` as a lexical `String`, then checks exact divisibility by actual line quantity and compares the derived unit minor amount with the signed unit amount. The query and native/Wasm synthetic fixture prove that serialization path without `f64`. Shopify's public field description says the subtotal precedes discounts on **certain** items; it does not prove this field is always the pre-discount materialized child price after Cart Transform and every discount/market combination. The [Function execution order](https://shopify.dev/docs/api/functions/2026-07) places Validation after discount calculation. Live expanded-child representation and amount semantics therefore remain **UNVERIFIED**; these local fixtures cannot satisfy G6 or complete G5. If the amount is absent, ambiguous, nondivisible or mismatched, this adapter rejects. No alternate unsigned price source is accepted.

The Transform emits one same-variant child with an exact decimal string and one copied authorization token per signed parent bucket, after full-set verification. It does not independently check an observed materialized price, because its role is to set that price. The pinned local runner requires `shopify app function build` after Cargo compilation: the CLI postprocesses the SDK Wasm import ABI. A direct Cargo Wasm file is not a working runner artifact in this environment. Parent/child normalization and token transport through actual checkout remain later live proof obligations.

This local proof tests current-key overlap and expiry, but does not implement per-key rollout validity windows, shop installation reconciliation, public-app qualification or a product-facing capacity setting. The measured instruction boundary is recorded in the evidence and requires principal adjudication before a supported capacity can be set.

## Exact money and allocation seam

The fixed-vector allocator takes already-accepted unit minor prices and aggregate group setup minor units. It allocates `S div N` to every physical unit, then one extra minor unit to the first `S mod N` units in stable external variant-ID order and unit ordinal. It processes ranges and coalesces equal `(group, variant, unitMinor)` buckets; no per-garment object/signature. All inputs/outputs are checked integers and exact lexical decimals at adapters. The €91 vector has two units at 3033 minor and one at 3034; the 500-unit two-group plan vector totals 1,458,500 minor. This proof does not implement FX lookup, tiers or the merchant rule editor.
