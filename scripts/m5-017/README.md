# M5-017 fixed qualification

Use this operator only under the [M5-017 authorization](../../docs/delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md). Read the [report](../../docs/delivery/M5-017-REPORT.md) for dispatch ownership, residual guarantees and evidence limits.

Before live entry, freeze committed source/build, complete local checks, two clear actual GPT-6.1-sol/high full-source reviews and all eleven applicable exact-source attempt-1 passing workflows. Save and verify the full gate in `/home/serveradmin/insignia-m5-017-handoff`; initialize the fresh canonical run only through the guarded entry.

Run `entry.mjs start` once. Proceed to `entry.mjs resume` in a genuinely fresh process only when start returns AWAITING_FRESH_PROCESS with exact persisted hold bytes/hash and settled accounting. Each phase is non-reentrant. The operator reserves restore and its conditional compensation before production dispatch. A reservation does not mean the corresponding provider attempt occurred.

After first provider access, production source/build are immutable. A production defect ends qualification for principal review. Close/seal the run before adding documentation/evidence. Historical registers and archived products remain closed. Never merge the successor PR.
