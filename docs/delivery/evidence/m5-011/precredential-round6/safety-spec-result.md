**One unresolved material finding. Keep the precredential gate CLOSED. Live experiment: NOT_RUN.**

Base: `1fffcb3048952ff762f1f9805f86aceed90f228f`  
Head: `33a4ab5ebe3fa78bb2caa21b4a2d4c31a3bf9462`  
Tree: `d00c814c5fe858d3ea00032d8023334d2e50f3f4`

**Spec — P2: malformed scope entries still change the production adapter’s failure branch.** At [operator.mjs:566](/home/serveradmin/insignia-m5-011-worktree/scripts/m5-011/operator.mjs:566), grant validation dereferences `y.handle` without validating each entry. A null entry throws `TypeError`; the catch converts it into a transport failure.

**Executed counterexample:** after an acknowledged DRAFT update, append `null` to the otherwise valid readback scope list. Direct production `acquire` fails with `provider_shape`; wrapped qualification records `ambiguous_write`. Observed accounting: **auth1/read10/update1**, cleanup **null**. This violates “preserve normal production-port wire/error semantics” and misrecords the required “adapter result … and accounting.” Cleanup stops safely; this is a material evidence-correctness defect.

**Smallest correction:** validate scope-entry shape before dereferencing and return original bounded bytes through the existing shape-preserving fallback. Keep required-grant loss and grant drift fail-closed. Add direct-versus-wrapped regressions for malformed entries, including post-mutation readback.

**Standards/security:** the same correctness defect; no additional independent material finding. Event-zero fencing, concrete catalog validation and the five transport-quarantine regressions passed. I found no remaining branch releasing serialization while disposal is outstanding.

Evidence detail:

- Examined all six M5-011 modules in full; production availability source/build/declarations and tests; application contract; interacting M5-004/009/010 operator, binding, qualification and recovery modules; governing documents, configuration, scripts, CI, report/research, and both reports/responses from rounds 3–5.
- **Actually executed:** requested diff/log and ref checks; **39/39 behavioral tests** with filesystem writes redirected to memory and synthetic HTTP, including 100 serial cases; gate-record test; counterexample above; six syntax checks; code/config whitespace checks; in-memory compilation reproducing **92/92 outputs**, zero diagnostics; authorization manifest **6/6**. Production source is byte-identical to base. Checkout remained clean.
- **Supplied evidence inspected, not rerun:** focused **41/41**, browser stress **100/100**, schema controls and successful root receipt with matching log hashes. Local database-gated tests were skipped. Latest exact-head CI snapshot shows **9/10 success**, foundation still running; remote CI was not queried.
- Full freeze verification and disk durability were **NOT_RUN**.

Same-launch model/effort attestation was not exposed here and remains required before counting this review toward the gate. No credentials, authenticated tools, provider operations or filesystem resources were accessed or created. No external principal approval is granted.