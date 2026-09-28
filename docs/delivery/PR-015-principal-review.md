# PR #15 — principal review

Issued: 28 September 2026. Verdict: **APPROVED — bounded new public-app setup checkpoint**.

Repository: Optidigi/insignia. PR: https://github.com/Optidigi/insignia/pull/15
Base and effective merge base: `8294705b5caad98ae2537ba3cbba7a458ecb3e62`
Reviewed head: `f134a0dfc34460b78c48f1c88fd65e74c3b7fde4`

Native APPROVE was attempted at the reviewed head and returned HTTP 403, `Resource not accessible by integration`. No native review was posted. This is the attributed external principal verdict. The principal has not merged or operated Shopify. A normal merge still requires the owner's explicit permission.

## Findings and disposition

No merge-blocking defect found in the inspected changes. The named configuration and dedicated preview launcher preserve the historical app/store path while adding the new public registration. Bootstrap runtime requires the designated new client, allowlisted new shop, HTTPS origin and a configured installation ID that the existing authenticated installation read must match. The launcher checks its build-client marker against the selected CLI client before importing the server. Secret values are not introduced into the reviewed diff.

The four new tests cover missing installation configuration, wrong old client, HTTP origin/old-shop rejection and a synthetic new-shop adapter control. This is not a complete production-authentication suite. The old/new client builds both pass, but both built-output smokes deliberately use synthetic authentication. They do not execute a real App Bridge/staff login, and neither do the CLI's installation/scope reads.

The setup report binds the following at operator-reported Dashboard/CLI/API scope:

| Identity | Value |
|---|---|
| App | Insignia, `gid://shopify/App/429028933633`, Public/Draft |
| Public client ID | `1443cf6d03d39edae7c101a943c5c684` |
| Partner / Dev organizations | Optidigi `4697030` / `200969036` |
| Dedicated Basic dev store | `insignia-rewrite-dev.myshopify.com`, `gid://shopify/Shop/105501393179` |
| Installation | `gid://shopify/AppInstallation/1054356963611` |
| Observed grants | `read_products`, `write_products` |

The report is a sanitized operator record; the principal did not independently repeat these Shopify requests or inspect the local credential file. Preserve that provenance.

## Explicit limits

- Real new-app embedded staff token exchange and local save remain unverified. The blocked browser host is an execution limitation, not evidence against Astro or Shopify authentication.
- New app and dev store are intended retained resources. Stopped preview plus Shopify-created `example.com` initial version is accepted as a temporary holding state only. No usable permanent endpoint, production release or completed preview cleanup is claimed. Do not cycle cleanup/reinstallation merely to erase a preview record.
- App Pricing's observed registration screen and absent Partner client are account/access prerequisites. Registration/payment and organization-wide permission grants were outside the setup authorization.
- The four reported App Events token acquisitions returned HTTP 200 but lacked top-level `scope` and `expires_in`. Keep token receipt distinct from adapter acceptance, permission/lease evidence and actual event processing. No event was sent. This does not establish that Shopify rejected the token or that a new credential is needed.
- HTTP 202 remains receipt-only. Live billing, public non-Plus qualification, v2 adoption, publication/fencing and remaining G7/G8 obligations are not passed.

## Verification performed

Inspected the original supplied setup prompt, complete PR diff and 18-file comparison, new launcher/configuration/build scripts, changed shell/middleware/runtime, existing Shopify adapter, new bootstrap tests, workflow, smoke script, setup report and review packet. The v1.2 architecture records are absent from the diff; CI's history check reports the unchanged plan/ledger hashes, 41 older sources and 120 receipts.

Read actual embedded-local job log `108935064252`, run `36424512085`: pinned Node 24.21.0, frozen installation, strict checks, 20 tests, both client-ID standalone builds and both served-output smokes pass. All four applicable head-associated workflows succeeded: `36424512011`, `36424512085`, `36424511907`, `36424511847`.

Verified CI synthetic merge `267b35b1588dcc40a5771441a30de28b33978eef` has exact base/head parents and tree `16fded2419f0f20228144076e7f4b5624c4858e6`, also the reviewed head's tree.

Independent execution: 11 launcher cases pass under Node 22.16.0, using exact Git-blob-verified `web-public/server.mjs` (`cf66aacb974e92feea054d19c54d69f6794ac968`) in a scratch layout with a synthetic entry stub. Checks cover expected client/marker acceptance, wrong/missing client and marker rejection, missing secret/URL and invalid ports, forced loopback/bootstrap mode and no printing of the synthetic secret. These checks do not execute Astro, Shopify SDK, browser or network. Details: `verification/launcher-results.json`.

Not independently performed: full repository build/test run, real Shopify operations, new-app staff exchange, local secret-file permissions inspection, complete historical hash rerun or compiled client-asset scan. CI and operator results remain separately identified.

## Direction

Keep this head unchanged for the owner-authorized normal merge. Continue on a new branch with the attached bounded authentication/provider-contract work, once the owner sends its launch authorization. Registration and Partner-client provisioning are owner-side actions; they need not block independent authentication/local work. No legacy changes, billing event, subscription, product mutation, full gate acceptance or next-PR merge is delegated.

## Sources checked

- Fixed-head PR and source: https://github.com/Optidigi/insignia/pull/15 and its reviewed commit.
- Shopify registration: https://shopify.dev/docs/apps/launch/distribution/revenue-share
- Partner credentials/permissions: https://shopify.dev/docs/api/partner/latest
- App Events contract: https://shopify.dev/docs/api/app-events/latest
- OAuth successful token response: https://www.rfc-editor.org/rfc/rfc6749.html#section-5.1
