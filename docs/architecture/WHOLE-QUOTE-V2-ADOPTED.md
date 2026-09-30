# Whole-quote v2 production protocol adoption

## Decision

**ADOPTED for production implementation after the exact approved merge of PR #25.**

This closes the long-running provisional status of the whole-quote v2 wire/semantic contract. It does not declare the current capacity profile production-qualified for every merchant/cart and does not authorize deployment.

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

Any incompatible change to these signed bytes, carrier semantics or field meanings requires an explicit new protocol version and principal decision.

## Current implementation admission profile

The current issuer/Function implementation retains these conservative guards:

- at most 32 customized price buckets;
- at most 10,000 customized physical units;
- current <=200-line admission/reference profile;
- 16,000-byte internal Transform-output target.

These are **engineering admission guards, not merchant/product-plan limits**.

They may be changed under the same v2 wire only after source-bound Function/resource evidence demonstrates the new implementation bound. A changed merchant-facing supported profile still requires principal acceptance.

The historical 64-bucket output failure remains evidence that arbitrary wider sets cannot simply be assumed safe.

## Remaining resource qualification

Stack peak remains unmeasured. Shopify currently publishes a 512 kB stack limit in addition to binary, linear-memory, instruction, input and output limits.

Therefore:

- stack measurement or a defensible artifact-specific upper bound remains required before M7 supported-profile acceptance and again at M10 release qualification;
- the current 32-bucket case is not a universal capacity claim;
- live 200-line/supported-profile qualification remains later work;
- release artifacts must be remeasured.

This residual does not require leaving the byte protocol itself provisional.

## Currency table

The current versioned supported-currency exponent table is adopted as the initial v2 implementation support matrix, not as part of the immutable byte layout.

Changing admitted currencies/exponents requires synchronized TypeScript/Rust/Function updates and resource regression. Unknown or ambiguous currencies continue to fail closed.

## Governance amendment

The next authorized PR must update the current v1.3 plan/decision ledger to a narrow v1.4 governance state that:

- records v2 as the adopted rewrite authorization protocol;
- removes obsolete `v2 remains provisional` wording;
- preserves every original G1-G8 criterion;
- preserves current capacity/stack/live-profile qualifications;
- does not mark G2/G3/G5 or any other gate complete merely because the protocol is adopted;
- preserves old v1.1/v1.2/v1.3 hash/history checks rather than rewriting history.

Current pre-amendment v1.3 hashes remain:
- implementation plan: `b730c0dc274af8180a9aae3290189a8fd61b6b92e06681d345fe5d9aab22c06d`
- decision ledger: `d4297182b12978822dae124a040a0d47aafcdb7749f7ad8602f0626e964937e9`.
