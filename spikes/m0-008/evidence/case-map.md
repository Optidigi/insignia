# M0-008 synthetic case map

Source boundary: `spikes/m0-008/src/{publisher,publisher.test,graphql,graphql.test,fakes}.ts` at the PR head. `corepack pnpm check` executes these cases; no output here is a live Shopify receipt. The pinned GraphQL request shapes derive from the checked-in M0-007 `metadata-set.graphql`/`metadata-before.graphql` receipts and the Admin 2026-07 primary docs linked in `publication-contract.md`.

| Behavior | Test name / expected observation |
|---|---|
| Journal precedes side effects; first publication and quote embargo | `first managed publication journals before write...`: no remote write before journal, explicit null CAS, pending until activation, quote issuance false. |
| Required→required, required→optional, optional→required | `required revisions and both policy directions...`: old effective boundary retained; both policy-mode changes refuse mutation without all-channel admission premise. |
| Ambiguous mutation timeout, restart at boundaries | `ambiguous after-commit timeout...`, `journal snapshot resumes...`, `crash after remote write...`: exact re-read prevents blind duplicate write. |
| Idempotency, competing operations, CAS/user errors, retry budget | `same operation replays...`, `mutation user errors...`, `stale prior digest...`: typed replay/conflict/operator action. |
| Missing, partial, malformed, stale, wrong-installation readback | `missing, partial, malformed, stale and wrong-generation...`: no default optional interpretation or write through ambiguous state. |
| Unsupported complete loss and coherent rollback | `complete loss and coherent rollback...`: preserved last active journal flags re-publication as incident; the Function limitation remains explicit. |
| Pinned GraphQL mapping and explicit `compareDigest:null` | `pinned 2026-07 product read...`, `create-only null CAS...`, `nullable metafields...`, `wrong namespace...`: fake request/response shape, typed stale user error and validation. |

These tests establish local use-case semantics only. They do not establish journal durability, all-channel unavailability, in-flight-cart draining, Function propagation, a production activation port, or gate acceptance.
