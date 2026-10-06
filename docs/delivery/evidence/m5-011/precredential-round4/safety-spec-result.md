**One unresolved material finding. Keep the precredential gate CLOSED. Live experiment: NOT_RUN.**

Base: `1fffcb3048952ff762f1f9805f86aceed90f228f`  
Head: `29539bb839e73332ab5a969fa77e81e432803bcf`  
Tree: `53b01f75c3041d916dbb56850c2b985397fd7c2a`

**Spec — P2: non-200 response bodies escape transport quarantine.** [operator.mjs:483](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:483) skips body handling for non-200 responses, then marks the underlying transport settled. Consequently, line 621 clears `pending` while that response stream remains open. This violates the requirement: “No blind retry or parallel provider calls.”

**Executed counterexample:** the synthetic ARCHIVED mutation returns HTTP 503 with an open, unfinished body stream. Qualification dispatches its bounded final projection while that stream remains active. The reproduction recorded `overlapped=true`, `bodyOutstanding=true`, `cancelled=false`, reads **16**, updates **2**, and archive settlement **UNKNOWN**. Cleanup reports `UNKNOWN_WRITE_OBSERVED_ARCHIVED`.

**Smallest correction:** complete or cancel the non-200 body and await its disposal under the existing deadline before clearing quarantine. If disposal remains outstanding, retain UNKNOWN/pending and prohibit the bounded read. Preserve the production adapter’s HTTP classification and add this streamed-503 regression.

**Standards/security:** the same transport correctness defect; no additional material finding. The four round-3 corrections otherwise passed their existing regressions.

**Evidence detail**

Examined all six `scripts/m5-011/*` files in full; availability production source, built JS/declarations and tests; application availability contracts; interacting M5-004/M5-009/M5-010 operator, binding, qualification and recovery modules; governing documents, report/research, configuration, package scripts, CI and review evidence.

Actually executed:

- Required fixed diff/log and ref checks; final checkout clean.
- Production packages and inherited harness source unchanged against base.
- Independent rehash matched all **2,746** frozen source/build entries.
- In-memory TypeScript compilation reproduced all **92** emitted files across the four frozen packages, with zero diagnostics.
- Behavioral suite: **30/30**, using in-memory filesystem and synthetic HTTP boundaries, including 100 serial cases.
- Additional streamed-503 counterexample reproduced successfully.
- Gate-record test passed; full freeze test was **unavailable: `spawnSync git EPERM`**.
- Syntax, secret/provenance and authorization-manifest checks passed. Diff whitespace check reported whitespace in preserved evidence.

Supplied evidence inspected separately: focused **32/32**, browser stress **100/100**, schema controls, and completed root receipt with database checks skipped. The latest local CI snapshot records **10/10 success**, attempt 1, on this exact head; remote CI was not queried.

Disk durability and live Shopify behavior were not exercised. Same-launch reviewer model/effort attestation was not independently exposed here. No credentials, closed prior registers or authenticated tools were accessed; no files or resources were created. This report grants no external principal approval.