# M0-005 whole-quote candidate contract

This is an isolated, off-store experiment. The approved per-line M0-004 protocol remains intact. The principal must adjudicate any protocol change before adoption. The test seam is the complete accepted set at the TypeScript issuer, Rust verifier, and each complete Function target.

## Signed bytes and quote identity

Ordinary Ed25519 signs exactly `Insignia\0WholeQuoteAuthorization\0v2\0 || header || records`, without prehash. The header is 92 bytes; each record is 22 bytes. Integers are unsigned big-endian. The fixed domain, `ISG2` magic, version 2 and zero flags cannot parse as M0-004's `ISG1` per-line token. All base64url carriers use the canonical unpadded alphabet and exact decoded lengths. The verifier checks count and carrier lengths before allocation or signature work.

| Header byte offset | Width | Claim |
|---:|---:|---|
| 0 | 4 | `ISG2` raw bytes |
| 4 | 1 | Version 2 |
| 5 | 1 | Reserved flags 0 |
| 6 | 2 | Trusted-registry key ID |
| 8 | 16 | Installation generation UUID |
| 24 | 4 | Authorization epoch |
| 28 | 16 | Immutable accepted quote UUID |
| 44 | 16 | Authorization set UUID; renewal uses a new set |
| 60 | 2 | Complete member count |
| 62 | 3 | Uppercase presentment currency |
| 65 | 1 | Trusted-table currency exponent |
| 66 | 2 | Uppercase buyer country |
| 68 | 8 | Market numeric ID |
| 76 | 4 | Valid-through shop-local ordinal E |
| 80 | 4 | Total customized physical quantity |
| 84 | 8 | Total pre-discount minor units |

Each record is `index:u16 || realVariant:u64 || quantity:u32 || allocatedUnitMinor:u64`. The signer serializes records in ascending quote-global index order `0..count-1`; the verifier reconstructs that order from the complete cart set, independent of cart enumeration. The index names the corresponding bucket in the persisted immutable accepted quote, whose design/group/revision association is an issuer obligation. Mutable artwork, client text and cart-supplied descriptions do not authorize purchase. The offline Functions can check the signed economic bucket, but cannot query that historical quote.

All quantities and variant IDs are positive; every sum and product is checked within the format's widths. Currency, exponent, country, market, generation, epoch, day and key registry are independently supplied to **each** Function. E is accepted only when independent current day is in inclusive `E-2..E`. The complete set is reusable inside that interval. No member, common field or total is trusted until the ordinary Ed25519 signature over the **entire reconstructed message** passes strict verification with an admitted nonweak trusted key. Both Functions reject missing/extra/duplicate indices, conflicting envelopes, changed physical variant/quantity/context and selling plans. Validation independently checks observed pre-discount merchandise amounts. Required unsigned lines reject when the independent product policy says required; absence of that policy remains a named enforcement gap.

## Synthetic carrier hypothesis and schema mapping

The preferred carrier is cart attribute `_insignia_quote_v2` containing canonical base64url of `header || signature` (156 raw bytes, 208 ASCII characters), plus line attribute `_insignia_member_v2` containing canonical base64url of one 22-byte record (30 ASCII characters). These are untrusted inputs. The Function reconstructs the ordered message from **all** marked physical lines. The 64-byte signature is shared, not copied into every record. Header without members, members without header and a marker with missing/empty value reject. Old `_insignia_auth` tokens are not upgraded.

Both pinned 2026-07 generated input schemas expose `cart.attribute(key:)` and `cart.lines.attribute(key:)`. Transform's query reads both before expansion; its `lineExpand` emits the same real variant, one child, relative quantity 1 and price, and copies the compact member attribute. Validation's query reads the cart envelope and physical child records after expansion in synthetic fixtures. The shared cart attribute's actual survival through checkout and the child's representation/price are **unverified live Shopify behavior**. A schema-valid query and synthetic fixture are not evidence of propagation. If the preferred carrier proves schema-inexpressible locally, at most one alternate shared carrier may be tried with explicit obligations.

Shop public config metafield provides the trusted registry, generation, epoch and test capacity. Shop localTime/date and localization provide independent buyer context. Product policy metafield distinguishes known-required from optional. Actual variant ID and quantity come from normalized physical lines. Validation uses `cart.lines.cost.subtotalAmount.amount` as a lexical decimal string; its universal pre-discount meaning after Transform remains unverified. The complete JSON output, including real-length IDs, names, values, prices and overhead, is measured against current reference limits.

## Work and evidence dependencies

1. Integrator owns this contract, pinned fixture expectations, package locks, CI, measurement driver and delivery state. Baseline M0-004 source/evidence remains immutable.
2. TypeScript writer owns `spikes/m0-005/ts/**` and TypeScript tests. Implement canonical issue/decode, independent fixture literals and strict-key profile. Use the existing allocator through explicit import for exact-money controls.
3. Rust writer owns `spikes/m0-005/rust/**` and `spikes/m0-005/extensions/**`, plus their tests and target queries. Rust must consume the agreed bytes and fixtures; both full target adapters independently call complete-set verification.
4. Integrator runs cross-language, target, adversarial and full resource checks, captures final artifact hashes/results, obtains fresh read-only Spec and Standards/security reviews, resolves findings and publishes one outcome PR.
