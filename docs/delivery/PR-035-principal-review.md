# PR #35 — external principal review

**Verdict: APPROVED for merge at the M5-007R4 documentation/evidence scope.**

## Exact binding

- Repository / PR: `Optidigi/insignia` / #35
- Branch: `feat/m5-007r4-config-capture`
- Base / effective merge base: `9dc728b21d58a1687fae7221e64225373bbbbecb`
- Approved head: `39fce0b00b625fe0f5869058ec44093213a4ffc5`
- Approved tree: `f4fd4ed878547bb17d96d3b3187c7d125dd4abd1`
- GitHub state at review: open, non-draft, unmerged, mergeable
- Native GitHub reviews: none

The reviewed change is documentation/evidence only. Production source, dependencies, migrations, operative app configuration and architecture are unchanged.

## Accepted evidence

The three corrected official CLI operations ran once each and exited 0. The before/after version observations identify active `insignia-1`, `gid://shopify/Version/1146748534785`.

The initially empty capture directory produced transformed configuration with:
- exact designated client;
- required scopes empty;
- optional scopes empty;
- `use_legacy_install_flow = false`;
- `application_url = https://example.com`;
- `embedded = true`;
- empty redirects;
- webhook API `2026-07`.

The generated TOML is accepted only as CLI-transformed configuration evidence. It is not a raw server payload, proof of current effective grants, or a released-extension manifest.

The command-1 local checker initially compared a numeric ID to the equivalent Shopify Version GID. The CLI command itself exited 0 and returned the exact expected resource. The preserved adjudication accepts only those two exact spellings. This does not represent a provider retry or different version.

All ten exact-head pull-request workflows were independently observed as completed/success; GitHub records attempt 1 on the final head. The supplied fresh scoped GPT-6.1-sol/high Spec and Standards/security reviews report no findings. They remain supporting local reviews, not native approval.

## Principal refinement of the proposed remedy

The report proposes restoring the historical nine development handles. That proposal is **not adopted as written**.

Shopify's current access-scope guidance states that a write scope includes its corresponding read scope. The immediate blocked qualification needs product reads plus `productCreate`/`productUpdate`, for which `write_products` is the relevant mutation scope. The next development access change therefore starts with only `write_products`.

This is a temporary development qualification scope, not the final production scope catalog. Additional scopes are added only when their owning feature requires them.

## Next slice

M5-008 is a bounded development product-access restoration using the Dev Dashboard app-version creation path. Shopify documents that a version created from the Dev Dashboard version-create page includes the configuration on that page plus the extensions in the current active version. This is preferred over CLI deploy because CLI deploy would use the local extension tree.

M5-008 may create a new version from the current active version, changing only required scopes from empty to `write_products`. Release is conditional on pre-release verification and a read-only impact check establishing no external merchant installation is affected. Post-release verification is limited to exact scope/version facts.

PR #35 approval is not M5 completion, gate acceptance, RELEASE_BOUND authority, or M6/M7 authorization.
