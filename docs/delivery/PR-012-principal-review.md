# PR #12 — principal review

**Verdict: APPROVED — bounded G7 implementation/evidence checkpoint.**

Reviewed 27 September 2026. Repository `Optidigi/insignia`, PR #12.

| Binding | SHA |
|---|---|
| Base / effective merge base | `85282155631d6ab8048d65a3d2ca8ab050c76c06` |
| Approved head | `5596c34a31ea603cd897ceea280192d09bc24c99` |
| CI synthetic merge | `352333b9020a0850870cb695812c704b03f4ebcc` |
| Head and CI merge tree | `99d1b2bb17c832907ce84ce9f35816d458340b3d` |

This is the external verdict of the principal in the Insignia Rewrite Project. Native GitHub approval was attempted at this head and returned HTTP 403, “Resource not accessible by integration”; it was not posted. No merge or Shopify action was performed by this review. Owner merge/resource authority remains separate.

## Accepted scope

No merge-blocking defect found in the inspected implementation and evidence paths. The prototype provides public document shells, authenticated Astro server fragments, a Preact/Polaris editor, a server-only Shopify SDK boundary, and a local-only synthetic save. Identity comes from verified ID-token claims, not route/body shop selection. The actual staff-associated online grant and installation scopes participate in edit permission checks. Private content is non-cacheable. A viewer tag guards stale-editor submissions but is not an authentication credential.

The standalone Node build and HTTP smoke are supported by the actual final-head CI log. The 16 tests cover SDK verification with synthetic keys, identity/scope separation, tenant selection, single-flight exchange, expiry recovery, Origin/host checks, state isolation and stale draft/version behavior. The smoke executes the built server and HTTP requests; it does not execute the client JavaScript in a browser.

The live online exchange, two-route navigation, keyboard interaction and local save are accepted as **reported live observations** in the sanitized operator record. They are not independently replayed browser traces. Resized desktop is not a real mobile test. Real alternate-staff, third-party-cookie-blocked and expiry paths remain unproven. The final conceal/inert transition was not separately captured live. G7 remains IN_PROGRESS; there is no production-authentication or whole-gate acceptance.

## Cleanup adjudication

Retain status **PARTIAL / STOPPED_DEV_PREVIEW_RETAINED**. The reported scope-restoration outcome must not be rewritten as complete cleanup. The record says the original nine explicit / eleven effective scopes were restored, the local process and tunnel stopped, and one owned development-preview record remains. Those are operator-reported observations; the principal did not inspect the current shop.

Shopify's current `app dev clean` reference says it restores the app's active version. The local-development guide says preview configuration persists after the process stops and cleanup restores the active released version. This is consistent with the reported empty released scope configuration and loss of preview-granted scopes. It is not evidence of an Astro authentication defect.

**Immediate direction:** no further `app dev clean`, grant cycling, uninstall/reinstall, or released app-version change merely to obtain an empty preview list. Leave the stopped, documented preview untouched during the next off-store package. Do not describe it as a running service or a stable reachable Admin endpoint. Before another authenticated development run, inspect the exact app/store/preview/grants, supply a current controlled endpoint and stop safely on drift. A permanent released-configuration remedy requires a separate narrowly reviewed owner authorization and consideration of every affected installation. This review does not authorize it.

The exact prior nine explicit scopes are recorded in the reviewed development-only TOML. Do not promote that spike scope set or its placeholder URL into production by default.

## Follow-up findings (not merge blockers for this isolated proof)

1. **Save recovery:** `src/components/DraftEditor.tsx` does not apply the explicit timeout/cancellation used for fragment GETs to its POST. Before this editor pattern is reused, add bounded pending/error recovery and unmount/late-response behavior, with browser-level tests. A client timeout is not proof the server did not save; reload/version reconciliation must handle ambiguous outcomes. Do not claim all client requests are bounded to ten seconds. This is a reliability follow-up on a process-local, noncommercial edit, not authorization to expand this PR.
2. **Grant-cache lifecycle:** the five-minute, per-shop/user/session cache is a prototype choice. Production requires bounded entry retention, appropriate revocation/permission refresh and terminal-error eviction behavior. Periodic viewer checks do not prove immediate revocation of a cached online permission grant.
3. **Frontend evidence:** add reproducible client execution for navigation races, expired-token recovery, visibility/focus, identity changes, failed CDN/bootstrap and pending POSTs before full G7 adjudication. The current HTTP smoke and server tests cannot substitute for those cases.
4. **Proxy/tenant scope:** the fixed staging allowlist, exact installation ID, public host binding and local state are correctly bounded to this spike. Production multi-installation policy and trusted reverse-proxy configuration are later implementation work; no generalized claim is accepted here.

## Verification and limits

Inspected: PR metadata and fixed-ref comparison; authentication/SDK adapter/runtime; protected fragments and POST; public shell/bootstrap/editor; middleware and Node config; live launcher/TOML; all three server test files; built smoke; auth/navigation contract and review/evidence records; actual embedded-local job log.

Verified by live GitHub reads: both head-associated workflows succeeded (`36341328223`, `36341328190`); the embedded-local log ran checks/build/smoke on synthetic merge `352333b...`; that merge has the exact base/head parents and the same tree as the head. The fixed-ref comparison contains no architecture document changes. CI reports unchanged v1.2 plan/ledger hashes and frozen historical verification.

Not independently executed: dependency install, TypeScript tests, SDK exchange, Astro build, HTTP smoke, browser interaction or any Shopify operation. No compiled app artifact was downloaded or scanned by the principal. The source smoke's client scan and successful execution are CI evidence. The publication-local success was checked through run metadata, not a second full log inspection.

## Next work and authority

M0-009 is complete at its bounded scope. Preserve the G7 follow-ups and cleanup residue; do not keep repeating cleanup to repair a mismatch with an intentionally empty released configuration.

The next proposed package is **M0-010: off-store hybrid billing, entitlements and usage delivery**, the local portion of G8. It is separate from production billing activation and from G7 cleanup. Its owner-forwarded launch authorizes execution; this review alone authorizes neither a merge nor the next package's external actions.

The plan and ledger remain v1.2; Option A remains approved and whole-quote v2 provisional. Publication/fencing, complete G1–G8 acceptance, M1, release and production infrastructure remain outside this approval.

## Sources

- Reviewed repository: https://github.com/Optidigi/insignia/pull/12
- Fixed review packet: https://github.com/Optidigi/insignia/blob/5596c34a31ea603cd897ceea280192d09bc24c99/docs/delivery/review-packet-M0-009.md
- Fixed evidence: https://github.com/Optidigi/insignia/blob/5596c34a31ea603cd897ceea280192d09bc24c99/spikes/m0-009/evidence/README.md
- Shopify clean command: https://shopify.dev/docs/api/shopify-cli/app/app-dev-clean
- Development preview behavior: https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally
- Online tokens and user scope: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
