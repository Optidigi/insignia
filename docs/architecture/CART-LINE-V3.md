# Cart-line v3 wire contract

This document owns the exact authorization bytes and carrier semantics of the current protocol. The [specification](implementation-plan.md#5-signed-cart-authorization-protocol) owns product behavior; [current state](../delivery/state.md) owns qualified contexts and remaining work. [Whole-quote v2](WHOLE-QUOTE-V2-ADOPTED.md) is historical: it is no longer issued or accepted at checkout, and purchase reconciliation verifies it permanently for historical orders.

Adopted by the owner on 10 November 2026: each customized cart line carries its own authorization; quantity is not signed; one acceptance (one signed set) per cart; single cutover with no dual-format Function. Adoption grants neither deployment nor merchant capacity.

## Bytes

All integers are big-endian. Encoding is canonical unpadded base64url; alternate alphabets, padding, non-zero trailing bits and any other length are rejected.

**Signed header H, 113 bytes**

| Offset | Bytes | Field | Rule |
|---|---|---|---|
| 0 | 4 | magic | `ISG3` |
| 4 | 1 | version | `3` |
| 5 | 1 | flags | `0` |
| 6 | 2 | key ID | installation key registry (as v2) |
| 8 | 16 | authorization generation UUID | equals Function configuration |
| 24 | 4 | authorization epoch | equals Function configuration |
| 28 | 16 | accepted quote UUID | |
| 44 | 16 | authorization set UUID | new for every issue and renewal |
| 60 | 1 | line count `n` | 1..32 |
| 61 | 1 | proof depth `d` | exactly `ceil(log2 n)`; 0 when `n = 1` |
| 62 | 3 | presentment currency | uppercase, in the currency table |
| 65 | 1 | exponent | matches the currency table |
| 66 | 2 | buyer country | uppercase |
| 68 | 8 | Shopify Market numeric ID | `0` only where configuration allows no Market |
| 76 | 4 | valid-through shop-local day | Unix day ordinal, issuance day D + 2 |
| 80 | 32 | Merkle root | below |
| 112 | 1 | reserved | `0` |

**Signature S, 64 bytes:** ordinary Ed25519 with strict verification over `"Insignia\0CartLineAuthorization\0v3\0" || H`. The v2 domain differs, so no signature crosses protocols.

**Line record R, 17 bytes:** line index u8 (`< n`, the quote-global index of the accepted economics line), real variant ID u64 (non-zero), pre-discount unit price in minor units u64.

**Carrier** (cart line property `_insignia_line_v3`): `base64url(H || S || R || proof)`, where `proof` is `d` sibling hashes of 32 bytes, leaf to root. `H || S` is 177 bytes, so its 236-character encoding (the *prefix*) is identical on every line of a set and the tail encodes independently. Lengths are exact: 259, 302, 344, 387, 430 or 472 characters for `d = 0..5`.

**Child reference** (`_insignia_ref_v3`, written by Transform on the expanded child): `base64url(set UUID || index)`, 23 characters. Order reading takes the full carrier from the parent line-item group and requires the child reference to match it.

## Merkle construction

- Hash: SHA-512/256.
- Leaf: `HASH(0x00 || "Insignia\0CartLine\0v3\0" || R)`.
- Inner node: `HASH(0x01 || left || right)`.
- Padding slot: `HASH(0x02 || "Insignia\0CartLine\0v3\0")`.
- A complete tree over `2^d` slots; slot `i` holds leaf `i` when `i < n`, otherwise the padding hash. Bit `k` of the index selects the side at level `k`.

The tags separate leaves, nodes and padding (no second preimage between roles). Because the index is inside the signed leaf and must be below the signed count, a padding slot is never claimable, and the signed count fixes the proof length.

## Verification

Both Functions, independently, once per cart:

1. Lines carrying `_insignia_line_v3` are the customized lines. A line still carrying a v2 marker is an invalid carrier. No marker anywhere: the ordinary product-policy path; a leftover v2 cart attribute is ignored.
2. From the first customized line: decode the prefix; check magic, version, flags, reserved byte, count, depth, currency/exponent and uppercase country; check generation, epoch, currency, country, Market and `current ≤ validThrough ≤ current + 2`.
3. Every customized line must carry the byte-identical prefix (one set per cart) and the exact length the depth implies. Per line: canonical tail, `index < n`, index unique in the cart, signed variant equals the real variant, no selling plan, Merkle inclusion reproduces the signed root, and (Validation) the observed pre-discount unit (`subtotal / quantity`, exact) equals the signed unit.
4. The key must be admitted for the current day; verify the signature exactly once.
5. Plain engineering bounds, not signed claims: at most 32 customized lines, at most 10,000 customized units (configuration, capped by the compiled constant), at most 200 cart lines, the Transform output bound, checked `unit × quantity` and running sums.

Transform remains all-or-nothing: any failure returns no operations. Validation rejects at checkout steps and allows cart interaction so repair stays possible.

Purchase reconciliation verifies independently: the stored set's prefix and carriers, the historical key fingerprint and revocation, one signature, inclusion, unique index, economics line product/variant, signed unit equals the order's original unit price, no selling plan, `1 ≤ quantity ≤ 10,000` per line and in total, `1 ≤ lines ≤ n`, context, installation window and `D ≤ order day ≤ D+2`. The ordered quantity is recorded; a subset of the quote is admitted.

## Issuance

The server signs only linear Lean economics: no setup allocation, no quantity-selected component, one bucket per design and variant, and `line total = quantity × unit`. Anything else is refused before signing, so quantity-dependent pricing can never be signed as if it were linear. The Designer still accepts the complete customized subset of the cart as one set on every Add, and renewal re-signs every line of the original accepted request as a new set.

## Guarantees that changed (owner-accepted, 10 November 2026)

1. The signature binds neither quantity, line totals, set totals nor total units. Checkout charges the signed unit × the cart quantity; the buyer-reviewed total is not enforced at checkout.
2. Completeness is gone: any subset of an accepted quote can be bought, and removing one line leaves the others valid.
3. The 10,000-unit, 32-line and 200-cart-line caps are plain Function bounds, not signed claims.
4. Quantity-dependent pricing (tiers, minimums, setup, volume discounts) cannot be expressed; reintroducing it needs a new protocol. The issuer refuses non-linear economics.
5. Production quantities come from the order (purchase lines). The accepted quote is reviewed-offer evidence.
6. Offer reuse widens: until D+2 a valid set prices any subset and quantity of its lines, for the same variants, designs, unit prices and context. It is never cheaper and never longer.
7. Carriers grow from 30 characters per line (plus a shared 208-character envelope) to 259–472 characters per line, and the Merkle construction is new security-relevant code covered by shared TypeScript/Rust vectors.
8. Transform pricing stays all-or-nothing for an abnormal cart; with "one set per cart" it is the only remaining cross-line coupling.
9. Single cutover: Functions accept v3 only. A cart still holding v2 carriers at checkout is rejected like any invalid carrier and repaired through the Designer.

Retained: strict Ed25519; generation and epoch; currency, country and Market lock; D..D+2 shop-local expiry and key windows; real variant; observed pre-discount unit price (Validation); selling-plan ban; required-product enforcement; duplicate rejection; one set per cart; independent verification by both Functions and by reconciliation; installation-scoped keys.

## Implementation owners and vectors

- TypeScript: `packages/cart-authorization/src/line-v3.ts` (issuer, decoder, set verifier, linearity).
- Rust: `crates/cart-authorization/src/line_v3.rs` (`verify_lines_v3`).
- Shared vectors: `packages/cart-authorization/fixtures/cart-line-v3.json`, generated by the production issuer (`generate-line-v3-vectors.mts --check`); both languages run every positive case and every negative vector, and Rust asserts the exact rejection rule.

Any incompatible change to these bytes, carrier semantics or field meanings requires a new protocol version and an owner decision.
