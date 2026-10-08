# Insignia — PR #53 approval + M5-023

PR #53 is approved at the corrected M5-022R head.

Accepted:
- typed Shopify auth refresh handling;
- safe auth-stage diagnostics;
- trusted activation-readiness implementation;
- append-only trusted-release persistence;
- fail-closed populated down migration;
- read-only production diagnosis.

M5/G7 remains open because production still lacks:
- a reusable managed-install first-session tenant/install bootstrap;
- production migration16/trusted-release operator+runtime provisioning;
- a fresh exact trusted release record;
- owner-backed commercial entitlement configuration.

M5-023 closes authentication/bootstrap/trusted-readiness production wiring and deploys the corrected web runtime. It may continue into G7 only as far as legitimate owner-backed commercial configuration permits.

No Shopify app version/release change is expected.
