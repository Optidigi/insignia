# M0-013 — local protocol/capacity review packet

28 September 2026 UTC. **Principal decision requested:** review the bounded
off-store capacity evidence and the narrow v1.3 gate sequencing correction.
This packet proposes neither a production v2 protocol nor a merchant limit,
complete gate PASS, M1 start, or public-app experiment.

## Authority and provenance

- PR #17 was already normally merged. This branch starts at remote
  `main` `662a78cd27507d8a2f1eaa976f1c644c93edd1be`; its parents
  and tree are recorded in [state](state.md). No second PR #17 merge occurred.
- The [actual readiness report](M0-READINESS-REPORT.md) was copied
  byte-for-byte from
  `/home/serveradmin/insignia-pr17-readiness-handoff/M0-READINESS-REPORT.md`.
  Both copies SHA-256
  `a30ef1e57c371f0b6afdd0f51ed1778a23c90b6b709d8245869062dbdbd01c03`.
  The principal reviewed the owner's summary and repository evidence, **not**
  that full server-local report independently. It remains a historical
  reconciliation under the old v1.2 dependency order.
- The owner authorized [M0-013](prompts/M0-013-PROTOCOL-CAPACITY.md) and the
  [principal sequencing direction](M0-013-principal-sequencing-direction.md)
  as one off-store PR. No authenticated Shopify/Partner call was made here.

## Candidate and measured artifacts

The [measurement record](../../spikes/m0-013/evidence/measurements/README.md)
describes the exact source materialization and local patches: the M0-006
full Function adapters, M0-007 live-normalized policy/query/schema and
M0-005 strict whole-quote verifier. All older source and receipts remain in
place. There is one uncapped baseline and one bounded candidate, with no
optional protocol/crypto/materialization optimization. The v2 wire,
signature, member carrier, exact money and independent full-set verification
are unchanged.

The pinned local Shopify CLI 4.8.2 builds and validates both synthetic
Function extensions; Function runner 9.2.2 executes the final trampoline
Wasm. Query lengths/costs are 749 bytes/20 calculated points for Transform
and 818 bytes/23 for Validation (limits 3,000 bytes/30 points). Cost is
calculated under the documented query-field rules, not returned by Shopify.
The complete baseline/candidate manifests have SHA-256
`c632d5b7dbf4ca27dd508509eb9e0796aa7be596bad665da48522d7c764eb379`
and
`97b8b34ad2936e68b519665dd6d141ca94a136a98c45ec92fd599c700c200b11`.
Every row binds the executable and query hashes, serialized input,
expected/actual output hashes, counters and method. The eight-row
[same-input comparison](../../spikes/m0-013/evidence/measurements/same-input-comparison.json)
has SHA-256 `08afbeace58b6747fe6905067cc244a2c184d7da29f54969c5d8c234248f8b50`;
all eight pairs yielded identical output hashes. The committed local
candidate Wasm hashes are Transform
`8b3340359faa12d7ae29bd0160bbc92a9a1ba497c01e90eef354dfb3ba3c2f21`
and Validation
`dcef865ef27b014f5d77f30cc36372f67aa2d41e996d0fa78e49625e2a61bd30`.

| Full-target local row | Binary B | Instructions | Input B | Output B | Linear memory KiB | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Candidate Transform, 10 signed +190 ordinary | 179,636 | 7,978,310 | 91,686 | 3,446 | 1,600 | Accept |
| Candidate Validation, same | 181,178 | 8,253,444 | 103,132 | 17 | 1,600 | Accept |
| Candidate Transform, 32 signed +168 ordinary | 179,636 | 8,432,228 | 92,522 | 10,992 | 1,600 | Accept |
| Candidate Validation, same | 181,178 | 8,585,447 | 103,968 | 17 | 1,600 | Accept |
| Uncapped Transform, 64 signed +136 ordinary | 178,958 | 9,008,693 | 93,739 | **21,968** | 1,600 | Executed; output exceeds 20,000 |
| Uncapped Validation, same | 180,099 | 8,936,639 | 105,185 | 17 | 1,920 | Executes; above 8.8M evaluation target |

For the 32+168 candidate, per-target reference headroom is: Transform
76,364 binary B, 2,567,772 instructions, 35,478 input B, 9,008 output B;
Validation 74,822 binary B, 2,414,553 instructions, 24,032 input B,
19,983 output B. Both use 1,638,400 linear-memory bytes, leaving
8,361,600 below the 10,000,000-byte reference ceiling. The more restrictive
8.8M/16,000 engineering targets leave Transform 367,772 instructions/
5,008 output B and Validation 214,553 instructions/15,983 output B.
Query headroom is 2,251 B/10 points and 2,182 B/7 points respectively.
These are **separate** Function budgets.

The 32+168 family, 10,000 physical garments in five buckets, two-product
setup/remainder partition and reordering, maximum field widths,
key-overlap/revocation, validity/epoch, exact-price edits, missing/mixed/
duplicate/tampered members and policy controls are in the 88-row candidate
matrix. The 200 ordinary-line control and finite 250-line runner stress
remain distinct; the up-to-200-line published reference is not applied
to 250 lines. An already signed historical quote can survive a pending
same-generation registration transition; stale generation still rejects.

The candidate Function guard admits at most 32 customized price buckets,
200 relevant cart lines and 10,000 physical units under the measured
field/config widths. Its immediate 33+167 and 64+136 rows reject, with
no partial Transform operation. The uncapped valid 64-set failure is
retained; guard rejection is not a successful 64-set price. The
[TypeScript pre-issuance seam](../../spikes/m0-013/ts/admission.ts) allocates
the entire accepted subset before signing, counts ordinary coexistence,
checks controlled input projections and a conservative exact serialized
output upper bound (11,632 bytes for 32 buckets), and refuses the next
bucket. It does not make buyer/cart projections authoritative after an edit.
Both Functions independently reverify the complete statement at checkout;
wholly unrelated unsigned ordinary carts stay on their ordinary path.

## Remaining limits and requested adjudication

The pinned runner reports linear memory but not Wasm call-stack peak or an
artifact-specific stack bound. Stack is `null` in the manifests; memory
is not used as a proxy. A fresh integration-worktree rebuild produced
Transform/Validation Wasm hashes
`e8a714c026660db02fee7621c8cc3f93a324f6dbcb94c0d6a23dfa0f51539017`
and
`d8852fc41561e7b5c6bbc3826717b65c480bf81d21a695cd8db3389869fb3aae`
because Rust embeds checkout paths; its 88 case outputs and counters matched
the committed local measurements. CI remeasures and uploads its *own*
binary/row artifact. Those hashes must not be mixed with another run's
counters.

The candidate is limited to synthetic controlled projections. Larger cart
shapes, Shopify's pre-Function oversized-input behavior, live app-owned
publication/transport, key rollout, ordinary app interactions and native
checkout remain unproved. In particular, no universal instruction-per-line
formula or deployable merchant cap follows from 32+168. The principal can
accept this as bounded local evidence while recording stack and live
capacity/transport as precise unresolved boundaries, or request a further
same-protocol measurement. The separately authorized public-app proof would
use the [draft evidence manifest](../../spikes/m0-013/evidence/public-app-test-manifest.draft.json); it was
not executed here.

## v1.3 sequencing and verification

Before: v1.2 required complete G1–G8 before M1, while M9 was tasked with
building parts of G8. After: v1.3 requires a principal-accepted bounded M0
feasibility basis and explicit M1 authorization; plan §14.2.1 assigns every
unchanged G1–G8 criterion to an owning milestone and its blocking
feature/release acceptance point. M9 entry requires provider feasibility,
not already completed integrated G8; M9 exit requires the remaining
integrated G8 tests. No gate status or product decision changes.

Run the entire off-store suite with:

```sh
(cd spikes/m0-005 && corepack pnpm install --frozen-lockfile)
(cd spikes/m0-013 && corepack pnpm install --frozen-lockfile)
bash spikes/m0-013/scripts/check-local.sh
```

The integration run passed: archived v1.1/v1.2 and current v1.3 hashes,
41 frozen source and 120 receipt checks, M0-006 retained evidence,
10 M0-005 TypeScript tests, 9 new admission tests, 13 authorization
Rust tests, 18 Transform tests, 21 Validation tests, both CLI schema/builds,
88/88 candidate rows, eight same-input comparisons and 152/152 retained
row replays. The historical Order B $0.01 stop remains recorded.

## Fresh local review dispositions

The independent Spec reviewer found that the original public admission
interface could accept a caller-supplied 33-bucket/10,001-unit profile
above both compiled Function guards. A public-seam regression first went
red by reaching the signer with an invalid private key, then went green
after `validProfile` was restricted to the compiled 32-bucket,
10,000-unit and 16,000-output-byte bounds. This prevents that particular
sign-then-reject mismatch; the selected profile must still match the
deployed Function configuration and current cart projection. The same
review found missing fixed source-path/ref mapping; the measurement
record now names the PR #17 fixed ref, original paths, local baseline
patch and schema/query hashes. A final read-only recheck confirmed the
guard correction and caught one test-vector path typo; the table now
points to the byte-identical actual fixture.

The independent Standards/security reviewer found a stale G7/G8
“unexecuted” recap in the implementation plan despite accepted partial
sub-results. The recap now says they are incomplete with bounded
observations; the explicit current-v1.3 plan hash was updated while the
archived v1.1/v1.2 checks were retained. The reviewer reported no other
concrete security/correctness finding; duplication across independent
Function targets was a non-blocking maintainability observation.
