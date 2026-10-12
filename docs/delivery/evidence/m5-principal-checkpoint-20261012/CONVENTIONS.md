# Owner conventions and changes to carry forward

The operating model is authoritative; this is a checkpoint index, not a second governance policy.

| Convention | Current rule and source | Actual status |
| --- | --- | --- |
| Milestone autonomy | Root plans, implements, reviews, accepts and normally merges inside M5; principal accepts completed milestones. [Authority](../../authority/milestone-autonomy-2026-10-09.md) | PR88/89 normally merged; owner now explicitly requests this early principal checkpoint. |
| Inline work | Root performs core implementation; independent reviewers or bounded support only, no writer swarm. [Operating model §4](../../operating-model.md) | Recent core work inline; two independent read-only contexts per completed change. |
| Role/model/effort | GPT-6.1-sol/medium root; GPT-6.1-sol/low all subagents. [Amendment](../../authority/agent-model-effort-2026-10-11.md) | Actual requested settings logged; do not claim backend identity independently exposed when not available. Older high reviews remain historical. |
| TDD | A meaningful failing public/integration seam, smallest fix, relevant regression. [Pragmatic amendment](../../authority/pragmatic-delivery-2026-10-11.md) | Scope/HTTP/process defects reproduced and corrected. Avoid mock-only repetition of caller assumptions. |
| Test budget | Tests ≤50% of maintained executable LOC; fixtures/scaffolding count as tests wherever located; split inline Rust tests. | Current tracked ratio53.38%; NOT_PASSED. Private driver artifacts separately disclosed. |
| Complexity | Every module/test must justify current behavior; eliminate proven duplicate execution/scaffolding, retain meaningful failure/race/compatibility coverage. | Browser scaffolding consolidated; duplicate foundation operator run removed. Hotspots and budget remain. |
| Merchant UX | Polaris presentation; signing/key provisioning belongs to server-owned internal preparation, not merchant setup screens. | Styled picker observed; signing buttons removed. Internal preparation not natively completed. |
| Type/Rust quality | Preserve strict TS/typed ports/runtime validation, integer money, generated GraphQL contracts, checked Rust arithmetic/Ed25519/vectors/fmt/clippy/Wasm. | Existing gates retained; this report changes no production TS/Rust. Broad refactors/flags are not completion work. |
| Source/runtime proof | Freeze actual source/build/config; independent reviews; naturally applicable exact-head attempt1 CI; distinguish source, Docker config/manifest and native version. | Qualified PR88/89, native Function and append receipts retained. Report CI separately required. |
| Evidence honesty | Owner attestation, local control, provider-native readback and derived evidence stay distinct. Preserve STOPs and limits. | No screenshots or provider artifacts fabricated; no browser/native M5 PASS inferred from CI. |
| External operations | Scoped owner resources, private credential entry, durable reservations, at-most-once mutation and no ambiguous retry. | Function creates acknowledged once each, release appends independently ACK; transports cleaned. |
| Principal boundary now | Pause for the owner's requested unfinished-M5 review; no M6/merchant rollout. | This overrides automatic continuation for this checkpoint, not technical/product locks. |

Locked contracts remain in the [decision ledger](../../../architecture/decision-ledger.md). Commercial owner terms remain separate from technical readiness. Original whole-quote, tenant/generation, retention and availability semantics were not redesigned.
