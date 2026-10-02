# M5-006 — released-configuration checkpoint

## Authority and exact baseline

The owner authorized PR #31's **normal merge only** at base `6687e443baf97ee8bf179db61a1e4450f903f8eb`, head `dc9db629559d5fa7049de2d0d3fed28d53a08fb4`, tree `aeb12dba4944b5934fc33c5494992c6ad5ca87dd`. The supplied [PR-031 verdict](PR-031-principal-review.md) is attributed external principal approval, not a native GitHub review. Package manifest checks passed. Live refs, effective merge base, clean worktree, allowed merge-commit method and all ten approved-head workflows (attempt 1) were reverified immediately before the normal merge; no reviewed-head commit, squash/rebase, force push, fabricated approval or protection bypass.

Actual merge: `dbaa7488780ddf8fd01991bf5a76a909e07b34e0`, ordered parents `6687e443baf97ee8bf179db61a1e4450f903f8eb` then `dc9db629559d5fa7049de2d0d3fed28d53a08fb4`, tree `aeb12dba4944b5934fc33c5494992c6ad5ca87dd`, merged at 2026-10-02T10:33:44Z. Remote main and fetched commit match. [Merge receipt](evidence/m5-006/pr31-merge.json). Only after the browser prerequisite and useful observations were established did this docs-only branch start from that exact merge; remote main was rechecked first.

## Browser prerequisite and two-scope evidence

The existing T3 shared-browser status initially reported no attached tab. The single normal `preview_open` succeeded with the collaborative browser, then the approved exact-app URL opened an **already authenticated** Dev Dashboard without login/consent. Tool names containing preview denote the collaborative browser here; no Shopify application preview occurred.

The sole root operator reserved each purpose/target/time in a local observation note before opening it. Two logical view scopes were consumed, in this order: app/development overview, then Versions/current active-version details. Normal navigation from the overview's Versions link and the explicitly Active version row, scrolling, and rendered visible-text inspection stayed within those scopes. [Narrow observations and times](evidence/m5-006/view-observations.json). No raw screenshot, account/user details, browser storage, credential, request body or network trace was retained.

### App/development overview

Exact native URL: `https://dev.shopify.com/dashboard/200969036/apps/429028933633`; title Overview · Insignia · Dev Dashboard, displayed app Insignia and Optidigi context. This identifies the owner-designated App resource, not just its label.

- Designated OAuth client ID: **NOT_OBSERVED in this view**. The owner designation and prior M5-005 exact App/client identity mapping are retained as provenance, not presented as a new native client-ID read. No settings/secret screen was opened to obtain it.
- Designated store/shop: **NOT_OBSERVED** in the permitted overview.
- Development preview status/target: **NOT_OBSERVED**; no explicit active/no-preview statement was exposed. An absent preview banner is not proof of no preview. No other work was stopped or cleaned.

### Versions → current released version

The Versions listing explicitly marked **insignia-1 — Active**. Its detail page also displayed **Active**, and its Timeline displayed **Released**. This is evidence of the current active/released version, not selection of the newest row by inference.

| Field | Direct native observation |
|---|---|
| Version name | `insignia-1` |
| Version ID | `1146748534785`, from exact native detail URL |
| Detail URL | `https://dev.shopify.com/dashboard/200969036/apps/429028933633/versions/1146748534785` |
| Release time | `Sep 28, 2026 · 2:11 pm`, as displayed; timezone NOT_OBSERVED, no UTC conversion asserted |
| App name | `Insignia` |
| `application_url` | `https://example.com` |
| `embedded` | `true` |
| Access scopes section | Displayed, containing `use_legacy_install_flow` → `false` |
| Required scope declarations | **NOT_OBSERVED**: no `scopes` field/list or explicit empty label displayed |
| Optional scope declarations | **NOT_OBSERVED**: no `optional_scopes` field/list or explicit empty label displayed |
| Webhooks `api_version` | `2026-07` |
| Extensions/identities | **NOT_OBSERVED**: no extension section/list or explicit empty designation displayed |

Read-only scroll/rendered-text inspection showed the same configuration; no detail-expansion control was exposed. Absence of scope fields is **not** recast as an explicitly empty scope declaration. Absence of extensions is **not** proof of an empty version manifest. No create/edit/release action was opened or clicked.

## Comparison and supported interpretation

[M5-005](M5-005-REPORT.md) observed the exact designated App/client/shop/installation/development identity at 01:23 UTC on 2 October, with token, installation, REST and app-requested/optional projections all explicitly EMPTY. The preceding [M5-002R](M5-002R-REPORT.md) CLI/development-preview context observed nine grants after preview/cleanup; [PR-028R3](PR-028R3-principal-review.md) subsequently retained that then-observed state without authorizing repair. Those records remain unchanged.

The new native evidence establishes **which active release** is visible (`insignia-1`) and its example.com/embedded/legacy-flow/webhook-API configuration. This is consistent with the principal's released-versus-development configuration-context working explanation, but the UI's omitted scope lists do not independently establish empty declarations. Preview absence, current declared lists, full extension manifest, exact current client/store mapping and historical change timing remain unresolved at this checkpoint. No revocation, bad credential, provider defect or same-token equivalence across historical routes is claimed.

## Exactly one proposed next action

**Propose a bounded read-only configuration/preview disclosure checkpoint for this exact active version and designated dev store, before any repair proposal is executed.** Required new owner/principal authority should name a supported existing-access route that can expose `insignia-1` / version `1146748534785`'s full required/optional scope declarations and bundled extension manifest, plus the designated store's explicit development-preview state. An owner-provided sanitized authoritative capture/export is acceptable; it must be bound to that exact active version rather than a local TOML or another draft. This report does not claim that such an export/control is available in the current UI and does not request broad account access.

That is the single discriminating next action, not permission to update the nine handles. Any later development-only version/consent amendment must preserve the observed URL, embedded flag, legacy-flow flag, webhook API version and actual existing extensions; establish ownership of any competing preview; state verification/rollback requirements; and separately obtain owner/principal authorization. Shopify configuration and extensions are versioned together. No scope change alone is promised to produce usable grants.

## Permission, preservation and verification

Two view scopes; **zero** scripted Shopify API requests, token/refresh exchanges, Shopify CLI commands, credential-file reads or metadata access, login/consent, app launch, application preview, configuration/scope/install/release changes, product/Function/billing/commerce work or M5-004/M5-005 reruns. Native UI background traffic occurred as ordinary navigation; it was not individually accounted and is **not claimed to be zero total network traffic**.

Both canonical closed-run registers were hashed before/after and remain byte-identical: [M5-004](evidence/m5-006/m5-004-preserved.json), [M5-005](evidence/m5-006/m5-005-preserved.json). Tracked source, operators, tests, dependencies, TOML, migrations, CI, architecture and historical evidence are unchanged. No harness or new tool was built. Shared infrastructure, older fixtures, billing resources and stopped preview states were preserved.

Actual T3 runtime is `gpt-6.1-sol/high`; root is the only writer/operator. Relevant repository-pinned writing/handoff/diagnosis/review skills were read. Local doc/JSON/secret checks and fresh independent GPT-6.1-sol/high restricted **scoped documentation/evidence** Spec and Standards/security reviews are required for handback. They are not production-source rereviews or suite reruns. Exact final refs, full scoped reports and applicable automatically triggered CI will be returned in the PR packet. Prior root, PostgreSQL 159, 100-case stress and benchmark evidence stays attached to PR #31's exact head; no unchanged integration/stress/benchmark suite is manually rerun solely for this inspection. Automatically triggered new-head runs will be reported separately.

## Principal boundary

M5-004 remains BLOCKED; its cases NOT_RUN. Public-merchant authentication and production readiness are unchanged. No publication activation, genuine RELEASE_BOUND, gate pass, M6/M7 or launch follows from these facts. One useful but qualified docs/evidence PR; stop for principal adjudication. Successor merge and proposed next action are unauthorized.
