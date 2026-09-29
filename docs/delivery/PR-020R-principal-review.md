# PR #20 principal re-review — APPROVED

## Review binding

- Repository: `Optidigi/insignia`
- PR: `#20`
- Base/effective merge base: `a467afcce5f0324a13fd3bfe647d3543eae159a4`
- Approved head: `a4a8a6e59a34908d4c7e74ec1496efcda5a3131c`
- Approved tree: `65f81b57fe4a9fbbec2ef48118db33a9297e3748`

This supersedes the earlier CHANGES_REQUESTED verdict.

## R1 closure — executable domain purity

The normal root boundary path now combines dependency/import checks with a syntax-aware scan over every compiled production domain module.

The production domain TypeScript config uses ES2022 libraries and no ambient `types`. The boundary scanner rejects representative implicit clocks, randomness, network/environment access, aliases, computed access, import-meta/dynamic import, and external static/type imports that enter the compiled program.

Permanent tests cover those rejected shapes while deterministic Money operations remain valid.

This is a deliberately scoped guard, not a general JavaScript sandbox. That is appropriate for the M1 boundary requirement.

## R2 closure — real Polaris component interaction

The localhost browser test now requires:
- `customElements.get('s-button')`;
- an actually upgraded `s-button` instance;
- a public boolean `disabled` property;
- successful Preact interaction only after that readiness condition.

The blocked-library control proves an unknown but clickable `<s-button>` no longer satisfies the acceptance criterion.

The checked Polaris snapshot is hash-pinned and used only to serve the documented CDN bytes deterministically in localhost testing. The application page still references the public CDN URL. This remains local component evidence, not live Admin/CDN evidence.

## Final-head verification

Final-head workflow `36564123743` passed and the seven retained applicable workflows passed:
`36564123857`, `36564123635`, `36564123774`, `36564123658`,
`36564123634`, `36564123733`, `36564123666`.

The foundation CI executed the corrected boundary suite and the real Polaris/Preact browser test.

Reported CI final Wasm hashes:
- Transform: `fd75b35d0a934ba7176884ec540e51068d751e2713e78d7cb1717319929f773f`
- Validation: `07598a246f6cbe401f849193489ab3c1bef48493f740a7784ce6791be5629355`

The native GitHub APPROVE attempt returned HTTP 403 and was not posted. This file is the external principal verdict.

## Acceptance

M1-001 is accepted at its intended foundation scope:
- reproducible pnpm/Cargo workspaces;
- exact toolchain and dependency pins;
- executable import/browser/domain boundaries;
- minimal Astro/Preact/Polaris, storefront Custom Element and worker surfaces;
- current-source experimental Function builds and regression checks;
- artifact-bound CI.

It does not:
- adopt experimental v2 as production protocol;
- adopt a merchant capacity;
- pass G1-G8;
- establish durable DB/queue readiness;
- establish live Admin/CDN behavior;
- authorize Shopify/provider mutations;
- authorize M2 merge.
