**CHANGES_REQUIRED**

1. **P2 — [collector.test.mjs:1055](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/collector.test.mjs:1055): orphan-reader control stops observing before verifying pipe closure.** The helper exits its polling loop upon observing `Z`/`ABSENT`, then probes EPIPE only once, abandoning the remaining six-second observation window. This fails to reliably qualify the required termination-and-descriptor-release control and blocks [exact-head qualification](/home/serveradmin/insignia-m5-native-inventory-worktree/docs/delivery/operating-model.md:52).

   Concrete counterexamples: retained current-head attempt-1 logs for runs `37960035511` and `37960035570` show `readerState:"Z", pipeClosed:false`, failing line 1102 after approximately 5.1 seconds. These failures affect normal and retained-zombie modes respectively. [Runtime log](/home/serveradmin/insignia-milestone-autonomy-handoff/inventory-r4-ci-37960035511-failed.log:117), [foundation log](/home/serveradmin/insignia-milestone-autonomy-handoff/inventory-r4-ci-37960035570-failed.log:1138).

   Smallest fix: observe terminal state **and** EPIPE within the existing deadline, using a bounded nonblocking pipe probe. Preserve strict live-process errors, cleanup and mandatory closure assertions. The retained logs establish failed qualification; they do not establish the underlying production cleanup cause.

Verified clean worktree and exact refs:

- Base/merge-base: `d9ba6383a6e15958419ecf8e26d9182f08078e41`
- Head: `56356536d26a5a262bc37e2b309c17824671643e`
- Tree: `a5fe3b59e80f0773c35b5d3457c9e86fca5565bc`

Reviewed complete changed source/tests/docs/evidence and interacting source. Historical/current artifact bindings checked without mismatches; runtime bytes remain unchanged from R3.

Static local review only: no edits, execution, credentials, network, delegation or native access. CI conclusions above derive from retained local evidence, without remote verification. Requested model/effort provenance was not independently verifiable. No privacy, generation, M5/G7 or principal acceptance is implied.