# Principal review packet — new public-app setup

## Identity

Repository: `Optidigi/insignia`. Branch: `setup/new-public-app` from verified remote `main` `8294705b5caad98ae2537ba3cbba7a458ecb3e62`. Final PR URL, head and effective merge base are recorded in the PR body after commit. Authorization: [owner-issued package](prompts/NEW-PUBLIC-APP-SETUP.md). Required next action: principal review; no merge is delegated.

## Outcome and scope

The newly designated Optidigi Public/Draft app `429028933633` is linked to a **new named** web-only configuration in the existing M0-009 harness. A dedicated Basic dev store was created and the new app installed with only product-read/write grants. The secure new-app secret location is outside the repository. A temporary dev preview worked at CLI level and was stopped; the preview record remains. Actual embedded staff token exchange could not be observed because the shared browser automation host was unavailable. No public launch or billing test is claimed.

Changed paths are the new named config/launcher, limited bootstrap mode and tests in `spikes/m0-009`, its applicable CI, and current operational documents. Shared M0-009 shell, middleware and runtime source is adapted for the new mode; the historical `shopify.app.toml`, old web launcher, old staging behavior, evidence and resources remain unchanged. The approved v1.2 plan and decision ledger remain unchanged. The attached prompt is archived verbatim in `docs/delivery/prompts/NEW-PUBLIC-APP-SETUP.md`.

## Acceptance evidence

| Criterion | Actual check | Result | Evidence |
|---|---|---|---|
| Exact new app/organization/distribution/client | Authenticated Partner All apps, Dev Dashboard Settings, initial version inspection | VERIFIED | [Direct observations](evidence/new-public-app-setup.md) |
| Dedicated Basic dev store | CLI `store create dev --organization-id 200969036 ... --plan basic --json` | VERIFIED | [Direct observations](evidence/new-public-app-setup.md) |
| Named config / web-only preview | CLI `app config link`, `app config validate`, explicit `dev:public` launcher | VERIFIED | [Direct observations](evidence/new-public-app-setup.md) |
| Installed app, exact shop/app/GID/scopes | Pinned `2026-07` Admin GraphQL read through new app | VERIFIED | [Direct observations](evidence/new-public-app-setup.md) |
| Real embedded launch/online token exchange | Shared T3 browser navigation | UNVERIFIED — automation host unavailable before launch | [Direct observations](evidence/new-public-app-setup.md) |
| Provider / pricing readiness | Partner Distribution, registration and Partner API client pages; App Events token acquisition only | PARTIAL — registration gate, no Partner client, token response metadata mismatch | [Direct observations](evidence/new-public-app-setup.md) |
| Billing test | No plan, meter, subscription, event or charge | NOT_RUN; events 0 unique / 0 POST | [Direct observations](evidence/new-public-app-setup.md) |
| Build/auth boundaries | `corepack pnpm check`; builds and built-output smoke for old and new public IDs; history check; Git diff/secret scan | See final PR CI and local results | [Direct observations](evidence/new-public-app-setup.md) |

## Local pre-review

Fresh read-only Spec and security reviewers inspected the initial diff. They raised store binding, placeholder endpoint, launcher isolation and two-phase installation concerns. The code now binds the exact new store and installation GID, distinguishes CLI temporary HTTPS from the initial placeholder, checks CLI/bundle client agreement and documents the first-install sequence. Final read-only Spec review caught one inaccurate claim that earlier M0-009 source was unchanged; this packet now states that the shared source was adapted. Final security review found no concrete blocker or secret exposure. Both explicitly withheld live embedded-auth acceptance. Independent reviews do not replace principal approval.

## Compatibility and safety

The historical config and live mode remain available. The new mode fails closed for missing/wrong client, shop or installation; public browser output contains no server secret. No data migration, money calculation, product policy or billing contract changed. Test-only credentials are outside Git with owner-only OS permissions. Preview cleanup was limited to stopping the process; old staging preview/grants are untouched. The initial new-app release still has Shopify's `example.com` placeholder and is not a functioning hosted service.

## Principal decision — principal completes externally

Verdict: PENDING. Gate result: none accepted. No next package, PR merge, paid registration, billing event, public launch or M1 is authorized by this packet.
