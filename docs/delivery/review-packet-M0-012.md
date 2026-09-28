# M0-012 — principal review packet

**Requested verdict:** review one isolated real-contract/no-charge metering
prototype. This packet does not request a complete G8 gate pass, production
billing adoption, a new commercial tariff or permission to merge this PR.

## Fixed inputs and execution boundary

- Base/effective merge base: verified `Optidigi/insignia` remote `main`
  `e77e4e42f8858662889f9814eeb7d0c4ed3713ab`, normal PR #16 merge.
  Final PR head and passing run IDs are supplied in the PR body after push.
- Source used for **all four live POSTs**:
  `ef9d50c6e77fe87913c3fd6242c6c4f2782875ae`. Later evidence commits
  do not alter that source or represent another live run.
- The exact [principal prototype disposition](M0-012-principal-disposition.md)
  and [M0-012 brief](prompts/M0-012-real-contract-and-metering.md) are imported;
  v1.2 plan/ledger and historical receipts remain unchanged.
- One existing new app `gid://shopify/App/429028933633`, one existing shop
  `gid://shopify/Shop/105501393179`, one retained private draft
  `insignia-dev-zero-20260928`, one meter `customized_order_paid`, and the
  actual `legacySubscriptionId` value
  `gid://shopify/AppSubscription/38085427483` were used. The older staging
  app/store and orders #1001–#1006 were untouched.

## Reviewable result

| Claim | Direct evidence | Limit |
| --- | --- | --- |
| Actual source documents | [Baseline report and raw Partner readback](../../spikes/m0-012/evidence/baseline/) are byte-for-byte copies from the local handoff; SHA-256s in [README](../../spikes/m0-012/README.md). | Principal had not independently viewed those server-local records before this PR. |
| Contract and isolation | Fixed read-only Partner 2026-07 query before each send and after each token acquisition; native private-plan editor showed one store with access, no recurring fee, nominal USD 0.01 usage; post-run draft stage read. [Final contract](../../spikes/m0-012/evidence/live/final-contract.json). | `price.active:false` cause unknown; commercial tariff/other future subscribers not inferred. |
| Local implementation | [Isolated profile and immediate-use path](../../spikes/m0-012/README.md) leave historical strict target/tariff/token guards untouched. Pinned Node 24.21.0/pnpm 12.6.0 strict check passed **33** tests. | Missing scope/expiry metadata remain UNKNOWN; only this prototype permits immediate use. |
| Durable whole-package budget | [Operator register and independent receipt](../../spikes/m0-012/evidence/live/README.md) show 3 distinct keys, 4 acquisitions and 4 possible/actual POSTs; crash, lost-root and exact replay regressions passed. | Accounting protects this one retained local run; it is not a distributed or production journal. |
| Transport | Each attempt had HTTP 202 and literal `success:true`; request IDs and exact payload hashes are in the register. | HTTP receipt alone does not establish billing. |
| Native billing and meter | [Six-round observations](../../spikes/m0-012/evidence/live/observation-rounds.md) contain three exact-key App Billing Event `SUCCESS` details and Partner 0→1→1→2→3 quantity with USD 0.0 cost. | Immediate replay adds no observed unit; this is not a lifetime dedup or real-price invoice proof. |
| Resource state | Native migration screen still says Draft and test plans current, App Pricing enabled not started, one private plan/one store and zero public plans. | No subscription or pricing activation/cleanup was performed. |

The [full evidence narrative](evidence/m0-012-real-contract.md) separates
`RECEIVED`, `BILLING_PROCESSED` and `METER_COUNT_OBSERVED`; no status is inferred
from another. The actual local operator report/readback, register/receipt,
observation rounds and final contract are tracked; protected credentials and
token values are not.

## Review process and verification

One isolated token-path writer used a separate worktree. The orchestrator
integrated that lane, implemented the contract/register/operator path, owned
the single remote operator role, and ran the local suite. A read-only endpoint
scout checked current official Shopify reference support for the pinned
2026-07 event endpoint. Fresh read-only Spec and security reviewers identified
and verified fixes for an independent receipt, native billing evidence gate,
whole tracked-source cleanliness, safe native-log URL and full Git SHA
validation. Both returned PASS before E1. These are local reviews and do not
replace principal approval. Native browser access was used for the exact plan
and App Billing Event observations; Partner reads were fixed-target and
credential values remained in protected local files.

Commands on the fixed source: `cd spikes/m0-012 && corepack pnpm install
--frozen-lockfile && corepack pnpm check`; `python3 -B
spikes/m0-007/scripts/check-history.py`; `git diff --check`; `sha256sum`
of imported records. The architecture check reports plan
`8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`,
ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`,
41 old sources and 120 historical receipts unchanged. The M0-012 GitHub
workflow performs the pinned local checks on the final PR head; its actual
run/result belongs in the PR body, not a self-referential source commit.

## Remaining decisions

The result is scoped to an existing development-store draft subscription with
effective zero pricing and one cycle. It does not complete production billing,
three commercial plans, the 14-day trial, included allowance, end-to-end
order qualification, historical reconstruction, v2 adoption, G7 or other
gates. No further send, app-wide pricing enablement, deployment, M1 or next
PR merge is authorized by this packet. The principal retains all gate and
architecture decisions and final PR review.
