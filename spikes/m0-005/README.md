# M0-005 local whole-quote feasibility candidate

This isolated experiment tests one ordinary Ed25519 signature over a complete accepted customized quote. The approved M0-004 per-line candidate, its source and failed capacity evidence remain untouched. The architecture plan and decision ledger are unchanged. The [candidate contract](contract.md) fixes distinct v2 bytes and untrusted carriers; the [draft decision proposal](draft-decision-proposal.md) is for principal adjudication, not adoption.

The TypeScript issuer signs one canonical ordered statement and reuses the existing M0-004 exact-money allocator. Rust reconstructs the complete statement from a shared cart attribute and compact physical-line records. Both complete Function targets call its whole-set verifier independently. Transform emits same-real-variant, one-child, relative-one fixed prices only after authentication. Validation separately checks the exact observed unit amount derived from lexical subtotal strings. The shared [Python vector](fixtures/check-vectors.py) is checked against TypeScript and Rust tests.

Run from this directory with the pinned local dependencies and Rust 1.98.1 on `PATH`:

```sh
python3 fixtures/check-vectors.py
./scripts/check-local.sh
```

The Python check uses `cryptography` 46.0.5 and is a local independent vector check; CI runs TypeScript, Rust, both CLI Wasm builds and the full synthetic runner. The CLI postprocesses the Rust SDK Wasm artifact for the runner, so measure the CLI-built file. Local linker setup and exact commands are recorded in [evidence](evidence/README.md).

The preferred carrier is schema-expressible in pinned 2026-07 Function queries. Actual cart-attribute propagation through checkout, child representation, post-Transform pre-discount subtotal semantics, numeric query cost, stack peak and product-policy rollout are unverified. No merchant API call or Shopify mutation occurred. [Shopify's published limits](https://shopify.dev/docs/api/functions/latest#limitations) and [execution order](https://shopify.dev/docs/api/functions/latest) are reference constraints; synthetic runner success is not store qualification.
