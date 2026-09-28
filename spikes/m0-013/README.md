# M0-013 — off-store whole-quote capacity candidate

This directory is a local investigation of the provisional v2 whole-quote
protocol. It does not select a production protocol, merchant limit, Shopify
configuration, or development-gate result. The exact M0-006 Function source,
M0-007 policy projection and M0-005 verifier are materialized in `rust/`;
see the measurement manifest and source notes for their fixed refs and
local changes. Earlier source and receipts remain in their original paths.

## Run

From the repository root, with Node 24.21.0, pnpm 12.6.0 and Rust 1.98.1
plus `wasm32-unknown-unknown`:

```sh
(cd spikes/m0-005 && corepack pnpm install --frozen-lockfile)
(cd spikes/m0-013 && corepack pnpm install --frozen-lockfile)
bash spikes/m0-013/scripts/check-local.sh
```

The suite checks frozen historical records, shared TypeScript encoding,
strict admission TypeScript, native Rust and both full Function Wasm
targets, then replays the complete local measurement matrix. It makes
no authenticated provider call. The GitHub workflow performs the same
suite and retains exact executables, inputs, expected/actual outputs
and resource manifests as a downloadable artifact.

## Candidate boundary

`ts/admission.ts` is a server-side prototype seam. It allocates the
*entire* accepted customized subset using the unchanged exact-money
allocator, counts resulting price buckets, counts coexistence with
ordinary cart lines, checks physical quantity and conservative
serialized-output size, and declines an over-boundary proposal
before calling the v2 signer. It does not split a quote or alter prices.
The associated full Functions independently verify the complete signed
statement and enforce their own local input and field bounds.

The projection is trusted server data, not a buyer claim. The backend
can know accepted group/variant quantities, allocated prices and
bucket count exactly at issuance. Input byte projections require a
controlled view of the full cart, policy fields, current IDs and the
serialized Function query shape. A buyer/cart edit, platform-generated
field, policy/authorization change or another app invalidates that
projection. Shopify may reject an oversized input before either
Function executes; this helper does not solve that platform boundary.
Runtime Validation and repair remain necessary even after admission.
Ordinary carts with no Insignia-managed line retain their ordinary path.

The tested envelope, each separate Function limit/headroom and its
residual stack question are recorded in the measurement narrative and
manifest. Resource results bind to exact binaries and input/output
hashes. A local profile is evidence for the measured shapes only: it
is not a universal per-line instruction formula and cannot authorize
live publication or checkout without a subsequent reviewed public-app
proof.

## Later public-app evidence manifest (draft only)

A separately authorized public-app proof would record: exact app/shop
GIDs and distribution/store plan; released or dev Function version IDs
and hashes; key generation/epoch; product/variant/policy generation and
readback; candidate profile and projected versus actual cart input
shapes; both Function runtime outcomes and checkout/order preservation;
pre-discount accepted versus observed exact money; ordinary-line
coexistence; required-product wrong-economics rejection and repair;
native order/fulfillment/refund/restock receipts; resource counters
where exposed; cleanup/holding state. Every observation would carry
time, operator/source and a sanitized artifact hash. This file is a
manifest template, not evidence that those actions occurred.
