**Three unresolved P2 findings. The precredential review gate is not clear.**

Reviewed BASE `4bba14fb4415815557ffa5f1e600427a62128489`, HEAD `12c422b5fdba75e92c70df7735b03a3a8ef65469`, tree `f708e3d00b0f709d2df19584ea5b9f85fb6d641e`.

Actual commit subject: `12c422b feat(m5-017): version availability holds with direct effective anchors and one-shot rehold`.

Diff command:

```sh
git diff 4bba14fb4415815557ffa5f1e600427a62128489...12c422b5fdba75e92c70df7735b03a3a8ef65469
```

## Standards

No additional unresolved material standards finding. Historical v1/v2 duplication serves the explicit compatibility requirement. I reviewed both axes sequentially under your prohibition on spawning agents.

## Spec

1. **P2 — Required PostgreSQL web integration tests still supply v2 to the v3-only activation path.**

   Location: [activation.ts:457](/home/serveradmin/insignia-m5-017-worktree/packages/application/src/publication/activation.ts:457). Interacting fixtures: [activation-integration.test.mjs:108](/home/serveradmin/insignia-m5-017-worktree/apps/web/test/admin/activation-integration.test.mjs:108) and [synthetic-activation.mjs:73](/home/serveradmin/insignia-m5-017-worktree/apps/web/test/admin/support/synthetic-activation.mjs:73).

   Requirements: “New FIRST_PUBLICATION/MODE_CHANGE uses v3 only” and “Run full regression, PostgreSQL18 CI, stress100/100 and renderer negative control.”

   The coordinator correctly rejects v2 for new activation, but these fixtures still produce v2 snapshots; the integration test also expects v2 activation evidence. With PostgreSQL enabled, both first-publication paths throw `Hold snapshot malformed or future intent unqualified`. The runtime workflow explicitly runs them at [m3-runtime.yml:81](/home/serveradmin/insignia-m5-017-worktree/.github/workflows/m3-runtime.yml:81).

   **Smallest correction/test:** migrate these new-activation fixtures to the production v3 adapter or valid v3 snapshots, anchors and acquisition acknowledgement; update evidence assertions. Preserve dedicated historical v1/v2 coverage. Run both PostgreSQL-enabled web tests and exact-source CI. The supplied `web-v3-integration-red.log` corroborates both failures; I inspected that log rather than executing the tests.

2. **P2 — Native dispatch can occur after freshness or elapsed deadlines expire during synchronous gate work.**

   Locations: [operator.mjs:431](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/operator.mjs:431) and [guard.mjs:63](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/guard.mjs:63).

   Requirements: “operation-wide deadline,” “exact current identity/install/grants,” and “no request after timeout/quarantine.”

   Freshness is checked during classification. The operator then reserves/fsyncs the event, and the private wrapper synchronously verifies source/build/gate artifacts and reads the register before calling native transport. That final boundary rechecks accounting but neither freshness nor an absolute deadline.

   A create or archival request admitted at 29,950 ms can dispatch after gate work advances observation age to 30,050 ms. Likewise, synchronous work can cross the eight-second transport timeout or production operation deadline while abort timer callbacks remain unable to run. The earlier `signal.aborted` check cannot detect that elapsed interval.

   **Smallest correction/test:** enforce captured monotonic expiry and required freshness immediately before native transport, after synchronous checks. Record known unsent denials separately while consuming the reservation and stopping subsequent provider calls. Test freshness crossing 29,950→30,050 ms and synchronous work crossing the transport/operation deadline, requiring zero native dispatches. The inspected `fresh-dispatch-red.log` records one synthetic create where zero was required. M5-016’s accepted dispatch-boundary correction already addresses the analogous gap.

3. **P2 — Completion timestamps and wall time alone can renew stale identity/ownership authority.**

   Locations: [operator.mjs:257](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/operator.mjs:257), [operator.mjs:476](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/operator.mjs:476), and [operator.mjs:540](/home/serveradmin/insignia-m5-017-worktree/scripts/m5-017/operator.mjs:540).

   Requirement: “exact current identity/install/grants.” The maintained M5-016 adjudication explicitly requires conservative pre-I/O origins, rejection of negative ages, and elapsed freshness.

   Identity and ownership timestamps are assigned after response processing. Checks use only `Date.now() - timestamp < 30000`; negative ages pass, and no monotonic age is retained. A slow response understates observation age. After 35 seconds elapsed and a partial wall-clock rollback yielding 20 seconds wall age, stale authority remains admissible. Successful reads can then renew that authority from completion time.

   **Smallest correction/test:** retain pre-I/O wall and privately captured monotonic origins; require finite, nonnegative ages below the limit in admission, `isCurrent`, and final dispatch. Restore regressions for delayed responses, backward time, and 35-second elapsed/20-second wall age. This is distinct from finding 2: correcting origins does not close the later dispatch gap.

I inspected complete changed implementation, migration, tests and guarded harness modules; their interacting activation, recovery, publication, tenant and web sources; original v1/v2 contracts/adapters/migrations; required governance documents, brief, principal review and historical reports. I found no additional material objection in effective-anchor semantics, settled one-shot compensation, durable claims/replay protection, immutable receipts, tenant fences, or historical recovery dispatch.

I executed only read-only inspection, Git comparisons and `python3 -B spikes/m0-007/scripts/check-history.py`—the history check passed, and the original v1/v2 contract/adapter/migration comparison was empty. No tests, builds, migrations, harness, credentials, network operations or mutations were executed. Host-selected model/effort was not independently attested from launch metadata.

Original red logs remain failures, including adapter behavior, activation/recovery versioning, the SQL constraint, harness setup, unattributed HELD, deadline quarantine and the first root history check. Subsequent green logs do not erase them or establish exact-head qualification. Root second-pass evidence predates the final deadline test; broader exact-head qualification remains unverified here.

**Totals: Standards 0; Spec 3, worst severity P2. Live NOT_RUN; canonical run absent. Principal approval remains external and ungranted.**