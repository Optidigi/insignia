**Standards/security: CHANGES_REQUESTED — two blocking findings.**

Personally reviewed all 21 changed files, the complete three-dot diff, interacting HMAC/bootstrap/webhook/queue/generation/privacy source, live governance, pinned skills and accepted M5-025/026/027 contracts. No delegation.

Verified base/effective merge base `b2f42b1895af37a421f2a8fc49d845412b120792`, HEAD `efe045fb3184a84c57b976bea08c545a85237f28`, and tree `3c9697376896f051ee210bb9d9d0ffd54d5633fd`.

1. **[P1] Expiry can leave the process, purpose key and receiver lock alive indefinitely.** At [receiver.mjs:140](/home/serveradmin/insignia-m5-private-callback-receiver-worktree/scripts/m5-callback-qualification/receiver.mjs:140), key wiping and lock release await `server.close()`. An unfinished-header connection has no application body timer. In pinned Node24.21.0, HTTP `close()` cancels the header/request timeout checker while waiting for active connections. Consequently, that connection can prevent cleanup indefinitely. The expiry test at [receiver.test.mjs:360](/home/serveradmin/insignia-m5-private-callback-receiver-worktree/scripts/m5-callback-qualification/receiver.test.mjs:360) has no open connection and misses this case.

   **Personally reproduced:** the unchanged receiver function with the actual Node HTTP parser and a memory Duplex transport retained the key and lock after acceptance, retention and the five-second timeout had elapsed; the timeout checker was cancelled. Destroying the memory connection completed cleanup. No network was used.

   **Smallest correction:** actively destroy outstanding connections during deadline shutdown, settle or abort admitted handlers, and ensure key wiping and lock cleanup complete. Add a real HTTP regression with unfinished headers across expiry.

2. **[P2] Recovery and erasure lack mutual exclusion with receiver startup.** [operator.mjs:117](/home/serveradmin/insignia-m5-private-callback-receiver-worktree/scripts/m5-callback-qualification/operator.mjs:117) unlinks the lock by pathname after checking a previously read PID. Two recovery calls can both validate the old dead PID; after the first removes its lock and a restarted receiver acquires a replacement, the second removes the live receiver’s lock. Likewise, [operator.mjs:125](/home/serveradmin/insignia-m5-private-callback-receiver-worktree/scripts/m5-callback-qualification/operator.mjs:125) checks lock absence before recursive removal, allowing startup between that check and erasure.

   **Personally reproduced:** both interleavings using the actual operator function bodies and entirely synthetic memory filesystem/process boundaries.

   **Smallest correction:** serialize startup, recovery, release and erasure through one exclusive cross-process lifecycle guard; validate ownership while holding it. Add concurrent recovery/startup and erase/startup controls. Another unguarded pathname check leaves the race.

These are security-contract defects, not smell heuristics. I found no additional actionable standards findings.

**Personally verified:** all 39 manifest content/input pins, the three supplied freeze hashes, seven unchanged receiver files, unchanged accepted verifier, byte-exact archived state, and clean diff/working tree. Ten synthetic pure-memory HMAC/AES-GCM controls passed.

**Inspected, not rerun:** recorded 15 HTTP/operator/restart controls, retained RED/GREEN and portability failures, parent build/style/boundary/secrets evidence, and PR69 receipts. Current-head CI was not remotely verified. No files were modified; no credentials, caches, environment values or actual private callback captures were accessed.

Remaining limits stay explicit: native payload authority, registration gaps, genuine uninstall/privacy fulfillment, TLS/logging, OS isolation/resources, signing-FD supervision, source immutability and host allocation remain unqualified. FD3 EOF can hang; current-capability replay remains residual; expiry does not perform erasure; exports/device/backups remain unqualified and whole key/spool copies decrypt.

This is a local slice verdict. **M5/G7 remain NOT_PASSED.** Actual model/effort and completed-turn/process attestation remain for parent verification.