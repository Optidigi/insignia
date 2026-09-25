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

## Exact money and allocation seam

The fixed-vector allocator takes already-accepted unit minor prices and aggregate group setup minor units. It allocates `S div N` to every physical unit, then one extra minor unit to the first `S mod N` units in stable external variant-ID order and unit ordinal. It processes ranges and coalesces equal `(group, variant, unitMinor)` buckets; no per-garment object/signature. All inputs/outputs are checked integers and exact lexical decimals at adapters. The €91 vector has two units at 3033 minor and one at 3034; the 500-unit two-group plan vector totals 1,458,500 minor. This proof does not implement FX lookup, tiers or the merchant rule editor.
