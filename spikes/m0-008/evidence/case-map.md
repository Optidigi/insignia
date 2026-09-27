# M0-008 synthetic case map

Source boundary: `spikes/m0-008/src/`, `spikes/m0-008/consumer-projection/` and `spikes/m0-008/fixtures/consumer-projection.tsv` at the PR head. `corepack pnpm check` and the Rust consumer test execute these cases; no output here is a live Shopify receipt. The pinned GraphQL request shapes derive from the checked-in M0-007 `metadata-set.graphql`/`metadata-before.graphql` receipts and the Admin 2026-07 primary docs linked in `publication-contract.md`.

| Behavior | Test name / expected observation |
|---|---|
| Journal precedes side effects; first publication and quote embargo | `first managed publication journals before write...`: no remote write before journal, explicit null CAS, pending until activation, quote issuance false. |
| Installation generation rollover | `new quote issuance rejects an active record from a prior installation generation`, `publication start and restart refuse...`, `installation rollover between admission and write...`: stale identity blocks issuance and modeled publication steps. A trusted source and atomic rollover fencing remain production obligations. |
| Required→required, required→optional, optional→required | `required revisions and both policy directions...`: old effective boundary retained; both policy-mode changes refuse mutation without all-channel admission premise. |
| Ambiguous mutation timeout, restart at boundaries | `ambiguous after-commit timeout...`, `journal snapshot resumes...`, `crash after remote write...`: exact re-read prevents blind duplicate write. |
| Idempotency, competing operations, CAS/user errors, retry budget | `same operation replays...`, `mutation user errors...`, `stale prior digest...`: typed replay/conflict/operator action. |
| Concurrent journal saves and terminal retry | `stale activation-pending...`, `stale timeout...`, `mutation user errors...`: versioned save cannot regress an active operation, and exhausted retry stays stopped after restart. |
| Missing, partial, malformed, stale, wrong-installation readback | `missing, partial, malformed, stale and wrong-generation...`: no default optional interpretation or write through ambiguous state. |
| Unsupported complete loss and coherent rollback | `complete loss and coherent rollback...`: preserved last active journal flags re-publication as incident; the Function limitation remains explicit. |
| Pinned GraphQL mapping and explicit `compareDigest:null` | `pinned 2026-07 product read...`, `create-only null CAS...`, `nullable metafields...`, `wrong namespace...`: fake request/response shape, typed stale user error and validation. |
| Publisher → Rust consumer | `publisher remote states match...` generates the committed [16-state fixture](../fixtures/consumer-projection.tsv) from fake-remote publication steps. The M0-007 Rust classifier checks those exact rows, including rev1 signed eligibility during pending states in both policy directions. Eligibility is only one input; unchanged M0-007 Function tests separately verify historical full signed-price behavior. |

These tests establish local use-case semantics only. They do not establish journal durability, all-channel unavailability, in-flight-cart draining, Function propagation, a production activation port, or gate acceptance.
