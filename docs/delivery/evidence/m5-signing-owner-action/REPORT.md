# Fixed signing owner action — local qualification

Author worktree: `/home/serveradmin/insignia-m5-signing-owner-action-worktree`, branch `feat/m5-signing-owner-action`, base `bbec1483a7a8b91e7c8a2306d896128b40136d72`. Uncommitted source prepared for W18 integration and independent whole-source review. Native operations, real credentials, provider calls, SSH and deployment: **NOT_RUN**.

The built server exposes one fixed authenticated signing action and read-only status recovery. It reuses the accepted signing operator's complete lifecycle, crypto, generation, trusted-day, public-config CAS/readback, freshness and settlement implementation. `signing-provision-core.mjs` contains the original helper body byte-for-byte, except trailing separator whitespace; a control compares that span to the unchanged historical executable. The historical executable SHA-256 remains `421db4316c3f130b01d64c49dc93b332420eca72d6405767218cc7e38a9da56e`. The pure core excludes executable stdin, logging, environment reads and CLI initialization, so bundling cannot accidentally execute historical main.

The existing online identity adapter authenticates actual staff on every request. The action additionally binds the exact protected Shop, provider installation, tenant, installation generation and current authorization epoch/generation. Browser input is only the fixed action name; no browser plan, release evidence, tenant, key ring or path is accepted. The bearer ID token remains request memory and is neither persisted nor returned. Missing private configuration disables the action.

Startup composition reads one owner-controlled, same-UID, mode-0600 regular non-symlink plan at `/run/insignia/signing-owner-plan.json`, with fixed mode-0700 private journal root `/var/lib/insignia/signing-owner`. The metadata version is `m5-signing-owner-plan-v1`, with exact `binding` and `plan` fields. Wrapping custody uses the unchanged worker credential-key parser. The optional Compose overlay adds only those two mounts; it adds no code mount, preload, command override, token store or release append role. Target metadata must be supplied only after the original bootstrap readback establishes the real tenant/G/installation. It supplies no Active authority.

An exclusive fsynced reservation consumes the single attempt. The browser receives PENDING and uses GET recovery. The standalone component makes zero ID-token/API calls on mount; an explicit Check signing setup gesture initiates status. A missing, hostile or incomplete closed settlement receipt becomes UNCERTAIN rather than reconstructed success; refresh/restart cannot resume or repeat the POST. POST authentication failures and network timeouts never trigger automatic retry. GET may acquire one fresh ID token retry. Original trusted release and independent native Function freshness remain strict; READY is action availability, not issuance or admission authority. The existing operator performs the authoritative checks. No continuous Active, HTTP-count ceiling, cancellation of in-flight native writes, or current native freshness is claimed.

The proposed optional Function collector was removed before handoff at the parent's request. Its earlier synthetic 36-control run is historical qualification only; no collector route, capability, browser request or capture reservation ships. Independent owner-native Function collection and release append remain outside the ordinary server.

## Validation

All new DB/provider/identity observations are synthetic. The tests use the real existing lifecycle/crypto/publication adapter contracts, not invented native receipts. The local Chromium test intercepts all synthetic requests and verifies token-header confinement, denial handling and recovery without another POST.

```sh
node --test --test-timeout=5000 apps/web/test/admin/auth.test.mjs apps/web/test/admin/commands.test.mjs apps/web/test/admin/signing-owner-action.test.mjs apps/web/test/admin/signing-owner-request.test.mjs apps/web/test/admin/signing-owner-configuration.test.mjs apps/web/test/admin/signing-owner-browser.test.mjs scripts/m5-runtime/signing-provision-core.test.mjs
```

Initial signing-only qualification: **32/32 PASS**, zero failures/skips. Controls cover current identity/generation, stale trusted record without consuming an attempt, native Function drift, exact installation, hostile settlement, nonregular/FIFO/wrong-mode receipts, ambiguous public-config write, no POST replay, closed browser outputs and original helper source equivalence.

```sh
INSIGNIA_TEST_COMPOSE_BIN=/home/serveradmin/insignia-milestone-autonomy-handoff/runtime-deployment-tools/docker-compose node --test scripts/m5-runtime/signing-owner-compose.test.mjs
```

Result: **1/1 PASS**, actual offline Compose 2.39.4 config renderer with synthetic files; no daemon access. The renderer omits explicit false bind creation flags, so the control separately verifies the two exact false source declarations and rejects renderer-added options. Actual host Compose 5.5.1/CI deployment guard remains a future qualification requirement.

Astro check: **34 files, zero errors/warnings/hints**. Astro server build: **PASS**. Built SSR includes the pure lifecycle core and fixed private paths and excludes the historical stdin/main/createRequire entry. Scoped Biome: zero errors/warnings, two unchanged informational template suggestions in `production.ts`. `git diff --check`: PASS. Local Node used `/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node` (v24.21.0).

Meaningful observed RED→GREEN controls: missing action implementation; hostile partial receipt incorrectly becoming PROVISIONED; expired trusted release incorrectly READY; the actual Chromium uncertain-state recovery button disappearing; and initial mount requests preventing the explicit zero-token-call status gesture. These now pass. No separate historical failing log artifact is claimed.

## Integration

`SOURCE_SHA256SUMS` lists the exact handoff files. W18 already contains the historical signing executable; verify that it has the accepted hash and preserve it; any mismatch must be resolved before proceeding. No historical operator/test/report is rewritten by this patch. Temporary dependency symlinks used for local checks are excluded and removed before handoff.

The integrator owns `MerchantConfigEditor`: render `SigningSetup` only beneath the existing authenticated list/config boundary; wire `onAuthorizationDenied` to clearing private state and truthful current authorization status; wire `onComplete` only to current config/readiness reads. No Search rerun or mutation is required. Add `signing-provision-core.test.mjs` to the existing sequential operator controls and `signing-owner-compose.test.mjs` to the mandatory real renderer controls. This patch does not edit the workflow or MerchantConfigEditor.

Independent reviews, owner mount/custody qualification, exact private plan allocation, original fresh native release append, real staff action and provider readbacks remain required before execution. This supporting source does not establish commercial, quote, whole-product config, G7 or milestone completion.

## Integration correction — runtime identity source

The integrator reproduced a secret/provenance scanner RED because web production source contained literal real app/client identity markers. The correction passes the original built server apiKey/appId/appOrigin through a private runtimeIdentity port and qualifies it against the unchanged fixed operator identity in the script layer before constructing the capability. Trusted-record scope uses that validated identity. Wrong runtime app still fails before reservation or any key work; browser metadata cannot supply it. Synthetic fixtures derive accepted identity from the approved module-binding source and retain no forbidden identity literal. The scanner is unchanged.

A meaningful new wrong-runtime-client control was RED (missing expected exception), then GREEN. Affected action/core controls: **12/12 PASS**. Astro check34files zero diagnostics and web build PASS. The unmodified secret/fixture check PASS:120 production source files,104 separately scanned fixture/test files and both browser artifacts. Its first author invocation stopped on missing storefront build output; the actual storefront build/copy then allowed the full scanner to run. Earlier UI/HTTP/Compose controls are reused for unchanged bytes, rather than claimed newly run. This revision replaces the original source-manifest hash `5ede14ea90c30bbe00453909914b4d8f30841fd7285c59944996b5162368b57e`.
