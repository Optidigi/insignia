**Offline safety disposition: six unresolved material findings. This candidate does not receive clearance for credential access.** This is the independent Spec/correctness review, not principal approval.

| Binding | Verified value |
|---|---|
| Repository/worktree | `Optidigi/insignia`; `/home/serveradmin/insignia-m5-004-worktree` |
| Base/effective merge base | `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` |
| Exact candidate/HEAD | `09de2ef844113570d5d67dd7b959401445e79687` |
| Candidate tree | `6439b8c2c921174c54a1729602a747798196d379` |
| Branch | `feat/m5-004-availability-qualification` |
| Worktree | Clean |

**Findings**

1. **P1 — The budget and lock are per directory, not whole-slice.**  
   [operator.mjs:113](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:113), [operator.mjs:261](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:261), [qualification.mjs:358](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:358).  
   `initialize()` accepts any directory and creates fresh counters and a new marker; the lock protects only that directory. A restart or another worktree using another directory can obtain another creation attempt and concurrent store access. The existing same-directory tests cannot establish the whole-slice ceiling. Additionally, `qualify()` never compares the register’s binding with the binding that passed its gate.  
   **Smallest correction:** designate one canonical register/lock outside worktrees, reject alternate live paths, and compare its complete binding with the approved runtime binding before credential access. Missing or inconsistent history must stop initialization.

2. **P1 — The pre-credential gate accepts incomplete CI and unbound review records.**  
   [binding.mjs:42](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/binding.mjs:42).  
   One unnamed successful CI entry satisfies the gate. There is no required-workflow set, run identity, or completeness check. Individual review entries contain neither reviewed base/head nor source/build digest; their role/model/verdict strings are sufficient. Consequently, omitted failing or pending workflows, or stale review dispositions copied into a new gate, can permit credential loading.  
   **Smallest correction:** require the complete applicable workflow set with exact-source run receipts, and bind each independent review receipt to the reviewed refs and relevant binding digest. Reject omissions and stale receipts.

3. **P1 — Malformed or unsuccessful mutation responses can clear the unknown-write barrier.**  
   [operator.mjs:466](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:466), [operator.mjs:538](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:538).  
   The `REJECTED` branch does not require a successful HTTP status or validate the user-error shape. For example, `product:null,userErrors:[{field:["status"]}]` is classified as rejected despite lacking the message required by the actual adapter. That adapter reports `provider_shape`, but `unknownWrite()` considers the attempt settled, allowing finalization to send another status mutation. An HTTP 5xx carrying this mutation envelope has the same settlement problem.  
   **Smallest correction:** classify rejection only from a valid supported success-status envelope with fully validated user errors and explicit null product. Preserve all other malformed/unsuccessful outcomes as unknown and prohibit subsequent mutations, including cleanup.

4. **P1 — Source verification can attest a different repository from the executing modules.**  
   [qualification.mjs:5](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:5), [qualification.mjs:81](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:81), [operator.test.mjs:302](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.test.mjs:302).  
   The adapters are statically imported from this worktree, and reload uses its `ROOT`; gate verification instead uses caller-supplied `root`. The full-workflow tests demonstrate this separation: they freeze a temporary repository containing empty source/build directories while executing adapters from the original worktree. The exported entry point also permits an alternate root with default live credentials and transport.  
   **Smallest correction:** anchor live verification to the executing module root. Any alternate-root testing facility must require explicitly synthetic credentials and transport. Add a negative test proving that a binding for another checkout cannot reach credential loading.

5. **P2 — Retained failure responses cannot reproduce the adapter’s normalized failure.**  
   [operator.mjs:457](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:457).  
   GraphQL errors lose `message`, locations and their original extensions structure; mutation user errors retain only `field`. Replaying those saved responses through the unchanged adapter produces `provider_shape` instead of the original `graphql_error`, `throttled`, `forbidden` or `user_error`. A response digest cannot recover the discarded diagnostic. This violates the required raw-versus-normalized failure preservation.  
   **Smallest correction:** retain a bounded, sanitized response preserving the adapter-required structure and diagnostic fields, together with the actual normalized outcome. Verify replay equivalence for schema, permission and user-error failures.

6. **P2 — Unrelated fixture metadata drift is not rejected consistently.**  
   [operator.mjs:222](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:222), [qualification.mjs:120](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:120).  
   Ownership accepts any tag vector containing the marker and any creation timestamp within its window. The original provider creation timestamp and exact tag vector are not bound as immutable fixture identity. An additional tag introduced between cycles passes `owned()` and subsequent setup can continue despite the brief’s unrelated-change stop condition.  
   **Smallest correction:** persist the acknowledged immutable fixture identity and exact permitted metadata baseline; compare subsequent ownership reads against it before further writes.

**Source-traced behavior**

The unchanged adapters are genuinely called for snapshot, acquire, observe, restore and catalog reads. DRAFT follows the no-status-write path; ACTIVE, UNLISTED and ARCHIVED use exact held-state/version/visibility checks and restoration readbacks. The drift control invokes both observe and restore and requires conflict without another restoration mutation.

Within one intact register, reservations precede fetch, requests are serialized, normal operations preserve the 12-read/3-update reserve, and RESERVED/UNKNOWN writes block finalization. Creation lookup is marker-filtered, single-use and does not grant mutation authority. The subprocess reload checks and returns exact persisted bytes; adapter observation then occurs in the parent process.

The request allowlists contain no publication, policy, Function, inventory, billing, deletion or commerce mutation. Protected credential-file checks occur after the gate in the default entry path; authentication bodies and tokens are excluded from the register.

A smaller documentation discrepancy also remains: [M5-004-REPORT.md:15](/home/serveradmin/insignia-m5-004-worktree/docs/delivery/M5-004-REPORT.md:15) reports **52 normal reads**. Tracing the successful workflow gives **59**, still below its conservative 70-read bound. Correct the enumeration without changing the ceilings.

**Read and executed**

Read the complete M5-004 authority, all five operator/source/test files, changed configuration and document/evidence files, complete production availability and catalog implementations/tests, availability contracts, catalog deadline transport, and the supplied historical diagnostic sources/results. Also read AGENTS, ledger, operating model, delivery state, code-review skill, TDD tests/mocking guidance, M5-003/R/R2 reports, unresolved-acceptance register, relevant plan sections, tooling register and review-packet template.

Executed only read-only file and Git inspection: ref/tree/parent resolution, merge-base, status, diff inventory/content checks, blob hashing, duplicate-file comparison and package checksum verification.

- Principal-package manifest: **all 14 entries passed**.
- Historical source snapshots: matched current availability, publication and production-activation blobs.
- Production packages: unchanged from the fixed base.
- `git diff --check`: **exit 2**, for trailing whitespace in retained evidence logs; not treated as a behavioral blocker.
- Supplied 13-test success logs: inspected, **not independently rerun**.

No builds, tests requiring writes, edits, delegation, networking, credentials—including credential metadata—provider/Shopify/browser operations or database access occurred. Findings are source-derived; no live reproducer was attempted.

**Remaining production limitations**

Live qualification remains NOT_RUN. Even a successful corrected experiment would not establish withdrawal of previously published availability, preservation of nonempty publication histories, all-channel propagation, in-flight checkout drainage, atomic product-version CAS, RELEASE_BOUND provenance, trusted production recovery, ProductConfig activation or complete M5/G6/G7 acceptance. Fresh corrected-source reviews and all applicable exact-source CI remain required before root credential access.