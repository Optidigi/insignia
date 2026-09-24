# Principal review packet — PF-001R

## Identity

Repository: **user-designated `Optidigi/insignia`**. The neutral local Git repository is source provenance, not the rewrite destination.

PR: final URL and SHA-bound refs are in the external publication handoff. Local `gh` identity `shimmy-aga` has repository ADMIN permission; the user authorized and the orchestrator pushed the minimal `main` base.

Slice/spec: `docs/delivery/prompts/PF-001R-remediation.md`.

Local provenance comparison base: `7f7fbabbfb60bd0e3d693d332e2b7da59693b9dd`. Approved remote `main` base: `38a711ad46aec63b8f410519f30352a88e4113c7`. Final PR head and effective merge base are in the external handoff, generated after publication.

Required next action: principal reviews the actual export or PR and evidence. Sandbox and Shopify app/store authentication blockers remain for M0 readiness.

## Outcome and scope

The original PF-001 report was made reviewable, the failing sandbox was diagnosed without relaxing controls, and isolated pinned Rust/Wasm and Shopify CLI toolchains passed disposable smokes. Project-local configuration requests the desired orchestrator model/effort and sequential mode, but effective runtime loading remains unverified. No app or gate work occurred.

The implementation plan and decision ledger stayed byte-identical to the supplied archive. Scope is delivery documentation, evidence, root instruction pointer and project-local Codex configuration. The exact change list and hashes are in the external export manifest.

## Acceptance evidence

| Criterion | Probe | Result | Evidence |
|---|---|---|---|
| Source integrity | SHA-256 + byte comparison to zip | PASS | `evidence/pf001r-probes.md` |
| Rust/Wasm/rustfmt/clippy | Isolated version/target checks, generic Wasm compile and disposable checks | PASS | `evidence/pf001r-probes.md` |
| Shopify CLI binary | Local pinned version/help | PASS | `evidence/pf001r-probes.md` |
| Fresh read-only instruction, ledger, skill reads | `codex exec -s read-only` | FAIL: sandbox init `bwrap` error | `evidence/pf001r-probes.md` |
| Effective model/effort/project config | Doctor + launched JSON metadata | NOT_VERIFIED | `evidence/pf001r-probes.md` |
| Designated Shopify app/store identity | CLI session listing and noninteractive organization read | BLOCKED: names designated, auth absent | `evidence/pf001r-probes.md` |
| Remote publication and native review controls | `gh auth status`, repo/branch/ruleset reads, authorized `main` push | Base/write VERIFIED; no ruleset/native review enforcement | `evidence/pf001r-probes.md` |
| G1–G8 | No procedures executed | NOT_RUN | Delivery state |

The full, runnable paths and environment assignments for the Rust, Shopify CLI and failed fresh Codex commands are in [the PF-001R command record](evidence/pf001r-probes.md#exact-repeat-probes-after-fixed-ref-review-feedback). In particular, the failed reviewer invocation was:

```sh
codex exec --ephemeral --json -s read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' -c 'features.multi_agent=false' 'Read AGENTS.md, docs/architecture/decision-ledger.md, docs/delivery/prompts/PF-001R-remediation.md, and .agents/skills/writing-for-agents/SKILL.md. Give file and line references for current authorization and two locked decisions. Do not edit or call external services.'
```

The CLI conversation returned exit 0, but the read failed before opening files with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`; this is a failed capability check. The Shopify CLI authenticated-session command and its empty result are recorded verbatim in the command record. Those commands require the isolated tool paths and environment shown there.

The prior PF-001 Git, Node/TS, pnpm, developer MCP and browser smokes were reused only to their recorded scope. No CI exists in an approved rewrite repository. Tool/scratch files are outside application source; there are no test merchant resources to clean up.

## Local pre-review

Prior PF-001 feedback came from a collaboration child with no native read-only sandbox guarantee; it found no apparent unauthorized app/gate work or secret exposure at that checkpoint. It did not review a verified PR base/head. The PF-001R fixed-ref review findings, execution mode and refs belong in the external export manifest after the final commit; the fresh Codex read-only reviewer path currently fails at sandbox initialization. Principal review remains pending.

## Compatibility and safety

No application API, schema, migration, money, setup, grouping, idempotency, tenant, retention or security implementation changed. No Function, app, theme or store mutation; no production or billing action. The staged diff must be checked for secrets before final commit. The external export excludes tool binaries, environment dumps and credentials.

## Principal decision — principal/user completes externally

Verdict: **PENDING**

Bound repository/PR/base/head: **PENDING**

Gate result separately accepted: **NONE; G1–G8 NOT_RUN**

Required corrections/conditions: **principal to determine**

Authorization for next slice: **NONE**
