**CHANGES_REQUIRED**

1. **P2 — [cli.mjs:34](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/cli.mjs:34): token-input timeout cannot interrupt a blocking read.** The bounded private-FD requirement specifies EOF within five seconds ([collector spec:33](/home/serveradmin/insignia-m5-native-inventory-worktree/docs/delivery/M5-NATIVE-INVENTORY-COLLECTOR.md:33)). Counterexample: fd 3 is a blocking pipe whose writer remains open without sending data or EOF. The timer calls `ReadStream.destroy()`, but the installed Node implementation waits for pending filesystem I/O before completing destruction. Consequently, the CLI can hang indefinitely instead of reporting `PRIVATE_INPUT` within five seconds. This conclusion comes from static inspection of the CLI and installed Node stream implementation; it was not dynamically reproduced. **Smallest fix:** use a cancellable descriptor reader, reject unsupported descriptor types, preserve the byte cap, and add a regression covering a writer that never closes.

Full changed source, tests, documentation/evidence and interacting source reviewed. No other actionable Spec/correctness finding identified.

Verified clean worktree and exact refs:

- Base/effective merge-base: `d9ba6383a6e15958419ecf8e26d9182f08078e41`
- Head: `6f899be0a0eb226bb257d99be249a9e4a86fa54d`
- Tree: `ff9b0fd94491ecd2ab2f8b0f1edd842f4dc83cf2`

Limitations: static local review only; no edits, tests/builds, credential/environment reads, services, network, delegation or native calls. Recorded 89 Admin/17 host/12 phase passes were inspected, not rerun; applicable CI remains awaited. No native qualification, milestone acceptance, or credential/network isolation is asserted. Actual GPT-6.1-sol/high provenance is not verifiable from this session.