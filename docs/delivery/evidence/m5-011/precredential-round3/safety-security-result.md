**Precredential verdict: two unresolved material findings.** The source-safety gate should remain closed. Live experiment: **NOT_RUN**. This is a local review, not principal approval.

Base: `1fffcb3048952ff762f1f9805f86aceed90f228f`  
Head: `26e109aa58d514592c4a93de280a20d355aaeab5`

1. **Standards/security — P2: timeout releases serialization before fetch settles.** [operator.mjs:475](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:475) races fetch against abort; its `finally` clears `busy` and `pending` at line 569 while fetch may remain outstanding. Counterexample: an ARCHIVED request ignores abort and completes after nine seconds. At eight seconds, the qualification sends its final projection concurrently and finishes with the archive request still outstanding. My in-memory reproduction recorded `maxOutstanding=2`, `read=16`, `update=2`. This violates “No blind retry or parallel provider calls.” **Smallest correction:** track underlying transport settlement separately; retain quarantine after timeout and refuse further dispatch while it remains outstanding. Preserve UNKNOWN and never retry.

2. **Spec — P2: wrapper changes production adapter failure branches.** [operator.mjs:544](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:544) throws `Stop` for provider user errors; line 555 similarly converts HTTP/GraphQL failures into thrown transport errors. The unchanged adapter maps these generic exceptions to `network_or_timeout`, entering ambiguity recovery. Counterexample: HTTP 200 with `product:null` and a valid status `userErrors` response. Direct production execution returns `user_error` after two adapter reads; the harness returns `NOT_HELD` after three. This undermines the requirement to “Record … adapter result … and accounting” without inferring beyond captured evidence. **Smallest correction:** return bounded, sanitized responses that preserve the adapter’s HTTP/envelope/shape semantics, while recording settlement independently. Add direct-versus-wrapped regressions.

**Evidence detail:** I inspected all six `scripts/m5-011/*` files, production availability source and built JS/declarations, application availability contracts, production adapter tests, inherited M5-004 operator/binding/qualification, M5-009/M5-010 wrappers and recovery, governing documents, changed configuration/CI/scripts, and supplied evidence.

Actually executed:

- Required fixed diff/log, scope comparison, syntax checks and `git diff --check`.
- Gate-record test: **1/1 passed**. Full binding test was **unavailable: sandbox `spawnSync git EPERM`**.
- In-memory filesystem/HTTP counterexamples above; no filesystem resources or provider requests.
- Explicit ESM TypeScript emit comparison: built adapter **byte-identical**.
- Authorization manifest **6/6**, duplicate-document equality, and repository secret/provenance check: passed.
- Production packages and inherited harness source unchanged from base; worktree remained clean.

Supplied evidence only: operator-chain log includes **22/22** M5-011 checks; browser stress **100/100**; schema validation accepts ten documents and rejects the invalid control. Root success is recorded at earlier head `f0b9176…`; final-head root/CI remain pending evidence. I did not rerun resource-creating suites, access credentials, inspect closed registers or use authenticated tools. This reviewer session’s actual model/effort requires same-launch host attestation; repository configuration alone does not establish it.