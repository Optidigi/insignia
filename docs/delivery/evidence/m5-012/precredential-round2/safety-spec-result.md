One unresolved material **Spec finding** at base `9edc6f3c4d186f760a0fe416bfdbccd8f2989f7e` → head `b70207ad43316cbffb78f98d3261bd94bf2b920a`.

**P2 — failed reads remain retryable, allowing cleanup without final-read capacity.** [operator.mjs:316](/home/serveradmin/insignia-m5-012-worktree/scripts/m5-012/operator.mjs:316) accepts the current step again after a settled failure because only successful reads advance `state.step`; the failure path leaves no terminal fence. This violates “No retry” and “Then perform one exact readback.”

**Executed counterexample:** authenticate; return `errors:false` on identity; catch its rejection; retry identity successfully; complete the remaining six reads; request ARCHIVED. The operator dispatches cleanup at **auth1/read8/update1**, then rejects final readback with `ceiling`. The qualification wrapper currently stops on the original failure, but the public durable-operator seam permits this sequence.

**Smallest fix:** reject any read operation already reserved in durable events, including failed attempts. Preserve final-read capacity before admitting cleanup. Add a public-seam regression asserting the retry causes no HTTP dispatch and update0.

Both round-1 defects are corrected: malformed `errors` properties stop, and rejected foreign descriptive data is absent from retained evidence.

Examined: requested diff/log; all six M5-012 files; complete M5-004 operator/qualification/binding, M5-010 recovery, M5-011 operator/documents; all Shopify barrel-loaded source/runtime modules and availability contract; authority/architecture documents, full round-1 reports/response, approval/merge receipts, package integration and ten workflows.

Actually executed:

- Six syntax checks and secret/provenance checker: passed.
- All 27 committed operator tests with synthetic HTTP, memory-backed filesystem and cross-realm assertion normalization: passed, including 100 serial scenarios.
- Additional reservation/fsync and event-index0 quarantine probe: passed.
- Retry/cleanup counterexample: reproduced.
- Authorization hashes, external approval copy, 26 prior-bound build hashes and 27 closed-register hashes: matched; production source unchanged.
- Binding metadata test passed; full freeze test blocked by sandbox `spawnSync git EPERM`.
- Diff whitespace check failed on preserved red-log whitespace.

Supplied evidence only: focused29/29 and browser stress100/100; root output inspected. CI snapshot showed nine successes and one in progress.

Verdict: **material finding remains; precredential gate incomplete**. Credentials **NOT_ACCESSED**; live **NOT_RUN**. No principal/native approval. Actual model/effort metadata is not self-attested here.