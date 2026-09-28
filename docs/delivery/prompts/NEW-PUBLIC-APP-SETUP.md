# Insignia — new public-app setup

Issued: 28 September 2026. Outcome: one integrated setup/configuration PR for the new designated public app. This is resource-specific commissioning inside the current M0 work, not a new architecture or general preflight.

## Authority and starting state

The owner reports creating **Insignia**, Dashboard app resource **429028933633**, and selecting Public distribution under Optidigi. No other settings or API access have been configured. Treat that as the owner designation, and verify its actual identity before remote changes. The numeric resource is not the OAuth client ID; retrieve the latter from the new app.

Repository: `Optidigi/insignia`. Principal checked `main` at `8294705b5caad98ae2537ba3cbba7a458ecb3e62`, the already-completed normal PR #14 merge. Fetch the current state, preserve legitimate newer work, and branch from current remote main. No old PR needs another merge. A changed tip requires understanding its changes, not resetting them.

Read `AGENTS.md`, current delivery state, the v1.2 architecture ledger/plan and relevant existing M0-009 authentication and M0-010/011 provider contracts. Use the repository's installed `writing-for-agents`, `implement`, `research` and `code-review` skills as relevant. Use available Shopify documentation/schema tools and current primary documentation; distinguish absence of an MCP from an actual blocked command or API request. Reuse existing toolchains and proven session routes.

The accompanying owner message authorizes the bounded actions below when the owner sends it. The principal retains architecture decisions, gate acceptance and final PR review. No PR merge or subsequent package is delegated.

## 1. Bind the new resource and isolate old ones

Using the approved shared browser/CLI, inspect app **429028933633**. Record its exact Dashboard URL, title, OAuth client ID, actual Dev organization, linked Partner organization and Public/draft status. The previously identified Optidigi Partner organization is **4697030**; verify the new app belongs to that organization. Do not infer the Dev organization ID from that Partner ID or from another app's URL. Resolve an App GID from an actual returned field when available; otherwise retain the numeric Dashboard identity without claiming API verification.

Confirm whether the new app has any versions, installations, pricing or subscribers. If unexpectedly attached to real merchants or pre-existing commercial state, stop that mutation branch and report the conflict. Otherwise continue without an additional confirmation round.

The legacy apps on Superfunny/Stitchs, any remaining old experimental app **427859050497**, and the earlier `insignia-staging.myshopify.com` environment are outside this package's mutation scope. Do not rename, delete, migrate, relink or restore an old app. Preserve orders #1001–#1006, historical evidence and the old stopped-preview holding state. Do not recreate the app the owner already created.

**Done:** the designated app, Public status and Optidigi ownership are directly bound, or the exact missing access/conflict is reported while independent local work continues.

## 2. Link existing code and establish a controlled test environment

Link this existing registration to a new named configuration in an appropriate existing Shopify harness. Use the installed CLI's `app config link` and its verified new client ID; inspect `--help` for output-file flags. Preserve existing configuration files and all historical IDs. Do not run a new app initializer or add React Router/another application scaffold.

Prepare the smallest web-only configuration for the existing Astro/Preact/Polaris authentication proof:

- Embedded Admin enabled, Shopify-managed installation, existing supported token-exchange/authentication design.
- Actual controlled HTTPS web endpoint and only implemented auth redirect routes, where needed by that design. No legacy application URL or placeholder presented as working.
- Keep the established `2026-07` API pin unless a concrete incompatibility requires principal direction.
- Derive the minimal Admin scopes from this bootstrap's executable operations. The scope ceiling is `read_products` / `write_products`; use the write scope only if the existing synthetic-save permission proof requires it. No actual product mutation is authorized. Do not copy the historical eleven-grant experiment set.
- No Functions, App Proxy, theme changes, order/customer access, inventory or webhook experiments in this setup. Record their later requirements rather than provisioning them now.

Use a dedicated **Basic dev store in the same confirmed Optidigi Partner organization**. An existing store is suitable only if clearly dedicated to this rewrite/testing, without live merchant dependencies or unrelated test consumers. If none exists, the owner message authorizes creation of **one** new dev store, preferred name `insignia-rewrite-dev` with an available suffix if necessary. Record its actual URL/GID and organization. This is a dev store, not a paid subscription or client-transfer store. Keep standard password protection and feature previews off unless already required by the approved test.

Run local config/build/security checks and fresh local review before the remote bootstrap. Prefer a web-only CLI development preview. The owner message permits installation and ordinary consent for the scopes above on this one dev store. If an initial configuration version is required for installation, **one initial web-only bootstrap version on this new app** is permitted after local review and verification of no real merchant installs. This narrow exception does not authorize extension deployment, public listing submission or production hosting. Capture the exact version/configuration and make development-only endpoint lifetime explicit. Avoid releasing a placeholder solely to satisfy a UI step.

Verify actual embedded launch/token exchange and a minimal authenticated app/shop/installation/scope read. Reuse the existing local-only synthetic save if useful; do not repeat the entire G7 browser matrix or claim a full G7 pass. Establish public client ID ↔ App GID ↔ installation ↔ dev store binding from actual results.

**Done:** one named configuration plus a verified development installation/authentication result, or completed local integration and a precise external limitation. No merchandise checkout is required.

## 3. Provision secret locations; verify provider prerequisites without billing

Prepare secure, app-specific server-side credential locations outside tracked source. Use an existing approved secrets mechanism, or a local directory restricted to the OS user with files readable/writable only by that user. Commit variable names and loading instructions, never values. Do not scan unrelated secret stores or copy another app's credentials.

Retrieve the new public client ID directly. For the new app's existing client secret, use a supported non-logged transfer into the protected location only when that route genuinely exists. Otherwise give the owner one exact local placement action. Do not reveal secrets in chat, browser evidence, clipboard/tool logs, terminal history, PRs or artifacts. Login, 2FA and owner-only consent use the normal interactive route.

Keep authentication purposes separate:

- Embedded Admin: this public app's supported ID-token/token-exchange flow, not an organization-only integration shortcut.
- App Events: its own bearer token using the new app's documented client credentials. Do not invent a separate permanent App Events key requirement when the existing new-app key supports the documented flow. Token acquisition and scope/lease verification are allowed; an event POST is not.
- Partner API: an organization client belonging to Optidigi, separate from Admin/App Events access. Reuse only a credential explicitly approved for this task. If absent, prepare one owner action for a dedicated Partner API client with **Manage apps**. This permission covers organization app resources, not just Insignia; its creation is NOT included in this app-specific setup authorization. Do not add **View financials**, Manage themes or Manage jobs merely for read checks. A later automated cancellation test may require separately approved View financials access.

Inspect the new app's Partner listing and pricing configuration through actual navigation. The selected architecture already uses **Shopify App Pricing**: on this genuinely new, unconfigured app, the owner message allows selecting that method if the UI permits it without any charge, existing-contract migration or listing publication. Inspect the built-in private $0 test-plan availability and existing meter shape. Do not invent actual commercial plan prices/features, edit public plans, create meters, choose a subscription, accept a charge or submit App Events in this package.

Using approved credentials when available, perform minimal scoped Partner reads to verify app identity/eligibility and actual current subscription state. A null subscription is a valid setup observation, not a failed billing test. Keep an unverified state distinct from null. Do not bypass missing credentials with an Admin token or a UI redirect parameter. No package-wide event budget needs implementation here because event sends remain disabled.

**Done:** real provider-access/eligibility results or one consolidated owner-only action list. Complete the local/app setup even if Partner credentials are missing.

## 4. Review, finish and hand back

Use the established actual `gpt-6-sol` / `high` orchestrator route. At most two non-overlapping writers with one integrator; exactly one remote Shopify operator. Fresh local Spec and security review precede handoff. Use effective restrictions actually available and report their limits honestly. No host-security changes or general setup overhaul.

Return **one integrated PR** with the named new configuration/launcher adjustments, operational identity register, secret-loading instructions without secrets, applicable passing tests/CI and sanitized direct observations. Keep v1.2 architecture text and historical integrity evidence unchanged; update only current operational designation/pointers. Any code adaptation must stay inside bootstrap/provider configuration and retain the previous tested invariants.

Record for each remote action the exact new app/store, operation, result and final state. Retain the new app and dedicated dev store; they are intended setup resources. Stop temporary local processes when finished. Inspect the effect of any new-app preview cleanup against the captured new-app baseline; grant rollback on this new test installation is not automatically damage, but do not cycle cleanup/reinstallation or promise an inactive tunnel is a working service. The old preview/grants remain untouched.

Handoff must distinguish configured, installed, authenticated, provider-readable and billing-tested. Billing-tested remains **NOT_RUN**, event counts **0 unique / 0 POST attempts**, G8 unaccepted, and v2/publication decisions unchanged. State any remaining owner-only actions once with exact destinations and minimal permissions; do not end at the first missing external prerequisite.

Stop for principal review. No merge, production release, public listing submission, billing event, buyer order, gate acceptance or M1 follows automatically.

## Current primary references

Checked 28 September 2026; verify the relevant live UI/schema when executing. These are public documentation, not observations of app 429028933633.

- CLI linking: https://shopify.dev/docs/api/shopify-cli/app/app-config-link
- Configuration: https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- Credentials: https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials
- Dev stores: https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores
- Public distribution: https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- Protected data: https://shopify.dev/docs/apps/launch/protected-customer-data
- Partner API/permissions: https://shopify.dev/docs/api/partner/latest
- App Events authentication: https://shopify.dev/docs/api/app-events/latest
- App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
