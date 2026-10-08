# M5-020 — existing-version release control

Read the [slice](../../docs/delivery/prompts/M5-020-RELEASE-AND-G7-CLOSURE.md), [report](../../docs/delivery/M5-020-REPORT.md) and current state. This controller has exactly one existing-version release path; it neither creates an app version nor authorizes provisioning.

Run offline controls with `python3 -B deployment/m5-020/release-existing.test.py`. The real command is unavailable until `/home/serveradmin/insignia-m5-020-handoff/pre-release-gate.json` binds complete clean source/build/context/CLI/runtime inputs, fresh native facts, current host/version observations, two actual CLEAR review settings/reports and all ten exact-source attempt1 CI runs. Freeze only after all inputs qualify; validate the complete gate before dispatch. Missing owner-native proof is not a waiver.

The supported fixed operation is `app release --version m5-019r-9b94149272d1 --allow-updates`, with pinned Node24.21.0/CLI4.8.2 and exact app context. The helper adds only fixed path/config/no-color arguments. `--allow-deletes` is absent. Existing credentials remain in the owner's HOME; private CLI output never belongs in Git.

A fsynced exclusive reservation precedes process startup. Any failure, timeout or unacknowledged output consumes the attempt. Exit0 alone is insufficient: CLI userErrors may also exit0. Exact success ACK still requires independent post-release Active/config/UID readback. No automatic retry or rollback exists in this controller.

Only after real installation/grants/staff and trusted release/build/Function/commercial readiness pass may the one authorized product/ProductConfig branch begin. Stop on missing provisioning. Preserve every historical run and production artifact. Return an integrated evidence PR and stop; do not merge it.
