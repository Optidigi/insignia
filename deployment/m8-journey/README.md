# Release profiles and database grants

This directory supplies the immutable module baselines and release bindings consumed by `scripts/release/profiles.mts` and `scripts/release/launch.mts`. Historical profiles remain necessary to identify and reject drift in recorded releases; their presence authorizes no release or mutation. `standard-entitlement-policy-candidate.json` is consumed by the entitlement contract tests and remains separate from financial authority.

`web-runtime-grants.sql` and `merchant-preview-runtime-grants.sql` supply restricted database-role responsibilities, exercised by the actual PostgreSQL role tests. Preserve those permissions and applied-schema identities.

Current service deployment and recovery belong in the [runtime procedure](../m5-runtime/README.md), [inspector procedure](../artwork-inspector/README.md) and [delivery state](../../docs/delivery/state.md). The inspector is packaged and verified by `deployment/artwork-inspector`; obsolete mutable-checkout units, connection samples and settled app-change proposals were removed. Recover dated observations and proposed effects from [fixed Git history](https://github.com/Optidigi/insignia/tree/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/deployment/m8-journey), rather than replaying their instructions.
