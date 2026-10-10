**CHANGES_REQUESTED — Standards/security.** One blocking finding.

**P2 — Shared finalization deadline can prevent owned cleanup commands from launching.** [image-observations.mjs:53](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-observations.mjs:53) gives all log collection and removals one 60-second signal. Each command also allows a five-second raw-log write at [image-runtime.test.mjs:86](/home/serveradmin/insignia-m5-worker-image-control-worktree/scripts/m5-024/image-runtime.test.mjs:86). Two log captures can therefore consume 20 seconds, and four removals another 60. Once the shared signal expires, `runImageCommand()` rejects before spawning subsequent commands. Recording their failure does not attempt their removal.

A scaled, memory-only check of the unchanged finalizer reproduced this: both container removals launched, network removal encountered expiration, and image removal never launched. Qualification correctly failed, but the required complete owned-cleanup contract was unmet.

**Smallest fix:** give each removal independent bounded cancellation and reconcile the combined command, log-write, context-removal and receipt-write allowances with the finalization reserve. Add a control proving that slow earlier finalization cannot prevent later owned removals from launching.

Personally completed the read-only review of all 26 changed files and relevant packaging/build, inventory, role installation, worker composition, queue, health, recovery and historical controls. Review binds to:

- Base: `659f118ddc9bdc8b5d33141f6395182ba6ba9bcb`
- Head: `c21c67c218c09315873fe16dd711bd12776dd617`
- Tree: `8139622770fef9a02d43024d36d77dc7a4f8c19a`

The R1 assembled syntax, fatal-log handling and database-child cancellation corrections are present. Package/base/Node and production application contracts remain unchanged. Selected-web receipts preserve their HTTP-count, completeness, continuous-Active/ABA and operator-cleanup limitations. Original rejected reviews and CI failure remain retained.

Actually performed: five pure controls passed with zero skips; three exact assembled programs parsed in memory; all 22 manifest hashes matched; 13 JSON files parsed; active links resolved; archived state matched base bytes exactly; diff whitespace check passed. Permitted parent log hashes and 222 database/31 worker/2 queue-crash counts matched, with shutdown exit0. Those database suites were inspected, not rerun.

The full subprocess-control attempt was restricted by this sandbox (`EPERM`/empty child output), so I do not claim those controls requalified. Docker/native image execution was **NOT_RUN**; corrected natural exact-head CI remains pending.

No delegation, modifications, credential access, network or production operations occurred. Working tree remains clean. Actual model/effort/completion provenance remains for parent verification; no principal or milestone verdict is inferred.