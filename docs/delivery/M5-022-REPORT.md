# M5-022 — authentication and trusted readiness correction

**BLOCKED_PRODUCTION_PROVISIONING_REQUIRED / M5_G7_NOT_PASSED.** The authorized offline correction is integrated; native qualification stops before deployment because the exact production tenant/current installation and trusted/commercial prerequisites are missing. [Provisioning proposal](M5-022-PROVISIONING-PROPOSAL.md), [G7 matrix](M5-022-G7-MATRIX.md), [bounded accounting](evidence/m5-022/accounting-register.json). No production DML/provisioning, corrected web deployment, new owner Search or fixture occurred. The historical Search root cause remains unverified.

## Authority and entry

The supplied [M5-022 brief](prompts/M5-022-AUTH-READINESS-G7-CLOSURE.md) and [principal approval](PR-052-principal-review.md) are preserved alongside the six byte-exact [authority files](evidence/m5-022/authority/README.md). Archive SHA256 `95d20ee158f158145ecdbc95ec15eb24bc317ad2088ce34fbecd46c0b6fcae69`. PR52 exact approved base/head/tree, ten natural exact-head attempt1 workflow successes, two actual fresh CLEAR reviews and the supplied external approval were reverified. No native GitHub approval was fabricated.

[Normal merge receipt](evidence/m5-022/pr52-merge-receipt.json): merge `e132c108a2108aea830ac2a5229b410f93a61a7d`; ordered parents `db4265228b901a99cd4e3602ee0c387065080cc6`, `39c77ee73f7534e01a47853968eec8c139d917c6`; tree `315cc4cf18c3c1eef0cb0d8fa3c542fc5170bed5`. The implementation branch starts from that fetched main. No squash/rebase, force push, protection bypass or approved-head change.

Canonical Insignia remains `https://insignia-app.optidigi.nl`, embedded `/admin/products`. Accepted Active `1158986629121 / m5-019r-9b94149272d1`, rollback `1153019904001 / insignia-3`, old `1158837927937 / m5-019-a9717e1265ef` NEVER_RELEASE. These are retained accepted identities; M5-022 performs no new Shopify version/config/readback operation or per-store version-equality claim.

## Authentication correction

The pinned Shopify SDK adapter preserves only `InvalidJwtError` or its actual HTTP400 `invalid_subject_token` rejection as `ONLINE_EXCHANGE_REFRESH_REQUIRED`. Only that typed exchange outcome maps to HTTP401 with `X-Shopify-Retry-Invalid-Session-Request: 1`. Missing/invalid bearer and locally invalid/expired identity keep ordinary401. Other exchange 400/401/5xx/network/deadline errors and generic provider/database failures remain fail-closed503, with no retry header. Existing scope authorization and current-installation fences remain enforced.

The existing production browser obtains a fresh App Bridge token and performs at most one manual retry on401. A production-bundle control exercises one Search for 401→200, 401→401,403 and503, proving fresh synthetic token per attempt and respectively two/two/one/one requests. Pinned Polaris custom elements execute in Chromium; App Bridge token/transport boundaries are synthetic. Native CDN/browser/store behavior is not claimed from this control.

Diagnostics retain only closed stage enums, independent random UUID correlation, bounded success/refresh/failure class and timestamp. They distinguish exchange/grant/provider shape or read, tenant/database reconciliation, missing/inactive installation and ID mismatch, with successful stages for future bounded qualification. SDK raw logging is disabled. Tokens, secrets, raw response bodies, auth query values and staff/session identity are not emitted or retained as error causes. No live corrected-build diagnostic or owner Search was collected.

## Trusted readiness correction

New migration16 creates append-only operator-owned `trusted_release_records`. UPDATE/DELETE/TRUNCATE are blocked; runtime access is SELECT-only. The durable facade exposes only a scoped reader, not a writer or raw executor. Wrong/ambiguous global Active evidence, invalid latest records, expired/stale/future evidence, writable runtime credentials, wrong scope/reinstall/inactive state and malformed/digest-mismatched evidence fail closed. Replacements append; no historical v1/v2/v3 JSONB is rewritten.

The production composition uses existing `ActivationReadinessPort`, `createServerActivationReadiness` and `TrustedReleaseRecordSource`, independently stored expected Function build, actual Function ownership reconciler in authenticated shop/install scope, and current authenticated `shop.ianaTimezone` preloaded into a synchronous `currentDay`. No browser timezone, unsigned environment release JSON, UTC fallback or awaited calendar IO. The accepted Active version is a reviewed runtime bound; a stored record cannot override it. Existing exact 30-second freshness and expiry are preserved without timestamp tolerance/restamping.

Real production composition controls use the signed SDK exchange, PostgreSQL durable tenant and SELECT-only release credential with synthetic provider transport. Missing trusted evidence remains `ACTIVATION_WAITING_RELEASE`, effective revision null and zero remote writes. Present trusted evidence reaches the current Function observer; mismatched Functions still remain waiting with zero mutation. DST/date-boundary vectors cover both repeated/skipped hours and server/merchant-day differences. These are offline tests, not live release readiness.

## Actual production diagnosis and live stop

Owner renewed restricted temporary SSH access and supplied the exact public host fingerprint. [Sanitized diagnosis](evidence/m5-022/production-diagnosis-summary.json) proves current container/image identity, read-only root/node runtime, expected env-key presence only, PostgreSQL18.6 connectivity, zero exact designated tenant/current-install rows, absent trusted relation and four absent commercial/Partner configuration keys. No values, auth tokens or staff identity were output. There is no durable external-installation ID to compare and no shop-ID mismatch classification can be made without a tenant.

The first locally misescaped diagnostic helper did not complete SQL; its failed [output](evidence/m5-022/production-readonly-diagnosis.jsonl) remains separate and is not a database failure. Corrected helpers were syntax-checked locally and performed bounded READ ONLY/ROLLBACK queries; [v2](evidence/m5-022/production-readonly-diagnosis-v2.jsonl) and [v3](evidence/m5-022/production-readonly-diagnosis-v3.jsonl) retain actual observations. No generic production table dump or DML occurred. [Temporary access revocation](evidence/m5-022/temporary-key-revocation-final.json) removed exactly its public entry, preserved all others byte-for-byte and removed the local private key.

These missing prerequisites independently require unapproved provisioning. They do not prove that the original owner's exchange succeeded or identify the original first failing stage. Authenticated live grants/staff, Function ownership/enablement, signing/commercial readiness and merchant timezone remain unknown. Source implementation may be reviewed now; production provisioning and the dependent deploy/Search/G7 branch require a separate principal decision. The app is not diagnosed by guessing a missing scope or secret.

## Verification and review binding

Pinned repository TDD/diagnosing-bugs skills were exercised with actual red/green SDK, HTTP, stage, logger, calendar and trusted-database controls; failed development checks remain in the neutral handoff. Full root, PostgreSQL18, built admin/browser/publication/activation, publication stress, renderer negative control, migration rehearsal/query plans and style/secrets/boundaries are recorded in [local qualification](evidence/m5-022/local-checks.json). Successful compilation or synthetic checks do not satisfy native G7.

Two NEW actual GPT-6.1-sol/high full-source Spec/correctness and Standards/security completed-change reviews and all naturally applicable final-head attempt1 CI must be CLEAR/green in the external exact-ref principal packet. PR52's entry reviews are not reused as successor reviews. That packet binds final base/head/tree/effective merge base and immutable report/settings hashes after committing, avoiding commit self-reference. No approval fields are filled by the agent.

The exact production input/source/Function/config/history integrity comparison accompanies qualification. Web auth/readiness source/build changes are intentional and local only; dependencies, provider configs, Function source/artifact bindings, v1/v2/v3 semantics and sealed historical provider runs remain unchanged. No deployment freeze is claimed as an exercised live gate; deployment and native fixture phases are NOT_RUN. Local PostgreSQL writes use a new loopback disposable database only.

Return one integrated successor PR for principal review. No successor merge, provisioning, deployment, new owner Search, fixture, Shopify version/release/rollback/scope change, M6/M7 or merchant rollout is authorized by this stopped result.
