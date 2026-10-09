**CHANGES_REQUIRED — Standards/security**

1. **P2 — [cli.mjs:36](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/cli.mjs:36): credential reader loses its deadline when the supervisor dies.** The [credential contract](/home/serveradmin/insignia-m5-native-inventory-worktree/docs/delivery/M5-NATIVE-INVENTORY-COLLECTOR.md:33) requires bounded reading and cleanup within five seconds. The reader has no independent deadline; its kill timer exists only in the CLI. Counterexample: an inherited pipe supplies token bytes but withholds EOF, then the CLI receives SIGKILL before its timer fires. The child survives, blocked on its next read, retaining the descriptor and token buffer indefinitely. Closing its stdout receiver does not interrupt that read because output occurs only after EOF. **Smallest fix:** give the reader its own hard termination deadline while retaining supervisor kill/reap behavior. Add a public CLI regression that kills the supervisor during withheld EOF and verifies the reader terminates. This counterexample is static, not executed.

The accepted R1 corrections are present. Current correction hashes match; original manifests remain byte-identical to R1. No other actionable Standards/security finding identified.

Verified clean worktree, three-dot diff and all three commits:

- Base/effective merge-base: `d9ba6383a6e15958419ecf8e26d9182f08078e41`
- Head: `c5b3ad9d2a82d5fae88a2026eac2946de4adaf93`
- Tree: `67320bfe17d5ac194311949a8489d164d5e41c8a`

Static local source/Git/evidence review only. No edits, tests/builds, credentials/environment/.ssh reads, services, network, delegation or native calls. Recorded passes were inspected, not rerun. Filesystem read-only was enforced; credential/network isolation and actual model/effort provenance are not independently verified here. No current CI green, native qualification or M5/G7 acceptance is asserted.