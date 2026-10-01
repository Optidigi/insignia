# M5-002R2 — local clock and owner-input stabilization

## Scope and provenance

Same [PR #28](https://github.com/Optidigi/insignia/pull/28), base/effective merge
base `28e69864ebb9796504861a541363880cc86a82f8`. Worktree was clean and exactly
matched reviewed head `bd32f9763c033586374d9f072d01fb59d5a3ad1e` and tree
`217db18d714daf26365f4935579b3f1aaed351f6` before editing. Current final refs,
ten exact-head workflow results and fresh full-source review dispositions are
in the PR body, avoiding a self-referential commit. Initial candidate results
are retained separately from final corrected-source verification.

[Current authority](prompts/M5-002R2-LOCAL-STABILIZATION.md) records the explicit
owner instruction. The ZIP contained the older live brief, not an R2 brief;
its checksum and mismatch are recorded in [local results](evidence/m5-002r2/local-results.json).
Actual orchestrator/integrator: GPT-6.1-sol/high, verified by trusted T3 runtime.
One implementation writer (the integrator); fresh restricted read-only reviews
use explicit GPT-6.1-sol/high launches. No model substitution or general preflight.

## Corrections and red/green

**Clock:** The full SDK → production composition → entitlement → PostgreSQL
path reproduced the expired fixture (`current: false !== true`). The composition
now accepts an injected entitlement clock and supplies it to both provider
snapshot observation and entitlement projection. The default remains real time;
identity-token and online-grant checks continue using real time. No clock comes
from a merchant request or environment setting. Synthetic tests use a fixed
instant rather than rolling dates. Before scheduled cancellation end
`2026-09-30T23:59:59.999Z`: allowed; exact end `2026-10-01T00:00:00.000Z` and
one millisecond after: denied. Existing feature/pending/unknown/inactive and
publication-admission behavior is retained. [Red](evidence/m5-002r2/clock-red.log),
[green](evidence/m5-002r2/clock-green.log), [full boundary results](evidence/m5-002r2/postgres-final.log).

**Numeric input:** A focused real built-browser regression entered `0.6`, kept
the numeric input focused, and triggered an independent owner selection
rerender. The old `onChange` handler had not committed the edit: the controlled
input reset to `0.5`. Rectangle numeric controls now use `onInput`, preserving
the existing finite-number and domain geometry validation. The regression
verifies focus, owner-version/real Konva projection, submitted geometry and
reload persistence. [Red](evidence/m5-002r2/input-red.log),
[green](evidence/m5-002r2/input-green.log). No retry, timeout increase or fabricated
canvas state was used. Existing dirty/ambiguous publication and exact save
replay semantics stay unchanged.

### Additional keyboard-entry correction before handoff

An additional focused built-browser check on initial candidate
`ed4eb4c33df58343aac8989dfcde6e09fb29dcb2` found that clearing and typing `0.6`
keystroke-by-keystroke produced `0.56`: rejecting the incomplete `0` triggered
an owner rerender before typing finished. This failed observation is retained
in [keyboard red](evidence/m5-002r2/keyboard-red.log). The two initial full-source
reviews found no material issue at that earlier head; their dispositions are
retained as initial results, not final clearance of the later correction.

Valid input now passes the unchanged geometry rectangle validator before
committing owner state. Incomplete/invalid keystrokes remain DOM input only;
final invalid change/blur still goes through the existing owner validation and
restores the valid rectangle. No invalid geometry becomes draft or canvas
authority. A second focused control found that formatting intermediate valid numbers
also changed typed `0.605` to `0.665`; [fraction red](evidence/m5-002r2/fraction-red.log)
preserves that result. A small rectangle-input component now retains raw text
until blur while valid values commit immediately through unchanged geometry
validation. External owner changes synchronize the control before paint, and changing
placement/view/variant remounts its context-specific buffer. The regression
now types `0.605`, triggers an owner rerender, saves it, rejects `1.2` on blur,
and confirms reload retains `0.605`. [Final focused green](evidence/m5-002r2/fraction-green.log).

Fresh final full-source reviews and new exact-head CI are required after this
ordinary local correction. Initial ten green workflows and local 100/100
remain historical; final results are separately recorded in the PR body.

## Executed local verification

Pinned Node 24.21.0 / pnpm 12.6.0, TypeScript 5.9.3, Rust 1.98.1, PostgreSQL 18.6.
Synthetic SDK/provider transports only; database tests used a new project-local
`insignia_m5002r2_test` database on the existing isolated test process.

| Command | Actual result | Evidence |
|---|---|---|
| `pnpm check` through existing scoped Rust/browser environment | exit 0; full root green, including actual builds, units, boundaries, secrets, TS/Rust vectors, browser and historical hashes | [Root](evidence/m5-002r2/root-final.log) |
| `pnpm check:database` | migration up twice; 52/52 core tests | [PostgreSQL](evidence/m5-002r2/postgres-final.log) |
| `pnpm --filter @insignia/web exec node --test test/shopify-webhook.test.mjs test/admin/merchant-config.test.mjs test/admin/merchant-publication.test.mjs test/admin/production-composition.test.mjs test/admin/preview-composition.test.mjs` | 11/11 including three explicit boundary subtests | Same PostgreSQL log |
| `pnpm test:m5-stress` | **100/100; 25 each dirty/ambiguous × success/failure; zero retries** | [Stress](evidence/m5-002r2/stress-final-100.log) |
| `pnpm test:m5-renderer-control` | wrapper exit 0; deliberately missing actual renderer rejects before baseline | [Negative control](evidence/m5-002r2/renderer-final-control.log) |

The root stress script and Foundation CI now require 25 iterations per
combination. Previous CI failures and the unchanged-source 39/40 result remain
in `evidence/m5-002r`; a passing replacement does not erase those receipts.
Final-head CI is recorded with run attempts in the PR; no rerun masking.

## Retained state and limitations

This pass performed **zero** Shopify CLI/Admin/Partner/provider operations,
owner credential reads, previews, cleanup or scope repairs. The owner explicitly
retains the current nine grants matching the preview configuration as dev-store
preview state. The earlier empty→nine cleanup discrepancy is preserved in the
historical report and receipts; this is a new owner disposition, not new remote
proof or a claim of exact prestate restoration.

No new live embedded G7 proof, authenticated Function identity qualification,
publication activation, all-channel admission boundary or large-history query
benchmark. DEV_PREVIEW_OBSERVED remains live-unqualified; production readiness
still rejects without RELEASE_BOUND. Architecture v1.4, Function/wire source,
billing fixtures, old preview states and historical orders are unchanged.

Return the same PR for principal rereview. No merge, activation, M6/M7, complete
gate pass or launch.
