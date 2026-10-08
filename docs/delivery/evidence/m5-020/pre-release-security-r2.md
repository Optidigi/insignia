**CHANGES_REQUESTED — exact HEAD `6cd4651c604b6eaa8d3d100330dd3cee5f396178`**

Verified tree `7a01fcb9b326c4665b89b39c6123e9a4d5c34cfb`, base/effective `e5262267234516251bd4a42367643b700e8854f0`, and clean worktree. One material security finding remains.

**P1 — Intermediate symlink hops can escape the frozen inventory.** [release-existing.py:97](/home/serveradmin/insignia-m5-020-worktree/deployment/m5-020/release-existing.py:97) resolves each link to its final target. Lines100–107 validate only that final target’s root and inventory membership. Intermediate links traversed outside the three inventoried roots are neither rejected nor frozen. [Line50](/home/serveradmin/insignia-m5-020-worktree/deployment/m5-020/release-existing.py:50) hashes only the inventoried link’s text.

Static counterexample, **not executed**:

1. A nongolden loaded CLI module links to `NEUTRAL/shared-link.js`, outside the three input roots.
2. That intermediate link initially points to `cli-runtime-dependencies/A.js`. Both `A.js` and a different `B.js` are already inventoried and frozen.
3. After freezing, change only the unlisted intermediate link to point to `B.js`.

The inventoried link text, membership, frozen file hashes, golden anchors and Git state remain unchanged. Revalidation accepts `B.js` because its final path is permitted and inventoried, while Node loads different executable bytes during the credentialed release.

This violates M5-020’s documented complete frozen CLI/runtime-input contract and leaves ROUND1’s P1 incompletely closed. Resolve links component by component and require every traversed link—including directory-component links—to belong to the permitted inventory, with kind/text frozen and revalidated. Preserve unresolved/cycle rejection. Add an offline control for retargeting an intermediate outside link between two frozen targets; GREEN11 does not cover this case.

ROUND1’s **P2 tracked-directory-link omission is closed**: mandatory membership now includes all tracked lexical paths, including all four directory symlinks. Direct final-target escape and permitted-target content drift are also addressed.

I independently inspected the cumulative change and complete requested production seams: admin/editor/canvas, App Bridge identity and grants, private SSR/API and request protections; durable CAS, immutable publication/outbox, idempotency, activation and recovery; trusted release/build and Function readiness; commercial eligibility and Shopify availability v1/v2/v3; tenant transactions, fences and all15 SQL migrations; Function authorization/query/policy code; packaging, host helpers and one-shot controllers. Pertinent test sources and assigned historical reviews/settings/finding responses were inspected without reusing verdicts.

Personally performed static checks verified all **396 source +225 build hashes**, all **124 tracked historical hashes**, control source/log bindings, assigned historical report hashes, changed JSON/Python AST parsing, exact Git bindings and cumulative whitespace. **No tests, builds, operator imports/execution, edits, network, browser, provider/CLI/SSH/credential operations or delegation occurred.**

Fresh manual owner config/UID readback and designated installation confirmation legitimately satisfy the stated premise, with their provenance limits preserved. Current-head CI remains unobserved here and separate from the external qualifying packet. The gate remains unfrozen, release unattempted, and all34 real G7 criteria unrun. Default production readiness remains deliberately fail-closed and must stop fixture creation if unresolved.

This verdict grants no principal approval, release permission or M5/G7 PASS.