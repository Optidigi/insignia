# Whole-quote v2 wire contract

This document owns exact authorization bytes and carrier semantics. The [current specification](implementation-plan.md) owns product behavior and acceptance; [current state](../delivery/state.md) owns qualified contexts and remaining work. Original adoption is preserved at [the pre-closeout record](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/architecture/WHOLE-QUOTE-V2-ADOPTED.md). Adoption grants neither deployment nor universal merchant capacity.

## Frozen wire contract

The following are now the single production authorization protocol for the rewrite:

- domain: `Insignia\0WholeQuoteAuthorization\0v2\0`;
- magic: `ISG2`;
- version: `2`;
- flags: `0`;
- header: 92 bytes;
- member record: 22 bytes;
- shared cart carrier: `_insignia_quote_v2`;
- per-physical-line carrier: `_insignia_member_v2`;
- ordinary Ed25519 over domain + exact header + complete ordered member set;
- canonical unpadded base64url;
- complete-set quote-global indices;
- real variant u64 + physical quantity u32 + allocated unit minor u64;
- installation authorization-generation UUID bytes;
- u32 authorization epoch;
- accepted quote UUID and authorization-set UUID;
- presentment currency + exponent;
- buyer country + Shopify Market numeric ID as context lock;
- inclusive shop-local D..D+2 valid-through day;
- total customized physical quantity and total pre-discount minor units;
- independent complete-set verification by both Transform and Validation;
- Transform materializes one same-real-variant child at signed unit price;
- Validation independently checks complete set and observed pre-discount economics.

No per-line v1 fallback is part of the rewrite runtime. Historical v1 evidence remains archived only.

Any incompatible change to these signed bytes, carrier semantics or field meanings requires an explicit new protocol version and owner decision.

## Current implementation admission profile

The current issuer/Function implementation retains these conservative guards:

- at most 32 customized price buckets;
- at most 10,000 customized physical units;
- current <=200-line admission/reference profile;
- 16,000-byte internal Transform-output target.

These are **engineering admission guards, not merchant/product-plan limits**.

They may be changed under the same v2 wire only after source-bound Function/resource evidence demonstrates the new implementation bound. A changed merchant-facing supported profile still requires owner acceptance.

The historical 64-bucket output failure remains evidence that arbitrary wider sets cannot simply be assumed safe.

## Remaining resource qualification

Stack peak remains unmeasured. Shopify’s [2026-07 Function resource limits](https://shopify.dev/docs/api/functions/2026-07#fixed-limits) specify a 512 kB stack limit in addition to binary, linear-memory, instruction, input and output limits.

Therefore:

- stack measurement or a defensible artifact-specific upper bound remains required before supported-profile release acceptance;
- the current 32-bucket case is not a universal capacity claim;
- live 200-line/supported-profile qualification remains later work;
- release artifacts must be remeasured.

This residual does not require leaving the byte protocol itself provisional.

## Currency table

The current versioned supported-currency exponent table is adopted as the initial v2 implementation support matrix, not as part of the immutable byte layout.

Changing admitted currencies/exponents requires synchronized TypeScript/Rust/Function updates and resource regression. Unknown or ambiguous currencies continue to fail closed.
