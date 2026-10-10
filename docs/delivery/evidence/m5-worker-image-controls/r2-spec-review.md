**CHANGES_REQUESTED — Spec/correctness.** One blocking finding.

**P2 — Finalization can skip owned removal commands.** [image-observations.mjs:53](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-observations.mjs:53) shares one 60-second abort signal across both log captures and all four removals. The [runtime command wrapper:86](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-runtime.test.mjs:86) additionally permits five seconds for each command’s log persistence. Consequently, the configured sequence permits `2×(5+5) + 4×(10+5) = 80` seconds. After the shared signal expires, [runImageCommand:6](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-observations.mjs:6) rejects before spawning subsequent commands.

A scaled, write-free command-boundary control reproduced this: image removal never launched, although its cleanup entry recorded FAIL. Qualification fails honestly, but the IMAGE-CONTROLS requirement to “attempt every owned removal” remains unmet.

**Smallest fix:** reserve independent bounded execution time for every removal, accounting for log persistence, context removal and receipt writing within the 90-second finalization allowance. Add a control proving earlier timeout/log failures cannot prevent later removal commands from launching.

Personally completed the review of all 26 changed files, affected packaging/build/inventory/roles/worker/queue/health/recovery source, authority documents and relevant historical controls. Review binds to:

- Base: `659f118ddc9bdc8b5d33141f6395182ba6ba9bcb`
- Head: `c21c67c218c09315873fe16dd711bd12776dd617`
- Tree: `8139622770fef9a02d43024d36d77dc7a4f8c19a`

R1’s malformed program and false-PASS log handling are corrected. Database children now have cancellation and process-group termination; the endpoint qualifier binds the owned internal IPv4 fixture without publishing ports. Frozen package/base/Node inputs and prior safety/whole-quote/availability contracts remain unchanged.

Actually performed: five in-process controls passed, zero skips; both exact assembled programs parsed in memory; all 22 manifest hashes and 13 changed JSON files validated; 18 active relative links resolved; archived state matched base bytes exactly. Permitted PG18 log hashes/counts and shutdown metadata match the retained 222 database/31 worker/2 queue-crash results; those suites were inspected, not rerun.

The complete local process-control suite did **not** qualify here: child-output assertions failed, and a separate spawn probe reported EPERM. Parent ten-control PASS remains inspected evidence.

Historical R1 rejection/CI failure and selected-web completeness, HTTP-count, ABA and operator-retention limitations remain honest. No modifications, delegation, credential access, network or production operations occurred. Working tree remains clean. Docker/native qualification and new exact-head CI remain pending; no principal or M5/G7 verdict is inferred. Actual model/effort provenance remains for parent verification.