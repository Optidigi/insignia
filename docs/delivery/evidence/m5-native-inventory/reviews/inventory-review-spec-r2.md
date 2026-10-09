**CHANGES_REQUIRED — Spec/correctness**

1. **P2 — [cli.mjs:20](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/cli.mjs:20), [collector.mjs:463](/home/serveradmin/insignia-m5-native-inventory-worktree/scripts/m5-native-inventory/collector.mjs:463): private-file rejection can block indefinitely.** The [spec requires a regular allocation file](/home/serveradmin/insignia-m5-native-inventory-worktree/docs/delivery/M5-NATIVE-INVENTORY-COLLECTOR.md:35) and [refusal of unsafe sealing inputs](/home/serveradmin/insignia-m5-native-inventory-worktree/docs/delivery/M5-NATIVE-INVENTORY-COLLECTOR.md:90). Both paths call blocking `open(O_RDONLY | O_NOFOLLOW)` before checking file type. Counterexample: supply a named FIFO with no writer as `--allocation`, or as `journal.json` for `--seal-abandoned`. Opening waits indefinitely, so validation never runs; the corrected credential-reader timeout does not cover either path. **Smallest fix:** add `O_NONBLOCK` to both opens, retain descriptor-based regular-file validation, and add public CLI controls for writerless FIFOs. This counterexample is statically established, not executed here.

Both R1 corrections are implemented. Correction-manifest hashes match current artifacts; original manifests are byte-identical to R1 and remain historical. No other actionable Spec finding identified.

Verified clean worktree, three-dot diff and three-commit log:

- Base/effective merge-base: `d9ba6383a6e15958419ecf8e26d9182f08078e41`
- Head: `c5b3ad9d2a82d5fae88a2026eac2946de4adaf93`
- Tree: `67320bfe17d5ac194311949a8489d164d5e41c8a`

Limitations: enforced filesystem read-only; static local source/Git/evidence inspection only. No edits, tests/builds, credential/environment/.ssh reads, services, network, delegation or native calls. Recorded 91/17/13 passes were inspected, not rerun. Current-head CI remains unverified; no native safety, milestone acceptance or credential/network isolation is asserted. Actual GPT-6.1-sol/high provenance is not verifiable from this session.