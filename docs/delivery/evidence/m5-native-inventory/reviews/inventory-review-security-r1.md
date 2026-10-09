**CHANGES_REQUIRED — Standards/security**

1. **P2 — [phase.py:463](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-inventory-phase/phase.py:463): SSH can select a different identity from the inspected file.** The fixed-access contract requires the exact approved restricted key. Validation accepts `%` and `${…}` in `identityPath`; OpenSSH expands these in `IdentityFile`. For example, `/private/key-%h` passes metadata checks against that literal filename, but SSH reads `/private/key-65.109.22.104`. The latter key’s permissions and forced-command binding were never checked. Smallest fix: apply the existing conservative path-character allowlist to the identity path before reservation or authentication, rejecting expansion syntax.

2. **P2 — [cli.mjs:34](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/cli.mjs:34): token descriptor timeout does not bound a blocking read.** The collector contract requires EOF within five seconds. An inherited blocking pipe whose writer stays open without sending bytes leaves `createReadStream`’s filesystem read pending. Calling `destroy()` does not cancel that blocking read; stream destruction and process termination can remain stalled beyond the deadline. Existing tests always close the descriptor. Smallest fix: use cancellable nonblocking pipe/socket reads, or a separately supervised reader with a hard deadline. Add a public CLI control whose writer withholds EOF.

Verified clean worktree, nonempty three-dot diff and both commits:

- Base/effective merge-base: `d9ba6383a6e15958419ecf8e26d9182f08078e41`
- Head: `6f899be0a0eb226bb257d99be249a9e4a86fa54d`
- Tree: `ff9b0fd94491ecd2ab2f8b0f1edd842f4dc83cf2`

Static source/Git/evidence inspection only; counterexamples were not executed. No edits, tests/builds, credentials/environment/.ssh reads, services, network, delegation or native calls. Filesystem read-only was enforced; credential/network isolation is not claimed. Actual GPT-6.1-sol/high selection is not verifiable from this session. Current CI and native safety remain unqualified; this verdict grants no milestone acceptance.