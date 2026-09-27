# Principal review packet — M0-009

## Identity and authorization

Repository: `Optidigi/insignia`. Branch: `spike/m0-009-embedded-admin`. Base and effective merge base: `85282155631d6ab8048d65a3d2ca8ab050c76c06`. The PR URL, final head and final-head CI are recorded in the PR body after publication, so this committed packet does not contain a moving self-reference.

The principal's attributed external PR #11 approval bound base/effective merge base `0f2c80a316228bd69fdd2ff272e967ff14647b2b` and head `4ea4af3450821c5aee2dd0e97a1fe7a39ebdec9e`, with passing final-head workflows `36323324909` and `36323324889`. The owner explicitly authorized only its normal merge and M0-009. Remote `main` merge `85282155631d6ab8048d65a3d2ca8ab050c76c06` has those exact parents and the reviewed head tree. No native approval was manufactured.

## Outcome and scope

`spikes/m0-009` contains an isolated Astro 7 standalone Node SSR proof, Preact editor island, stable Polaris 1.1 and App Bridge shells, server-only Shopify SDK adapter, verified online staff identity/installation read, two routable pages and one local synthetic draft use case. [Contract](../../spikes/m0-009/auth-navigation-contract.md) states document, token, tenant, permission, stale-view and proxy-origin boundaries. [Evidence](../../spikes/m0-009/evidence/README.md) records commands, live observations, failures and cleanup. The package prompt and this operational state pointer were updated; v1.2 plan/ledger, M0-008 publisher, old Functions/protocols and historical receipts were not changed.

The app loads unprivileged documents first. App Bridge's same-origin fetch supplies an ID token; the Node SDK verifies it, exact `iss`/`dest`/audience/allowlisted shop are checked, and an online staff grant is exchanged. Astro renders the protected fragments only after installation and scope checks. The POST uses the exact browser Origin and public host, verified identity, staff-associated permission, validated label and an opaque viewer binding to prevent an old editor saving under a new staff identity. A live 10-second fetch bound and a local one-retry expiry response prevent an indefinite client loop. All editor state is process-local.

## Acceptance evidence

| Criterion | Actual procedure | Result / limit |
|---|---|---|
| Identity and starting installation | Disposable `shopify app config pull`; read-only `shopify app execute` shop/currentAppInstallation query | PASS: existing app client, shop `gid://shopify/Shop/78935261342`, installation `gid://shopify/AppInstallation/781307904158`, original eleven effective scopes. Released config has URL `https://example.com`, empty scopes/redirects. |
| Local behavior and server types | `cd spikes/m0-009 && ASTRO_TELEMETRY_DISABLED=1 corepack pnpm check` | PASS: Astro 0 diagnostics, strict TS and 16 Vitest tests. |
| Production bundle/process | `PUBLIC_SHOPIFY_API_KEY=942e6668fd1177524c0fc48b104b0ac3 ASTRO_TELEMETRY_DISABLED=1 corepack pnpm build`; `ASTRO_TELEMETRY_DISABLED=1 corepack pnpm smoke:built` | PASS: standalone Node SSR starts/stops; unauthenticated shell/no tenant state, private 401, verified synthetic identity, local save, rejection/recovery and client asset scan. A missing public client ID fails build by design. |
| Live Admin proof | Web-only `shopify app dev`, T3 collaborative Admin iframe, bounded read-only shop/installation query and keyboard-operated local editor | PASS at the current staging staff account: cold launch, deep draft, local save, reload, Overview navigation, back/forward, error/focus and 390px viewport. A second local save after the viewer-binding correction also succeeded; no Shopify write was made. |
| Historical decision integrity | `python3 -B spikes/m0-007/scripts/check-history.py` | PASS: v1.2 plan SHA256 `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`, ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`; 41 prior sources and 120 receipts unchanged. |
| Preview cleanup | `shopify app dev clean`, two read-only grant checks, scoped `shopify app dev --no-update` restoration | **PARTIAL / RESIDUE:** clean removed the original grant because the released app config has no scopes. Exact existing grants were restored without release, but one owned dev-preview record remains. No tunnel or local process runs after stop. See evidence. |

The public CDN endpoints for App Bridge and `polaris-1.1.js` returned 200. Polaris types are pinned 1.1.0. Local CLI config validation passed. GitHub Actions runs the frozen installation, history check, type/tests, standalone build and served-output smoke without merchant credentials; final-head run IDs and results belong in the PR body.

## Local pre-review and dispositions

One UI writer used a separate assigned worktree/branch; the orchestrator integrated that commit and owned auth, lockfile, contract, CI and live staging. A read-only documentation/research scout preceded implementation. Separate worktrees are not OS-level credential isolation, and only the orchestrator operated Shopify. Fresh read-only Spec and Standards/security reviewers examined the integrated diff; neither is principal approval.

Spec findings were addressed: this packet now exists; a viewer-bound POST plus clearing on navigation and concealment during focus/visible-tab revalidation and 15-second visible polling limit stale cross-user views; synthetic and built-output tests show fresh-token recovery after an expired token. An in-place staff change may leave the previous view visible until the next check begins; no instant staff-switch event is claimed. Security findings were addressed: SDK second-verification or exchange HTTP 400 maps to Shopify's one-retry 401 while other failures stay 503; builds fail if the public client ID is absent/mismatched. The reviewers' explicit remaining live limits (alternate staff, real expiry, blocked third-party cookies) remain NOT_RUN and are not claimed as G7 passes. Polaris `input`/`change`, disabled/loading button, validation error and keyboard focus were observed in the live iframe; no Preact hydration error was observed on successful render, though no private browser trace is retained.

## Compatibility, safety and unresolved items

No price, Function, schema, token carrier, product policy, order, payment, discount, inventory, billing or merchant write changed. No new app/store, released deployment, distribution selection, scope expansion or live credential export occurred. The lone local synthetic draft is non-durable. The five-minute online grant cache needs production revocation policy. Live alternate-staff, second-tenant, real expiry, third-party-cookie-blocked and real-mobile checks remain open. The current `app dev` cleanup/scope conflict is a concrete staging residue; a future authorized released app-config or installation remedy is needed before cleaning that preview while preserving the original grant. Option A publication/fencing, v2 production adoption, full G7/G8 acceptance and M1 remain outside this PR.

## Principal decision — principal completes externally

Verdict: PENDING. Bound PR/base/head: PENDING actual PR and final refs. Gate result: NONE requested. Further authorization: NONE.
